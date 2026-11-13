import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DbService } from '../db/db.service.js';
import { devices, memberships, sentEmails, stores, tenants, users } from '../db/schema.js';
import { GRACE_DAYS, type Role } from './auth-context.js';
import { LOCK_MINUTES, MAX_FAILURES } from './lockout.js';
import { type Mail, MailService, webUrl } from './mail.service.js';

export interface Person {
  email: string;
  fullName: string;
}

/** What an email says: paragraphs, an optional button, and small print under it. */
export interface Message {
  subject: string;
  lines: string[];
  button?: { label: string; url: string };
  after?: string[];
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const firstName = (p: Person) => p.fullName.trim().split(/\s+/)[0] || p.fullName;

/** The same message as plain text and as simple HTML, greeting the person by first name. */
export function render(to: Person, m: Message): Mail {
  const hello = `Hello ${firstName(to)},`;
  const text = [hello, ...m.lines, ...(m.button ? [`${m.button.label}: ${m.button.url}`] : []), ...(m.after ?? []), 'Floatly'].join('\n\n');
  const p = (s: string, style = '') => `<p style="margin:0 0 14px${style}">${escapeHtml(s).replace(/\n/g, '<br>')}</p>`;
  const button = m.button
    ? `<p style="margin:22px 0"><a href="${escapeHtml(m.button.url)}" style="display:inline-block;background:#166534;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${escapeHtml(m.button.label)}</a></p>` +
      p(`Or open ${m.button.url}`, ';color:#52606d;font-size:13px;word-break:break-all')
    : '';
  const html =
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.5;color:#1f2933;max-width:520px">` +
    p(hello) +
    m.lines.map((l) => p(l)).join('') +
    button +
    (m.after ?? []).map((l) => p(l, ';color:#52606d;font-size:13px')).join('') +
    p('Floatly', ';color:#52606d') +
    `</div>`;
  return { to: to.email, subject: m.subject, text, html };
}

/** "Friday, 20 November 2026". */
export const longDate = (day: string) =>
  new Date(`${day.slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const addDays = (day: string, n: number) => {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);

const ROLE: Record<Role, string> = {
  owner: 'owner',
  admin: 'admin',
  manager: 'manager',
  cashier: 'cashier',
  waiter: 'waiter',
  stock_clerk: 'stock clerk',
  accountant: 'accountant',
};
const aRole = (r: Role) => `${/^[aeiou]/.test(ROLE[r]) ? 'an' : 'a'} ${ROLE[r]}`;
const BUSINESS_KIND: Record<string, string> = { retail: 'a shop', wholesale: 'a wholesaler', restaurant: 'a restaurant', mixed: 'a wholesale and retail business' };

export type SubscriptionReminder = 'ends_soon' | 'ended' | 'locked';

/**
 * The emails Floatly sends when something serious happens: a business approved or turned
 * down, its subscription paid, changed or running out, a password changed or a login
 * locked, someone given access, a till set up, a ZIMRA problem. Day-to-day matters stay in
 * the phone app's notifications.
 *
 * The action has already happened when these go, so they never throw: a failure is logged.
 */
@Injectable()
export class EmailsService {
  private readonly log = new Logger('Emails');

  constructor(
    private readonly dbs: DbService,
    private readonly mail: MailService,
  ) {}

  // ----- Plumbing -------------------------------------------------------------------------

  /** Emails each person; returns how many went. */
  private async notify(people: Person[], build: (to: Person) => Message) {
    let sent = 0;
    for (const to of people) {
      try {
        await this.mail.send(render(to, build(to)));
        sent++;
      } catch (err) {
        this.log.warn(`Couldn't email ${to.email}: ${(err as Error).message}`);
      }
    }
    return sent;
  }

  private async safely(what: string, fn: () => Promise<unknown>) {
    try {
      await fn();
    } catch (err) {
      this.log.error(`The "${what}" email failed: ${(err as Error).message}`);
    }
  }

  /** Sends only the first time for `key`. If none of it went, the key is freed to try again later. */
  private async once(key: string, fn: () => Promise<{ sent: number; of: number }>) {
    const [claimed] = await this.dbs.db.insert(sentEmails).values({ key }).onConflictDoNothing().returning({ key: sentEmails.key });
    if (!claimed) return;
    let result = { sent: 0, of: 1 };
    try {
      result = await fn();
    } finally {
      if (result.of > 0 && result.sent === 0) await this.dbs.db.delete(sentEmails).where(eq(sentEmails.key, key));
    }
  }

  /** The business's name and time zone, and its active owners. */
  private business(tenantId: string) {
    return this.dbs.withTenant({ tenantId }, async (tx) => {
      const [t] = await tx.select({ name: tenants.name, tz: tenants.timezone }).from(tenants).limit(1);
      const owners = await tx
        .select({ email: users.email, fullName: users.fullName })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.role, 'owner'), eq(memberships.active, true)));
      return { name: t?.name ?? 'your business', tz: t?.tz ?? 'UTC', owners };
    });
  }

  private async person(userId: string): Promise<Person | undefined> {
    const [u] = await this.dbs.db.select({ email: users.email, fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
    return u;
  }

  private async nameOf(userId: string | null | undefined) {
    return (userId && (await this.person(userId))?.fullName) || 'Someone';
  }

  private till(tenantId: string, deviceId: string) {
    return this.dbs.withTenant({ tenantId }, async (tx) => {
      const [d] = await tx
        .select({ name: devices.name, code: devices.code, store: stores.name })
        .from(devices)
        .innerJoin(stores, eq(stores.id, devices.storeId))
        .where(eq(devices.id, deviceId))
        .limit(1);
      return d;
    });
  }

  // ----- Opening a business ---------------------------------------------------------------

  signupReceived(r: Person & { businessName: string }) {
    return this.safely('sign-up received', () =>
      this.notify([r], () => ({
        subject: `We received your request for ${r.businessName}`,
        lines: [
          `Thank you for choosing Floatly. We've received your request to open ${r.businessName}.`,
          "Floatly checks every new business before it opens. We'll email you here as soon as it's approved; you'll then sign in with this email and the password you chose.",
        ],
      })),
    );
  }

  /** To Floatly's own staff. */
  signupWaiting(r: Person & { businessName: string; businessType: string; phone?: string | null; planName: string; billingPeriod: string }) {
    return this.safely('sign-up waiting', async () => {
      const admins = await this.dbs.db.select({ email: users.email, fullName: users.fullName }).from(users).where(eq(users.isPlatformAdmin, true));
      await this.notify(admins, () => ({
        subject: `New business waiting for approval: ${r.businessName}`,
        lines: [
          `${r.fullName} (${r.email}${r.phone ? `, ${r.phone}` : ''}) asked to open ${r.businessName}, ${BUSINESS_KIND[r.businessType] ?? 'a business'}, on the ${r.planName} plan, paid ${r.billingPeriod}.`,
        ],
        button: { label: 'Review the request', url: `${webUrl()}/platform/requests` },
      }));
    });
  }

  signupApproved(r: Person & { businessName: string; planName: string; currentPeriodEnd: string | null }) {
    return this.safely('sign-up approved', () =>
      this.notify([r], () => ({
        subject: `${r.businessName} is ready on Floatly`,
        lines: [
          `Good news: Floatly has approved ${r.businessName}. You can sign in now with this email (${r.email}) and the password you chose when you asked.`,
          r.currentPeriodEnd ? `Your plan is ${r.planName}, paid up to ${longDate(r.currentPeriodEnd)}.` : `Your plan is ${r.planName}.`,
        ],
        button: { label: 'Sign in', url: `${webUrl()}/login` },
        after: ['Forgotten the password? Use "Forgot password?" on the sign-in page.'],
      })),
    );
  }

  signupRejected(r: Person & { businessName: string; reason: string }) {
    return this.safely('sign-up turned down', () =>
      this.notify([r], () => ({
        subject: `About your Floatly request for ${r.businessName}`,
        lines: [`Floatly couldn't approve ${r.businessName} this time.`, `The reason: ${r.reason}`, 'If you have questions, or something has changed, reply to this email.'],
      })),
    );
  }

  // ----- Subscriptions (to the owners) ----------------------------------------------------

  paymentRecorded(tenantId: string, p: { amount: string; currency: string; method: string; reference?: string | null; planName: string; periodEnd: string }) {
    return this.safely('payment recorded', async () => {
      const b = await this.business(tenantId);
      await this.notify(b.owners, () => ({
        subject: `Payment received for ${b.name}: ${p.currency} ${p.amount}`,
        lines: [
          `Floatly has recorded your payment of ${p.currency} ${p.amount} (${p.method}${p.reference ? `, reference ${p.reference}` : ''}). Thank you.`,
          `${b.name} is on the ${p.planName} plan, paid up to ${longDate(p.periodEnd)}.`,
        ],
        button: { label: 'See your subscription', url: `${webUrl()}/subscription` },
      }));
    });
  }

  subscriptionStatusChanged(tenantId: string, status: 'active' | 'suspended' | 'cancelled') {
    return this.safely('subscription status', async () => {
      const b = await this.business(tenantId);
      const message: Message =
        status === 'suspended'
          ? {
              subject: `${b.name} is suspended on Floatly`,
              lines: [`Floatly has suspended ${b.name}. Until it's restored, you and your staff can't use Floatly for this business. Nothing is lost.`, 'Reply to this email to sort it out.'],
            }
          : status === 'cancelled'
            ? {
                subject: `${b.name}'s Floatly subscription was cancelled`,
                lines: [`Floatly has cancelled the subscription for ${b.name}, so you and your staff can no longer use Floatly for it.`, 'If this is a mistake, reply to this email.'],
              }
            : {
                subject: `${b.name} is open again on Floatly`,
                lines: [`Floatly has restored ${b.name}. You and your staff can use it again as usual.`],
                button: { label: 'Sign in', url: `${webUrl()}/login` },
              };
      await this.notify(b.owners, () => message);
    });
  }

  /** Before and after the paid-up date runs out. Each goes once per business and paid-up date. */
  subscriptionReminder(tenantId: string, end: string, kind: SubscriptionReminder) {
    return this.safely(`subscription ${kind}`, () =>
      this.once(`subscription-${kind}:${tenantId}:${end}`, async () => {
        const b = await this.business(tenantId);
        const lastDay = addDays(end, GRACE_DAYS);
        const message: Message =
          kind === 'ends_soon'
            ? {
                subject: `${b.name}: your Floatly subscription ends on ${longDate(end)}`,
                lines: [
                  `${b.name} is paid up to ${longDate(end)}. Renew before then to keep everything running.`,
                  `If it isn't renewed, you'll have ${GRACE_DAYS} more days before ${b.name} is locked.`,
                  'Reply to this email to arrange payment.',
                ],
                button: { label: 'See your subscription', url: `${webUrl()}/subscription` },
              }
            : kind === 'ended'
              ? {
                  subject: `${b.name}: your Floatly subscription has ended`,
                  lines: [
                    `${b.name} was paid up to ${longDate(end)}. You can keep working until ${longDate(lastDay)}; after that the business is locked until the subscription is renewed.`,
                    'Reply to this email to arrange payment.',
                  ],
                  button: { label: 'See your subscription', url: `${webUrl()}/subscription` },
                }
              : {
                  subject: `${b.name} is locked: renew your Floatly subscription`,
                  lines: [
                    `The subscription for ${b.name} ended on ${longDate(end)} and the ${GRACE_DAYS} extra days are over, so you and your staff can't use Floatly for this business until it's renewed. Nothing is lost.`,
                    'Reply to this email to arrange payment.',
                  ],
                };
        return { sent: await this.notify(b.owners, () => message), of: b.owners.length };
      }),
    );
  }

  // ----- Security (to the person) ---------------------------------------------------------

  passwordChanged(userId: string, how: 'changed' | 'reset') {
    return this.safely('password changed', async () => {
      const p = await this.person(userId);
      if (!p) return;
      await this.notify([p], () => ({
        subject: 'Your Floatly password was changed',
        lines: [
          how === 'reset'
            ? `The password for your Floatly login (${p.email}) was just changed with a "forgot password" link, and you were signed out everywhere except on tills.`
            : `The password for your Floatly login (${p.email}) was just changed.`,
          "If that was you, there's nothing to do.",
          "If it wasn't, choose a new password straight away and tell the business owner: someone else may know your password or be reading your email.",
        ],
        button: { label: 'Choose a new password', url: `${webUrl()}/forgot-password` },
      }));
    });
  }

  /** At most once a day per login, so someone guessing can't flood the inbox. */
  accountLocked(userId: string) {
    return this.safely('account locked', () =>
      this.once(`locked:${userId}:${today()}`, async () => {
        const p = await this.person(userId);
        if (!p) return { sent: 0, of: 0 };
        const sent = await this.notify([p], () => ({
          subject: 'Your Floatly login was locked',
          lines: [
            `A wrong password or PIN was entered for ${p.email} ${MAX_FAILURES} times in a row, so the login is locked for ${LOCK_MINUTES} minutes.`,
            'If it was you, wait and try again, or choose a new password.',
            "If it wasn't, choose a new password now: someone may be trying to get in.",
          ],
          button: { label: 'Choose a new password', url: `${webUrl()}/forgot-password` },
        }));
        return { sent, of: 1 };
      }),
    );
  }

  addedToBusiness(tenantId: string, person: Person, role: Role, byUserId: string, newLogin: boolean) {
    return this.safely('added to a business', async () => {
      const [b, by] = await Promise.all([this.business(tenantId), this.nameOf(byUserId)]);
      await this.notify([person], () => ({
        subject: `You've been added to ${b.name} on Floatly`,
        lines: [
          `${by} added you to ${b.name} as ${aRole(role)}.`,
          newLogin
            ? `Sign in with this email (${person.email}) and the password ${by} gave you. To choose your own, use "Forgot password?" on the sign-in page.`
            : `Sign in with your usual Floatly email and password; ${b.name} is now one of your businesses.`,
          ...(['cashier', 'waiter'].includes(role) ? ['On a till, you sign in with your PIN.'] : []),
        ],
        button: { label: 'Sign in', url: `${webUrl()}/login` },
      }));
    });
  }

  // ----- Security of the business (to the owners) -----------------------------------------

  /** Someone was given the run of the business. The other owners hear of it. */
  madeOwnerOrAdmin(tenantId: string, person: Person, role: 'owner' | 'admin', byUserId: string) {
    return this.safely('made owner or admin', async () => {
      const [b, by] = await Promise.all([this.business(tenantId), this.nameOf(byUserId)]);
      const others = b.owners.filter((o) => o.email !== person.email);
      await this.notify(others, () => ({
        subject: `${person.fullName} is now ${aRole(role)} of ${b.name}`,
        lines: [
          `${by} made ${person.fullName} (${person.email}) ${aRole(role)} of ${b.name}. ${role === 'owner' ? 'An owner can do everything, including adding and removing owners.' : 'An admin can manage staff, tills, prices, stock and settings.'}`,
          "If you didn't expect this, check the staff list.",
        ],
        button: { label: 'Open the staff list', url: `${webUrl()}/staff` },
      }));
    });
  }

  tillSetUp(tenantId: string, deviceId: string, byUserId: string) {
    return this.safely('till set up', async () => {
      const [b, by, t] = await Promise.all([this.business(tenantId), this.nameOf(byUserId), this.till(tenantId, deviceId)]);
      if (!t) return;
      await this.notify(b.owners, () => ({
        subject: `A till was set up for ${b.name}: ${t.code}`,
        lines: [
          `${by} set up a device as till ${t.code} (${t.name}) at ${t.store}. Staff can now sign in on it with their PIN; if the till was set up before, the old device can't any more.`,
          "If you didn't expect this, switch the till off under Settings → Tills in the backoffice.",
        ],
        button: { label: 'Open Settings', url: `${webUrl()}/settings` },
      }));
    });
  }

  // ----- ZIMRA (to the owners) ------------------------------------------------------------

  /** At most once a day per till. */
  zimraProblem(tenantId: string, deviceId: string, problem: string) {
    return this.safely('ZIMRA problem', () =>
      this.once(`zimra-problem:${deviceId}:${today()}`, async () => {
        const [b, t] = await Promise.all([this.business(tenantId), this.till(tenantId, deviceId)]);
        if (!t) return { sent: 0, of: 0 };
        const sent = await this.notify(b.owners, () => ({
          subject: `ZIMRA problem on till ${t.code} at ${b.name}`,
          lines: [
            `Till ${t.code} (${t.name}) at ${t.store} reports a problem with ZIMRA fiscalisation:`,
            problem,
            "Receipts the till hasn't been able to send wait on it and go to ZIMRA once the problem is fixed. On the till, Till settings → ZIMRA shows the details.",
          ],
        }));
        return { sent, of: b.owners.length };
      }),
    );
  }

  /** Once per fiscal day. */
  zimraDayOverdue(tenantId: string, deviceId: string, dayNo: number | null, openedAt: Date) {
    return this.safely('ZIMRA day overdue', () =>
      this.once(`zimra-day:${deviceId}:${dayNo ?? openedAt.toISOString()}`, async () => {
        const [b, t] = await Promise.all([this.business(tenantId), this.till(tenantId, deviceId)]);
        if (!t) return { sent: 0, of: 0 };
        const since = openedAt.toLocaleString('en-GB', { timeZone: b.tz, weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
        const sent = await this.notify(b.owners, () => ({
          subject: `Close the ZIMRA fiscal day on till ${t.code}`,
          lines: [
            `${dayNo ? `Fiscal day ${dayNo}` : 'The fiscal day'} on till ${t.code} (${t.name}) at ${t.store} has been open since ${since}. ZIMRA expects each fiscal day to be closed within 24 hours.`,
            'A manager can close it on the till: open the menu and choose End of day (Z report).',
          ],
        }));
        return { sent, of: b.owners.length };
      }),
    );
  }
}
