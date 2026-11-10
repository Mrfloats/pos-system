import { Body, Controller, Delete, ForbiddenException, Get, Injectable, Module, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEmail, IsOptional, IsString, IsUUID, Length, MaxLength } from 'class-validator';
import { asc, count, ilike, or, SQL, sql } from 'drizzle-orm';
import { AccountingModule } from '../accounting/accounting.module.js';
import { DocumentQuery } from '../accounting/accounting.dto.js';
import { DocumentsService } from '../accounting/documents.service.js';
import { fromCents, toCents } from '../accounting/money.js';
import { AuditService } from '../common/audit.service.js';
import { type AuthContext, BOOKKEEPERS, Ctx, FRONT_OF_HOUSE, MANAGERS, Roles } from '../common/auth-context.js';
import { Can } from '../common/permissions.js';
import { assertOwned } from '../common/ownership.js';
import { TenantCrud } from '../common/tenant-crud.js';
import { IsMoney, likeEscape, ListQuery, Page, ToDecimalString, Trim } from '../common/validation.js';
import { DbService } from '../db/db.service.js';
import { customerGroups, customers, priceLists } from '../db/schema.js';
import { IdParam } from '../organization/organization.dto.js';

export class CreateCustomerDto {
  @Trim() @IsString() @Length(1, 160) name: string;
  @IsOptional() @Trim() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @Trim() @IsEmail() email?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) address?: string;
  /** Taxpayer Identification Number (needed on fiscal tax invoices). */
  @IsOptional() @Trim() @IsString() @MaxLength(30) tin?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(30) vatNumber?: string;
  /** Wholesale customers: which price list applies to them. */
  @IsOptional() @IsUUID() priceListId?: string | null;
  @IsOptional() @ToDecimalString() @IsMoney() creditLimit?: string | null;
  /** Customer group, e.g. Staff or Schools, which can carry a discount. */
  @IsOptional() @IsUUID() groupId?: string | null;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

export class CustomerQuery extends ListQuery {
  /** Also say what each customer owes on invoices (base currency). For bookkeepers. */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() withBalance?: boolean;
}

/** What a customer still owes on posted invoices, in the base currency. */
const owedSql = sql<string>`coalesce((
  SELECT sum(i.total_base - coalesce((SELECT sum(p.cleared_base) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'posted'), 0))
  FROM invoices i WHERE i.customer_id = "customers"."id" AND i.status = 'posted'
), 0)::text`;

@Injectable()
export class CustomersService extends TenantCrud<typeof customers> {
  constructor(
    dbs: DbService,
    audit: AuditService,
    private readonly documents: DocumentsService,
  ) {
    super(dbs, audit, customers, { entity: 'Customer', orderBy: [customers.name] });
  }

  /**
   * A customer at a glance: what they owe and their credit limit, unpaid
   * invoices (oldest due first), and what they've spent at the tills.
   */
  async summary(ctx: AuthContext, id: string) {
    const customer = await this.get(ctx, id);
    const [unpaid, stats] = await Promise.all([
      this.documents.listDocuments(ctx, 'invoice', { customerId: id, status: 'unpaid', page: 1, pageSize: 50 } as DocumentQuery),
      this.dbs.withTenant(ctx, async (tx) => {
        const today = await this.documents.today(tx);
        const res = await tx.execute(sql`
          SELECT
            (SELECT count(*)::int FROM sales WHERE customer_id = ${id} AND status = 'completed' AND type = 'sale') AS sales,
            (SELECT coalesce(sum(CASE WHEN type = 'sale' THEN total_base ELSE -total_base END), 0)::text FROM sales
               WHERE customer_id = ${id} AND status = 'completed' AND type IN ('sale', 'return')) AS spent,
            (SELECT max(sold_at) FROM sales WHERE customer_id = ${id} AND status = 'completed' AND type = 'sale') AS last_sale_at,
            (SELECT coalesce(sum(owed), 0)::text FROM (
               SELECT i.total_base - coalesce((SELECT sum(p.cleared_base) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'posted'), 0) AS owed, i.due_date
               FROM invoices i WHERE i.customer_id = ${id} AND i.status = 'posted') x WHERE owed > 0) AS owed,
            (SELECT coalesce(sum(owed), 0)::text FROM (
               SELECT i.total_base - coalesce((SELECT sum(p.cleared_base) FROM payments p WHERE p.invoice_id = i.id AND p.status = 'posted'), 0) AS owed, i.due_date
               FROM invoices i WHERE i.customer_id = ${id} AND i.status = 'posted') x WHERE owed > 0 AND due_date < ${today}) AS overdue`);
        return res.rows[0] as { sales: number; spent: string; last_sale_at: string | null; owed: string; overdue: string };
      }),
    ]);
    const owed = toCents(stats.owed);
    return {
      ...customer,
      owed: fromCents(owed),
      overdue: fromCents(toCents(stats.overdue)),
      /** Credit left before the limit, when there is one. */
      creditLeft: customer.creditLimit === null ? null : fromCents(toCents(customer.creditLimit) - owed),
      salesCount: stats.sales,
      spent: fromCents(toCents(stats.spent)),
      lastSaleAt: stats.last_sale_at,
      unpaidInvoices: [...unpaid.items].sort((a, b) => (a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0)),
    };
  }

