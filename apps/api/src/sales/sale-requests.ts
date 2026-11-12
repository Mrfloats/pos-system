import { BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Injectable, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateNested } from 'class-validator';
import { and, count, desc, eq, inArray, sql, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { divRound, formatFixed, fromCents, parseFixed, sum, toCents } from '../accounting/money.js';
import { AuditService } from '../common/audit.service.js';
import { type AuthContext, Ctx, FRONT_OF_HOUSE, MANAGERS, Roles } from '../common/auth-context.js';
import { assertPinConfirmed } from '../common/lockout.js';
import { Can, can } from '../common/permissions.js';
import { found, ListQuery, Trim } from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import { saleLines, saleRequests, sales, shifts, stores, users } from '../db/schema.js';
import { IdParam } from '../organization/organization.dto.js';
import { PAYMENT_METHODS, type PaymentMethod, ReturnLineDto } from './sales.dto.js';
import { SalesService } from './sales.service.js';

// ----- DTOs ------------------------------------------------------------------------------

export class CreateSaleRequestDto {
  @IsIn(['refund', 'void']) kind: 'refund' | 'void';
  /** Refunds: what comes back. */
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ReturnLineDto)
  lines?: ReturnLineDto[];
  /** Refunds: how the money goes back. */
  @IsOptional() @IsIn(PAYMENT_METHODS) method?: PaymentMethod;
  @IsOptional() @IsBoolean() restock?: boolean;
  @Trim() @IsString() @Length(1, 300) reason: string;
  /** The cashier's open shift, so an approved cash refund comes out of their drawer. */
  @IsOptional() @IsUUID() shiftId?: string;
}

export const REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;

export class SaleRequestQuery extends ListQuery {
  @IsOptional() @IsIn([...REQUEST_STATUSES, 'decided']) status?: (typeof REQUEST_STATUSES)[number] | 'decided';
  @IsOptional() @IsIn(['refund', 'void']) kind?: 'refund' | 'void';
  @IsOptional() @IsUUID() storeId?: string;
  @IsOptional() @IsUUID() saleId?: string;
  /** Only the signed-in person's own requests (what a till shows its cashier). */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() mine?: boolean;
}

export class ApproveDto {
  @IsOptional() @Trim() @IsString() @MaxLength(300) note?: string;
}

export class RejectDto {
  /** Why not: the cashier sees it on the till. */
  @Trim() @IsString() @Length(1, 300) note: string;
}

// ----- Service ---------------------------------------------------------------------------

