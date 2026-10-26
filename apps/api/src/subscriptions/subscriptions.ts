import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { AuthModule } from '../auth/auth.module.js';
import { AuthService } from '../auth/auth.service.js';
import { BILLING_PERIODS, type BillingPeriod } from '../auth/auth.dto.js';
import { AuditService } from '../common/audit.service.js';
import { AllowLapsed, type AuthContext, Ctx, GRACE_DAYS, type PlatformContext, PlatformCtx, PlatformOnly } from '../common/auth-context.js';
import { IsMoney, ToDecimalString, Trim } from '../common/validation.js';
import { DbService, Tx } from '../db/db.service.js';
import { memberships, plans, signupRequests, stores, subscriptionPayments, tenants, users } from '../db/schema.js';
import { IdParam } from '../organization/organization.dto.js';

// ----- Dates --------------------------------------------------------------------------

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const todayUtc = () => new Date().toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** The last day covered by one billing period starting on `start`. */
export function periodEnd(start: string, period: BillingPeriod) {
  const d = new Date(`${start}T00:00:00Z`);
  if (period === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Where a subscription stands, in words the screens use. */
export function subscriptionState(status: string, end: string | null, today = todayUtc()) {
  if (status !== 'active') return status as 'suspended' | 'cancelled';
  if (!end) return 'complimentary' as const;
  if (today <= end) return 'active' as const;
  if (daysBetween(end, today) <= GRACE_DAYS) return 'grace' as const;
  return 'lapsed' as const;
}

// ----- Plan limits ------------------------------------------------------------------------

/**
 * Refuses another store or staff member when the business's plan is full.
 * Run inside DbService.withTenant. Businesses with no plan have no limits.
 */
export async function assertPlanAllows(tx: Tx, kind: 'stores' | 'staff') {
  const [row] = await tx
    .select({ name: plans.name, maxStores: plans.maxStores, maxStaff: plans.maxStaff })
    .from(tenants)
    .innerJoin(plans, eq(plans.id, tenants.planId))
    .limit(1);
  const limit = kind === 'stores' ? row?.maxStores : row?.maxStaff;
  if (!row || limit == null) return;
  const [{ n }] =
    kind === 'stores'
      ? await tx.select({ n: count() }).from(stores).where(eq(stores.active, true))
      : await tx.select({ n: count() }).from(memberships).where(eq(memberships.active, true));
  if (n >= limit) {
    throw new ForbiddenException(
      `Your ${row.name} plan allows ${limit} ${kind === 'stores' ? (limit === 1 ? 'store' : 'stores') : 'staff'}. Ask Floatly to move you to a bigger plan.`,
    );
  }
}

// ----- DTOs ---------------------------------------------------------------------------------

export class PlanDto {
  @Trim() @IsString() @Matches(/^[a-z0-9-]{2,30}$/, { message: 'code must be lowercase letters, digits or dashes' }) code: string;
  @Trim() @IsString() @Length(1, 60) name: string;
  @IsOptional() @Trim() @IsString() @MaxLength(200) description?: string;
  @ToDecimalString() @IsMoney() monthlyPrice: string;
  @ToDecimalString() @IsMoney() yearlyPrice: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxStores?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxStaff?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @Length(1, 80, { each: true }) features?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class UpdatePlanDto {
  @IsOptional() @Trim() @IsString() @Length(1, 60) name?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(200) description?: string;
  @IsOptional() @ToDecimalString() @IsMoney() monthlyPrice?: string;
  @IsOptional() @ToDecimalString() @IsMoney() yearlyPrice?: string;
  @IsOptional() @Matches(/^[A-Z]{3}$/) currency?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxStores?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) maxStaff?: number | null;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @Length(1, 80, { each: true }) features?: string[];
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() sortOrder?: number;
}

export class PaymentInputDto {
  @ToDecimalString() @IsMoney() amount: string;
  /** EcoCash, bank transfer, cash… */
  @Trim() @IsString() @Length(1, 40) method: string;
  @IsOptional() @Trim() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) note?: string;
}

export class ApproveRequestDto {
  /** Defaults to what the applicant chose. */
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsIn(BILLING_PERIODS) billingPeriod?: BillingPeriod;
  /** First day of the first period; defaults to today. */
  @IsOptional() @Matches(DAY) startDate?: string;
  /** Leave out when the first payment hasn't come in yet. */
  @IsOptional() @ValidateNested() @Type(() => PaymentInputDto) payment?: PaymentInputDto;
}

export class RejectRequestDto {
  /** Shown to the applicant when they try to sign in. */
  @Trim() @IsString() @Length(1, 300) reason: string;
}

export class RecordPaymentDto extends PaymentInputDto {
  /** Switch plan or billing period with this payment. */
  @IsOptional() @IsUUID() planId?: string;
  @IsOptional() @IsIn(BILLING_PERIODS) billingPeriod?: BillingPeriod;
}

export class UpdateSubscriptionDto {
  @IsOptional() @IsUUID() planId?: string | null;
  @IsOptional() @IsIn(BILLING_PERIODS) billingPeriod?: BillingPeriod;
  @IsOptional() @IsIn(['active', 'suspended', 'cancelled']) status?: 'active' | 'suspended' | 'cancelled';
  /** Paid up to; null for no end date (complimentary). */
  @IsOptional() @Matches(DAY) currentPeriodEnd?: string | null;
}

export class RequestQuery {
  @IsOptional() @IsIn(['pending', 'approved', 'rejected']) status?: 'pending' | 'approved' | 'rejected';
}

// ----- Service ----------------------------------------------------------------------------

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly dbs: DbService,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
  ) {}

  /** A business's own subscription: plan, paid-up date, payments, and the plans on offer. */
  mine(ctx: AuthContext) {
    return this.dbs.withTenant(ctx, async (tx) => {
      const [t] = await tx
        .select({
          planId: tenants.planId,
          billingPeriod: tenants.billingPeriod,
          status: tenants.subscriptionStatus,
          currentPeriodEnd: tenants.currentPeriodEnd,
        })
        .from(tenants)
        .limit(1);
      const [plan] = t.planId ? await tx.select().from(plans).where(eq(plans.id, t.planId)) : [];
      const payments = await tx.select().from(subscriptionPayments).orderBy(desc(subscriptionPayments.periodEnd)).limit(24);
      const today = todayUtc();
      const state = subscriptionState(t.status, t.currentPeriodEnd, today);
      return {
        ...t,
        state,
        plan: plan ?? null,
        daysLeft: t.currentPeriodEnd ? daysBetween(today, t.currentPeriodEnd) : null,
        graceEnds: t.currentPeriodEnd ? addDays(t.currentPeriodEnd, GRACE_DAYS) : null,
        payments,
        plans: await this.auth.plans(),
      };
    });
  }

  // ----- Platform: plans ----------------------------------------------------------------

  private asAdmin<T>(ctx: PlatformContext, fn: (tx: Tx) => Promise<T>) {
    return this.dbs.withUser(ctx.userId, fn);
  }

  allPlans(ctx: PlatformContext) {
    return this.asAdmin(ctx, (tx) => tx.select().from(plans).orderBy(asc(plans.sortOrder), asc(plans.monthlyPrice)));
  }

  createPlan(ctx: PlatformContext, dto: PlanDto) {
    return this.asAdmin(ctx, async (tx) => (await tx.insert(plans).values({ ...dto, features: dto.features ?? [] }).returning())[0]);
  }

  updatePlan(ctx: PlatformContext, id: string, dto: UpdatePlanDto) {
    return this.asAdmin(ctx, async (tx) => {
      const [row] = await tx.update(plans).set(dto).where(eq(plans.id, id)).returning();
      if (!row) throw new NotFoundException('Plan not found');
      return row;
    });
  }

  // ----- Platform: sign-up requests ------------------------------------------------------

  requests(ctx: PlatformContext, q: RequestQuery) {
    // Every column except the password hash, which never leaves the database.
    return this.asAdmin(ctx, (tx) =>
      tx
        .select({
          id: signupRequests.id,
          businessName: signupRequests.businessName,
          businessType: signupRequests.businessType,
          country: signupRequests.country,
          baseCurrency: signupRequests.baseCurrency,
          fullName: signupRequests.fullName,
          email: signupRequests.email,
          phone: signupRequests.phone,
          planId: signupRequests.planId,
          planName: plans.name,
          billingPeriod: signupRequests.billingPeriod,
          price: sql<string>`CASE WHEN ${signupRequests.billingPeriod} = 'yearly' THEN ${plans.yearlyPrice} ELSE ${plans.monthlyPrice} END`,
          currency: plans.currency,
          message: signupRequests.message,
          status: signupRequests.status,
          decisionNote: signupRequests.decisionNote,
          tenantId: signupRequests.tenantId,
          reviewedAt: signupRequests.reviewedAt,
          reviewedBy: users.fullName,
          createdAt: signupRequests.createdAt,
        })
        .from(signupRequests)
        .innerJoin(plans, eq(plans.id, signupRequests.planId))
        .leftJoin(users, eq(users.id, signupRequests.reviewedBy))
        .where(q.status ? eq(signupRequests.status, q.status) : undefined)
        .orderBy(desc(signupRequests.createdAt))
        .limit(200),
    );
  }

  /** Creates the business and its owner's login from a request, and starts its subscription. All or nothing. */
  approve(ctx: PlatformContext, id: string, dto: ApproveRequestDto) {
    return this.dbs.db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.user_id', ${ctx.userId}, true)`);
      const [r] = await tx.select().from(signupRequests).where(eq(signupRequests.id, id)).for('update').limit(1);
      if (!r) throw new NotFoundException('Request not found');
      if (r.status !== 'pending') throw new BadRequestException(`This request was already ${r.status}`);
      const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.email, r.email)).limit(1);
      if (taken) throw new ConflictException(`${r.email} already has a Floatly login. Turn this request down and add them as staff instead.`);
      const planId = dto.planId ?? r.planId;
      const period = dto.billingPeriod ?? r.billingPeriod;
      const [plan] = await tx.select().from(plans).where(eq(plans.id, planId)).limit(1);
      if (!plan) throw new BadRequestException('Unknown plan');

      const { tenantId } = await this.auth.createBusinessIn(tx, { ...r, phone: r.phone, passwordHash: r.passwordHash });
      const start = dto.startDate ?? todayUtc();
      const end = periodEnd(start, period);
      await tx.update(tenants).set({ planId, billingPeriod: period, subscriptionStatus: 'active', currentPeriodEnd: end }).where(eq(tenants.id, tenantId));
      if (dto.payment) {
        await tx.insert(subscriptionPayments).values({
          tenantId,
          planId,
          billingPeriod: period,
          amount: dto.payment.amount,
          currency: plan.currency,
          method: dto.payment.method,
          reference: dto.payment.reference ?? null,
          note: dto.payment.note ?? null,
          periodStart: start,
          periodEnd: end,
          recordedBy: ctx.userId,
        });
      }
      await tx.update(signupRequests).set({ status: 'approved', tenantId, reviewedBy: ctx.userId, reviewedAt: new Date() }).where(eq(signupRequests.id, id));
      await this.audit.log(tx, { tenantId, userId: ctx.userId }, 'approve_signup', 'Business', tenantId, { plan: plan.name, period, paidUntil: end });
      return { tenantId, businessName: r.businessName, plan: plan.name, billingPeriod: period, currentPeriodEnd: end };
    });
  }

  reject(ctx: PlatformContext, id: string, dto: RejectRequestDto) {
    return this.asAdmin(ctx, async (tx) => {
      const [r] = await tx
        .update(signupRequests)
        .set({ status: 'rejected', decisionNote: dto.reason, reviewedBy: ctx.userId, reviewedAt: new Date() })
        .where(and(eq(signupRequests.id, id), eq(signupRequests.status, 'pending')))
        .returning({ id: signupRequests.id, businessName: signupRequests.businessName });
      if (!r) throw new BadRequestException('This request is not waiting for a decision');
      return r;
    });
  }

  // ----- Platform: one business's subscription --------------------------------------------

  private asAdminIn<T>(ctx: PlatformContext, tenantId: string, fn: (tx: Tx) => Promise<T>) {
    return this.dbs.withTenant({ tenantId, userId: ctx.userId }, async (tx) => {
      const [t] = await tx.select({ id: tenants.id }).from(tenants).limit(1);
      if (!t) throw new NotFoundException('Business not found');
      return fn(tx);
    });
  }

  subscriptionOf(ctx: PlatformContext, tenantId: string) {
    return this.asAdminIn(ctx, tenantId, async (tx) => {
      const [t] = await tx
        .select({ planId: tenants.planId, billingPeriod: tenants.billingPeriod, status: tenants.subscriptionStatus, currentPeriodEnd: tenants.currentPeriodEnd })
        .from(tenants);
      const payments = await tx
        .select({ payment: subscriptionPayments, planName: plans.name, recordedBy: users.fullName })
        .from(subscriptionPayments)
        .leftJoin(plans, eq(plans.id, subscriptionPayments.planId))
        .leftJoin(users, eq(users.id, subscriptionPayments.recordedBy))
        .where(eq(subscriptionPayments.tenantId, tenantId))
        .orderBy(desc(subscriptionPayments.periodEnd));
      return {
        ...t,
        state: subscriptionState(t.status, t.currentPeriodEnd),
        payments: payments.map((p) => ({ ...p.payment, planName: p.planName, recordedBy: p.recordedBy })),
      };
    });
  }

  /** A payment extends the paid-up date by one period, from where it ends now (or today, if it already ended). */
  recordPayment(ctx: PlatformContext, tenantId: string, dto: RecordPaymentDto) {
    return this.asAdminIn(ctx, tenantId, async (tx) => {
      const [t] = await tx.select().from(tenants);
      const planId = dto.planId ?? t.planId;
      const period = dto.billingPeriod ?? t.billingPeriod ?? 'monthly';
      if (!planId) throw new BadRequestException('Choose a plan for this business first');
      const [plan] = await tx.select().from(plans).where(eq(plans.id, planId)).limit(1);
      if (!plan) throw new BadRequestException('Unknown plan');
      const today = todayUtc();
      const start = t.currentPeriodEnd && t.currentPeriodEnd >= today ? addDays(t.currentPeriodEnd, 1) : today;
      const end = periodEnd(start, period);
      await tx.insert(subscriptionPayments).values({
        tenantId,
        planId,
        billingPeriod: period,
        amount: dto.amount,
        currency: plan.currency,
        method: dto.method,
        reference: dto.reference ?? null,
        note: dto.note ?? null,
        periodStart: start,
        periodEnd: end,
        recordedBy: ctx.userId,
      });
      await tx.update(tenants).set({ planId, billingPeriod: period, subscriptionStatus: 'active', currentPeriodEnd: end }).where(eq(tenants.id, tenantId));
      await this.audit.log(tx, { tenantId, userId: ctx.userId }, 'subscription_payment', 'Business', tenantId, { amount: dto.amount, paidUntil: end });
      return { periodStart: start, periodEnd: end };
    });
  }

  updateSubscription(ctx: PlatformContext, tenantId: string, dto: UpdateSubscriptionDto) {
    return this.asAdminIn(ctx, tenantId, async (tx) => {
      const changes: Partial<typeof tenants.$inferInsert> = {};
      if (dto.planId !== undefined) changes.planId = dto.planId;
      if (dto.billingPeriod) changes.billingPeriod = dto.billingPeriod;
      if (dto.status) changes.subscriptionStatus = dto.status;
      if (dto.currentPeriodEnd !== undefined) changes.currentPeriodEnd = dto.currentPeriodEnd;
      if (!Object.keys(changes).length) throw new BadRequestException('Nothing to change');
      await tx.update(tenants).set(changes).where(eq(tenants.id, tenantId));
      await this.audit.log(tx, { tenantId, userId: ctx.userId }, 'subscription_change', 'Business', tenantId, dto);
      return { ok: true };
    });
  }

  /** Every business's subscription and the plans, for the console's lists and totals. */
  async overview(ctx: PlatformContext) {
    return this.asAdmin(ctx, async (tx) => {
      const subs = (await tx.execute(sql`SELECT platform_subscriptions() AS data`)).rows[0]?.data as {
        tenantId: string;
        planId: string | null;
        billingPeriod: BillingPeriod | null;
        status: string;
        currentPeriodEnd: string | null;
      }[];
      const all = await tx.select().from(plans);
      const [{ pending }] = await tx.select({ pending: count() }).from(signupRequests).where(eq(signupRequests.status, 'pending'));
      const byPlan = new Map(all.map((p) => [p.id, p]));
      const today = todayUtc();
      const rows = subs.map((s) => ({ ...s, state: subscriptionState(s.status, s.currentPeriodEnd, today), planName: s.planId ? (byPlan.get(s.planId)?.name ?? null) : null }));
      // Monthly recurring revenue: paying businesses, yearly plans spread over 12 months.
      const mrr: Record<string, number> = {};
      for (const s of rows) {
        const p = s.planId ? byPlan.get(s.planId) : undefined;
        if (!p || !['active', 'grace'].includes(s.state)) continue;
        const monthly = s.billingPeriod === 'yearly' ? Number(p.yearlyPrice) / 12 : Number(p.monthlyPrice);
        mrr[p.currency] = (mrr[p.currency] ?? 0) + monthly;
      }
      return {
        subscriptions: rows,
        pendingRequests: pending,
        mrr: Object.entries(mrr).map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })),
        endingSoon: rows.filter((s) => s.state === 'active' && s.currentPeriodEnd && daysBetween(today, s.currentPeriodEnd) <= 7).length,
        lapsed: rows.filter((s) => ['grace', 'lapsed'].includes(s.state)).length,
      };
    });
  }
}

