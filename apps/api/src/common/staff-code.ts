import { sql } from 'drizzle-orm';
import type { Tx } from '../db/db.service.js';
import { type Role, STAFF_CODE_PREFIX } from './auth-context.js';

/**
 * The next staff ID for a role in the current business: ADM-001, ADM-002…
 * Call inside a transaction with the tenant set. Two people added at the same
 * instant would get the same ID; the unique index refuses the second.
 */
export async function nextStaffCode(tx: Tx, role: Role): Promise<string> {
  const prefix = STAFF_CODE_PREFIX[role];
  const res = await tx.execute(
    sql`SELECT coalesce(max(substring(staff_code from '[0-9]+$')::int), 0) + 1 AS n FROM memberships WHERE staff_code LIKE ${`${prefix}-%`}`,
  );
  const n = Number((res.rows[0] as { n: number }).n);
  return `${prefix}-${String(n).padStart(3, '0')}`;
}
