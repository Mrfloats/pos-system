import { BadRequestException } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core';
import { Tx } from '../db/db.service.js';

/**
 * Checks that referenced ids exist *in the caller's tenant*.
 *
 * Postgres foreign keys are checked without row-level security, so without
 * this a request could link to another tenant's record by guessing its id.
 * Run inside DbService.withTenant so RLS limits the lookup to the tenant.
 */
export async function assertOwned(
  tx: Tx,
  table: PgTable & { id: AnyPgColumn },
  ids: (string | null | undefined)[],
  what: string,
) {
  const wanted = [...new Set(ids.filter((v): v is string => !!v))];
  if (!wanted.length) return;
  const rows = await (tx.select({ id: table.id }).from(table as PgTable) as any).where(
    inArray(table.id, wanted),
  );
  if (rows.length !== wanted.length) throw new BadRequestException(`Unknown ${what}`);
}
