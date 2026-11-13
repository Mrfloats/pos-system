import { Controller, Get, Headers, Injectable, Module, UnauthorizedException } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { sql } from 'drizzle-orm';
import { GRACE_DAYS, Public } from '../common/auth-context.js';
import { EmailsService, type SubscriptionReminder } from '../common/emails.service.js';
import { DbService } from '../db/db.service.js';

/** The "ends soon" email goes this many days before the paid-up date. */
const ENDS_SOON_DAYS = 7;
/** A business locked this many days ago still gets the "locked" email, in case a check was missed. */
const LOCKED_WINDOW_DAYS = 7;

const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Which subscription email a paid-up date calls for today (the business is locked after the grace days). */
export function reminderFor(end: string, today: string): SubscriptionReminder {
  if (today <= end) return 'ends_soon';
  return today <= addDays(end, GRACE_DAYS) ? 'ended' : 'locked';
}

/**
 * Emails that depend on the date rather than on something someone did: subscriptions running
 * out, and live ZIMRA tills whose fiscal day has been open too long. Each email goes once,
 * so it's safe to run as often as you like.
 */
@Injectable()
export class DailyChecksService {
  constructor(
    private readonly dbs: DbService,
    private readonly emails: EmailsService,
  ) {}

  async run(today = new Date().toISOString().slice(0, 10)) {
    const ending = await this.dbs.db.execute(
      sql`SELECT tenant_id, current_period_end::text AS end FROM subscriptions_ending_between(${addDays(today, -(GRACE_DAYS + LOCKED_WINDOW_DAYS))}::date, ${addDays(today, ENDS_SOON_DAYS)}::date)`,
    );
    for (const r of ending.rows as { tenant_id: string; end: string }[]) {
      await this.emails.subscriptionReminder(r.tenant_id, r.end, reminderFor(r.end, today));
    }
    const overdue = await this.dbs.db.execute(sql`SELECT tenant_id, device_id, day_no, opened_at FROM fiscal_days_overdue()`);
    for (const d of overdue.rows as { tenant_id: string; device_id: string; day_no: number | null; opened_at: string | Date }[]) {
      await this.emails.zimraDayOverdue(d.tenant_id, d.device_id, d.day_no, new Date(d.opened_at));
    }
    return { subscriptions: ending.rows.length, fiscalDays: overdue.rows.length };
  }
}

@ApiExcludeController()
@Controller('cron')
export class DailyChecksController {
  constructor(private readonly checks: DailyChecksService) {}

  /**
   * Called once a day by Vercel Cron (apps/api/vercel.json); a long-running server runs the
   * checks itself (main.ts). With CRON_SECRET set, only a caller sending it may run them.
   */
  @Public()
  @Get('daily')
  daily(@Headers('authorization') authorization?: string) {
    const secret = process.env.CRON_SECRET;
    if (secret && authorization !== `Bearer ${secret}`) throw new UnauthorizedException();
    return this.checks.run();
  }
}

@Module({
  controllers: [DailyChecksController],
  providers: [DailyChecksService],
  exports: [DailyChecksService],
})
export class DailyChecksModule {}