// ----- Controllers -----------------------------------------------------------------------

@ApiTags('subscription')
@ApiBearerAuth()
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly svc: SubscriptionsService) {}

  /** The business's own subscription. Reachable while lapsed, so it can see what to renew. */
  @AllowLapsed()
  @Get()
  mine(@Ctx() ctx: AuthContext) {
    return this.svc.mine(ctx);
  }
}

@ApiTags('platform')
@ApiBearerAuth()
@PlatformOnly()
@Controller('platform')
export class PlatformBillingController {
  constructor(private readonly svc: SubscriptionsService) {}

  @Get('billing')
  overview(@PlatformCtx() ctx: PlatformContext) {
    return this.svc.overview(ctx);
  }

  @Get('plans')
  plans(@PlatformCtx() ctx: PlatformContext) {
    return this.svc.allPlans(ctx);
  }

  @Post('plans')
  createPlan(@PlatformCtx() ctx: PlatformContext, @Body() dto: PlanDto) {
    return this.svc.createPlan(ctx, dto);
  }

  @Patch('plans/:id')
  updatePlan(@PlatformCtx() ctx: PlatformContext, @Param() p: IdParam, @Body() dto: UpdatePlanDto) {
    return this.svc.updatePlan(ctx, p.id, dto);
  }