  page(ctx: AuthContext, q: CustomerQuery): Promise<Page<typeof customers.$inferSelect & { owed?: string }>> {
    return this.dbs.withTenant(ctx, async (tx) => {
      let where: SQL | undefined;
      if (q.search) {
        const p = likeEscape(q.search);
        where = or(ilike(customers.name, p), ilike(customers.phone, p), ilike(customers.email, p), ilike(customers.tin, p));
      }
      const [{ total }] = await tx.select({ total: count() }).from(customers).where(where);
      const rows = await tx
        .select({ customer: customers, owed: q.withBalance ? owedSql : sql<null>`NULL` })
        .from(customers)
        .where(where)
        .orderBy(asc(customers.name))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize);
      const items = rows.map((r) => (q.withBalance ? { ...r.customer, owed: fromCents(toCents(r.owed ?? '0')) } : r.customer));
      return { items, total, page: q.page, pageSize: q.pageSize };
    });
  }

  override async create(ctx: AuthContext, dto: CreateCustomerDto) {
    await this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, priceLists, [dto.priceListId], 'price list');
      await assertOwned(tx, customerGroups, [dto.groupId], 'customer group');
    });
    return super.create(ctx, dto);
  }

  override async update(ctx: AuthContext, id: string, dto: UpdateCustomerDto) {
    await this.dbs.withTenant(ctx, async (tx) => {
      await assertOwned(tx, priceLists, [dto.priceListId], 'price list');
      await assertOwned(tx, customerGroups, [dto.groupId], 'customer group');
    });
    return super.update(ctx, id, dto);
  }

  deactivate(ctx: AuthContext, id: string) {
    return super.update(ctx, id, { active: false });
  }
}

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  @Can('customers.view')
  @Get()
  list(@Ctx() ctx: AuthContext, @Query() q: CustomerQuery) {
    if (q.withBalance && !BOOKKEEPERS.includes(ctx.role)) throw new ForbiddenException('Your role cannot see what customers owe');
    return this.svc.page(ctx, q);
  }

  /** What the customer owes and has spent, with unpaid invoices. Money, so bookkeepers only. */
  @Roles(...BOOKKEEPERS)
  @Can('customers.view')
  @Get(':id/summary')
  summary(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.summary(ctx, p.id);
  }

  @Can('customers.view')
  @Get(':id')
  get(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.get(ctx, p.id);
  }

  /** Cashiers can add customers at the till (e.g. buyer details for a tax invoice). */
  @Roles(...FRONT_OF_HOUSE)
  @Can('customers.edit')
  @Post()
  create(@Ctx() ctx: AuthContext, @Body() dto: CreateCustomerDto) {
    return this.svc.create(ctx, dto);
  }

  @Roles(...FRONT_OF_HOUSE)
  @Can('customers.edit')
  @Patch(':id')
  update(@Ctx() ctx: AuthContext, @Param() p: IdParam, @Body() dto: UpdateCustomerDto) {
    return this.svc.update(ctx, p.id, dto);
  }

  @Roles(...MANAGERS)
  @Can('customers.edit')
  @Delete(':id')
  deactivate(@Ctx() ctx: AuthContext, @Param() p: IdParam) {
    return this.svc.deactivate(ctx, p.id);
  }
}

@Module({
  imports: [AccountingModule],
  controllers: [CustomersController],
  providers: [CustomersService],
})
export class CustomersModule {}