@Injectable()
export class SaleRequestsService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly salesSvc: SalesService,
  ) {}

  /** A cashier asks for a refund or a void. Checked now, so a manager isn't asked for something that can't be done. */
  create(ctx: AuthContext, saleId: string, dto: CreateSaleRequestDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [sale] = await tx.select().from(sales).where(eq(sales.id, saleId)).limit(1);
      found(sale, 'Sale');
      if (sale.status !== 'completed') throw new BadRequestException(`This ${sale.type} is ${sale.status}`);
      let amount: bigint;
      if (dto.kind === 'refund') {
        if (sale.type !== 'sale') throw new BadRequestException('Only sales can be refunded');
        if (!dto.lines?.length) throw new BadRequestException('Choose what is coming back');
        if (!dto.method) throw new BadRequestException('Say how the money goes back');
        amount = await this.refundAmount(tx, saleId, dto.lines);
      } else {
        if (sale.type === 'quotation') throw new BadRequestException('Cancel a quotation instead');
        if (sale.fiscal) throw new BadRequestException('This was reported to ZIMRA, so it can’t be voided. Ask for a refund instead.');
        if (sale.type === 'sale') {
          const [r] = await tx
            .select({ n: count() })
            .from(sales)
            .where(and(eq(sales.originalSaleId, saleId), eq(sales.type, 'return'), eq(sales.status, 'completed')));
          if (r.n > 0) throw new BadRequestException('This sale has refunds. Void them first');
        }
        amount = toCents(sale.total);
      }
      const shiftId = dto.shiftId ? await this.openShift(tx, dto.shiftId, sale.storeId) : null;
      const [row] = await tx
        .insert(saleRequests)
        .values({
          tenantId: ctx.tenantId,
          saleId,
          kind: dto.kind,
          lines: dto.kind === 'refund' ? dto.lines!.map((l) => ({ lineId: l.lineId, quantity: formatFixed(parseFixed(l.quantity, 3), 3) })) : null,
          method: dto.kind === 'refund' ? dto.method : null,
          restock: dto.restock ?? true,
          reason: dto.reason,
          amount: fromCents(amount),
          currencyCode: sale.currencyCode,
          storeId: sale.storeId,
          deviceId: ctx.deviceId ?? null,
          shiftId,
          requestedBy: ctx.userId,
        })
        .returning();
      await this.audit.log(tx, ctx, `request_${dto.kind}`, 'Sale', saleId, { number: sale.number, amount: fromCents(amount), reason: dto.reason, request: row.id }, { storeId: sale.storeId });
      return this.getIn(tx, row.id);
    });
  }

  /** The requests: everyone's for those who approve them, or the person's own. */
  list(ctx: AuthContext, q: SaleRequestQuery) {
    if (!q.mine && !can(ctx, 'returns.approve')) throw new ForbiddenException("You can see your own requests only");
    return this.dbs.withTenant(ctx, async (tx) => {
      const where: SQL[] = [];
      if (q.mine) where.push(eq(saleRequests.requestedBy, ctx.userId));
      if (q.status === 'decided') where.push(inArray(saleRequests.status, ['approved', 'rejected']));
      else if (q.status) where.push(eq(saleRequests.status, q.status));
      if (q.kind) where.push(eq(saleRequests.kind, q.kind));
      if (q.storeId) where.push(eq(saleRequests.storeId, q.storeId));
      if (q.saleId) where.push(eq(saleRequests.saleId, q.saleId));
      const condition = where.length ? and(...where) : undefined;
      const [{ total }] = await tx.select({ total: count() }).from(saleRequests).where(condition);
      const ids = await tx
        .select({ id: saleRequests.id })
        .from(saleRequests)
        .where(condition)
        // Waiting ones oldest first (first come, first served); decided ones newest first.
        .orderBy(q.status === 'pending' ? sql`${saleRequests.createdAt} ASC` : desc(saleRequests.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const items = await this.describe(tx, ids.map((i) => i.id));
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  get(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const r = await this.getIn(tx, id);
      if (r.requestedBy !== ctx.userId && !can(ctx, 'returns.approve')) throw new ForbiddenException("You can see your own requests only");
      return r;
    });
  }

  /** Makes the refund or void, as the approver, and marks the request approved: all or nothing. */
  approve(ctx: AuthContext, id: string, dto: ApproveDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const r = await this.pendingForDecision(tx, ctx, id);
      let resultId: string;
      if (r.kind === 'refund') {
        // From the cashier's shift if it's still open; otherwise from no shift (it was cashed up already).
        const shiftOpen = r.shiftId ? (await tx.select({ closed: shifts.closedAt }).from(shifts).where(eq(shifts.id, r.shiftId)))[0]?.closed === null : false;
        const ret = await this.salesSvc.createReturnIn(
          tx,
          ctx,
          r.saleId,
          { lines: r.lines!, method: r.method!, reason: r.reason, restock: r.restock, shiftId: shiftOpen ? r.shiftId! : undefined },
          { salespersonId: r.requestedBy ?? undefined },
        );
        resultId = ret.id;
      } else {
        await this.salesSvc.voidSaleIn(tx, ctx, r.saleId);
        resultId = r.saleId;
      }
      await tx
        .update(saleRequests)
        .set({ status: 'approved', decidedBy: ctx.userId, decidedAt: sql`now()`, decisionNote: dto.note ?? null, resultSaleId: resultId })
        .where(eq(saleRequests.id, id));
      await this.audit.log(
        tx,
        ctx,
        `approve_${r.kind}`,
        'Sale request',
        id,
        { sale: r.saleNumber, amount: r.amount, note: dto.note, result: resultId },
        { storeId: r.storeId, old: { status: 'pending' }, new: { status: 'approved' } },
      );
      return this.getIn(tx, id);
    });
  }

  reject(ctx: AuthContext, id: string, dto: RejectDto) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const r = await this.pendingForDecision(tx, ctx, id);
      await tx.update(saleRequests).set({ status: 'rejected', decidedBy: ctx.userId, decidedAt: sql`now()`, decisionNote: dto.note }).where(eq(saleRequests.id, id));
      await this.audit.log(
        tx,
        ctx,
        `reject_${r.kind}`,
        'Sale request',
        id,
        { sale: r.saleNumber, amount: r.amount, note: dto.note },
        { storeId: r.storeId, old: { status: 'pending' }, new: { status: 'rejected' } },
      );
      return this.getIn(tx, id);
    });
  }

  /** The cashier changes their mind. */
  cancel(ctx: AuthContext, id: string) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const r = await this.getIn(tx, id, true);
      if (r.requestedBy !== ctx.userId) throw new ForbiddenException('Only the person who asked can take it back');
      if (r.status !== 'pending') throw new BadRequestException(`This request was already ${r.status}`);
      await tx.update(saleRequests).set({ status: 'cancelled', decidedAt: sql`now()` }).where(eq(saleRequests.id, id));
      await this.audit.log(tx, ctx, `cancel_${r.kind}`, 'Sale request', id, { sale: r.saleNumber }, { storeId: r.storeId });
      return this.getIn(tx, id);
    });
  }

  // -----------------------------------------------------------------------------------

  /** Locks a waiting request for approving or rejecting. Nobody decides their own. */
  private async pendingForDecision(tx: Tx, ctx: AuthContext, id: string) {
    const r = await this.getIn(tx, id, true);
    if (r.status !== 'pending') throw new BadRequestException(`This request was already ${r.status}`);
    if (r.requestedBy === ctx.userId) throw new ForbiddenException('Someone else has to decide your own request');
    return r;
  }

  private async openShift(tx: Tx, shiftId: string, storeId: string) {
    const [s] = await tx.select().from(shifts).where(eq(shifts.id, shiftId)).limit(1);
    if (!s) throw new BadRequestException('Unknown shift');
    if (s.closedAt) throw new BadRequestException(`Shift ${s.number} is closed`);
    if (s.storeId !== storeId) throw new BadRequestException('That shift is for another store');
    return s.id;
  }

  /** What a refund of these lines comes to, checking each can still be returned (as the refund itself will). */
  private async refundAmount(tx: Tx, saleId: string, lines: ReturnLineDto[]) {
    const original = await tx.select().from(saleLines).where(eq(saleLines.saleId, saleId));
    const res = await tx.execute(sql`
      SELECT l.original_line_id, sum(l.quantity)::text AS qty
      FROM sale_lines l JOIN sales s ON s.id = l.sale_id
      WHERE s.original_sale_id = ${saleId} AND s.type = 'return' AND s.status = 'completed'
      GROUP BY l.original_line_id`);
    const returned = new Map((res.rows as { original_line_id: string; qty: string }[]).map((r) => [r.original_line_id, parseFixed(r.qty, 3)]));
    const parts: bigint[] = [];
    for (const r of lines) {
      const o = original.find((l) => l.id === r.lineId);
      if (!o) throw new BadRequestException('That item is not on this sale');
      const q = parseFixed(r.quantity, 3);
      const sold = parseFixed(o.quantity, 3);
      const left = sold - (returned.get(o.id) ?? 0n);
      if (q <= 0n) throw new BadRequestException('Quantities must be more than zero');
      if (q > left) throw new BadRequestException(`Only ${formatFixed(left, 3)} of "${o.productName}" can still be returned`);
      parts.push(divRound(toCents(o.total) * q, sold));
    }
    return sum(parts);
  }

  async getIn(tx: Tx, id: string, lock = false) {
    if (lock) await tx.execute(sql`SELECT 1 FROM sale_requests WHERE id = ${id} FOR UPDATE`);
    const [r] = await this.describe(tx, [id]);
    return found(r, 'Request');
  }

  /** Requests with what a person needs to decide them: the sale, the items, who asked and where. */
  private async describe(tx: Tx, ids: string[]) {
    if (!ids.length) return [];
    const requester = alias(users, 'requester');
    const decider = alias(users, 'decider');
    const result = alias(sales, 'result');
    const rows = await tx
      .select({
        r: saleRequests,
        saleNumber: sales.number,
        saleType: sales.type,
        saleStatus: sales.status,
        saleTotal: sales.total,
        soldAt: sales.soldAt,
        customerName: sales.customerName,
        storeName: stores.name,
        requestedByName: requester.fullName,
        decidedByName: decider.fullName,
        resultNumber: result.number,
      })
      .from(saleRequests)
      .innerJoin(sales, eq(sales.id, saleRequests.saleId))
      .innerJoin(stores, eq(stores.id, saleRequests.storeId))
      .leftJoin(requester, eq(requester.id, saleRequests.requestedBy))
      .leftJoin(decider, eq(decider.id, saleRequests.decidedBy))
      .leftJoin(result, eq(result.id, saleRequests.resultSaleId))
      .where(inArray(saleRequests.id, ids));
    const lineIds = rows.flatMap((x) => (x.r.lines ?? []).map((l) => l.lineId));
    const names = lineIds.length
      ? new Map(
          (
            await tx
              .select({ id: saleLines.id, productName: saleLines.productName, variantName: saleLines.variantName, packName: saleLines.packName })
              .from(saleLines)
              .where(inArray(saleLines.id, lineIds))
          ).map((l) => [l.id, `${l.productName}${l.variantName !== 'Default' ? ` · ${l.variantName}` : ''}${l.packName ? ` (${l.packName})` : ''}`]),
        )
      : new Map<string, string>();
    const byId = new Map(
      rows.map((x) => [
        x.r.id,
        {
          ...x.r,
          lines: x.r.lines?.map((l) => ({ ...l, name: names.get(l.lineId) ?? 'Item' })) ?? null,
          saleNumber: x.saleNumber,
          saleType: x.saleType,
          saleStatus: x.saleStatus,
          saleTotal: x.saleTotal,
          soldAt: x.soldAt,
          customerName: x.customerName,
          storeName: x.storeName,
          requestedByName: x.requestedByName,
          decidedByName: x.decidedByName,
          resultNumber: x.resultNumber,
        },
      ]),
    );
    return ids.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => !!r);
  }
}