  @Get('requests')
  requests(@PlatformCtx() ctx: PlatformContext, @Query() q: RequestQuery) {
    return this.svc.requests(ctx, q);
  }

  @Post('requests/:id/approve')
  approve(@PlatformCtx() ctx: PlatformContext, @Param() p: IdParam, @Body() dto: ApproveRequestDto) {
    return this.svc.approve(ctx, p.id, dto);
  }

  @Post('requests/:id/reject')
  reject(@PlatformCtx() ctx: PlatformContext, @Param() p: IdParam, @Body() dto: RejectRequestDto) {
    return this.svc.reject(ctx, p.id, dto);
  }

  @Get('businesses/:id/subscription')
  subscription(@PlatformCtx() ctx: PlatformContext, @Param() p: IdParam) {
    return this.svc.subscriptionOf(ctx, p.id);
  }

  @Post('businesses/:id/payments')
  pay(@PlatformCtx() ctx: PlatformContext, @Param() p: IdParam, @Body() dto: RecordPaymentDto) {
    return this.svc.recordPayment(ctx, p.id, dto);
  }

  @Patch('businesses/:id/subscription')
  update(@PlatformCtx() ctx: PlatformContext, @Param() p: IdParam, @Body() dto: UpdateSubscriptionDto) {
    return this.svc.updateSubscription(ctx, p.id, dto);
  }
}

@Module({
  imports: [AuthModule],
  controllers: [SubscriptionController, PlatformBillingController],
  providers: [SubscriptionsService],
})
export class SubscriptionsModule {}
