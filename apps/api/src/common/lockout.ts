import { ForbiddenException, HttpException, HttpStatus } from '@nestjs/common';
import { verify } from '@node-rs/argon2';
import { eq, sql } from 'drizzle-orm';
import type { Db } from '../db/db.service.js';
import { users } from '../db/schema.js';
import type { AuthContext } from './auth-context.js';

/** Wrong passwords or PINs in a row before the account is locked (raised only by the test suite). */
export const MAX_FAILURES = Number(process.env.LOGIN_MAX_FAILURES ?? 5);
/** How long a locked account stays locked. */
export const LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES ?? 15);

export const ACCOUNT_LOCKED = 'account_locked';
export const PIN_REQUIRED = 'pin_required';
export const PIN_NOT_SET = 'pin_not_set';
export const WRONG_PIN = 'wrong_pin';

function locked(until: Date) {
  const minutes = Math.max(1, Math.ceil((until.getTime() - Date.now()) / 60_000));
  return new HttpException(
    {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      code: ACCOUNT_LOCKED,
      message: `Too many wrong attempts. This account is locked for ${minutes} more minute${minutes === 1 ? '' : 's'}.`,
    },
    HttpStatus.TOO_MANY_REQUESTS,
  );
}

/** Refuses while the account is locked. */
export function assertNotLocked(lockedUntil: Date | null | undefined) {
  if (lockedUntil && lockedUntil.getTime() > Date.now()) throw locked(lockedUntil);
}

/** Counts a wrong password or PIN. Throws when that locks the account; otherwise the caller says what was wrong. */
export async function recordFailure(db: Db, userId: string) {
  const res = await db.execute(sql`
    UPDATE users
       SET failed_logins = CASE WHEN failed_logins + 1 >= ${MAX_FAILURES} THEN 0 ELSE failed_logins + 1 END,
           locked_until = CASE WHEN failed_logins + 1 >= ${MAX_FAILURES} THEN now() + make_interval(mins => ${LOCK_MINUTES}) ELSE locked_until END
     WHERE id = ${userId}
     RETURNING locked_until`);
  const until = (res.rows[0] as { locked_until: Date | string | null } | undefined)?.locked_until;
  if (until) assertNotLocked(new Date(until));
}

/** A right password or PIN starts the count again. */
export async function clearFailures(db: Db, userId: string) {
  await db.update(users).set({ failedLogins: 0, lockedUntil: null }).where(eq(users.id, userId));
}

/**
 * Checks a PIN sent to confirm a sensitive action (the X-Floatly-Pin header).
 * Wrong PINs count towards locking the account, like wrong passwords.
 */
export async function confirmPin(db: Db, userId: string, pinHash: string, pin: string) {
  const [user] = await db.select({ lockedUntil: users.lockedUntil, failedLogins: users.failedLogins }).from(users).where(eq(users.id, userId));
  assertNotLocked(user?.lockedUntil);
  const ok = /^\d{4,6}$/.test(pin) && (await verify(pinHash, pin).catch(() => false));
  if (!ok) {
    await recordFailure(db, userId);
    throw new ForbiddenException({ statusCode: HttpStatus.FORBIDDEN, code: WRONG_PIN, message: 'Wrong PIN' });
  }
  if (user?.failedLogins) await clearFailures(db, userId);
}

/**
 * Sensitive actions (changing a price, refunding, voiding) done from a phone
 * need the person's PIN again, so an unlocked phone left on a counter can't be
 * used for them. The backoffice and tills are not asked.
 */
export function assertPinConfirmed(ctx: Pick<AuthContext, 'mobileSession' | 'pinConfirmed' | 'hasPin'>) {
  if (!ctx.mobileSession || ctx.pinConfirmed) return;
  throw new ForbiddenException(
    ctx.hasPin
      ? { statusCode: HttpStatus.FORBIDDEN, code: PIN_REQUIRED, message: 'Enter your PIN to confirm this' }
      : { statusCode: HttpStatus.FORBIDDEN, code: PIN_NOT_SET, message: 'Set a PIN for yourself first, then try again' },
  );
}