// ----- Controllers -----------------------------------------------------------------------

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sales')
export class SaleRequestCreateController {
  constructor(private readonly svc: SaleRequestsService) {}

  /** A cashier asks for a refund or void of this sale. */
  @Roles(...FRONT_OF_HOUSE)
  @Can('returns.request')
  @Post(':id/requests')
  create(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: CreateSaleRequestDto) {
    return this.svc.create(ctx, p.id, dto);
  }
}

@ApiTags('sales')
@ApiBearerAuth()
@Controller('sale-requests')
export class SaleRequestsController {
  constructor(private readonly svc: SaleRequestsService) {}

  @Roles(...FRONT_OF_HOUSE)
  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: SaleRequestQuery) {
    return this.svc.list(ctx, q);
  }

  @Roles(...FRONT_OF_HOUSE)
  @Get(':id')
  get(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.get(ctx, p.id);
  }

  /** Makes the refund or void. From a phone, the approver's PIN confirms it. */
  @Roles(...MANAGERS)
  @Can('returns.approve')
  @HttpCode(200)
  @Post(':id/approve')
  approve(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: ApproveDto) {
    assertPinConfirmed(ctx);
    return this.svc.approve(ctx, p.id, dto);
  }

  @Roles(...MANAGERS)
  @Can('returns.approve')
  @HttpCode(200)
  @Post(':id/reject')
  reject(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: RejectDto) {
    return this.svc.reject(ctx, p.id, dto);
  }

  @Roles(...FRONT_OF_HOUSE)
  @HttpCode(200)
  @Post(':id/cancel')
  cancel(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.cancel(ctx, p.id);
  }
}
