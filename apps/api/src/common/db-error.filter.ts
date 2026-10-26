import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';

/** Plain-language messages for the unique rules people actually run into. */
const CONSTRAINT_MESSAGES: Record<string, string> = {
  variants_tenant_barcode_uq: 'Another product already uses this barcode',
  variants_tenant_sku_uq: 'Another product already uses this SKU',
  packagings_tenant_barcode_uq: 'Another pack already uses this barcode',
  stores_tenant_code_uq: 'Another store already uses this code',
  devices_store_code_uq: 'Another device in this store already uses this code',
  tax_rates_tenant_code_uq: 'Another tax rate already uses this code',
  currencies_tenant_code_uq: 'This currency is already set up',
  units_tenant_abbr_uq: 'Another unit already uses this abbreviation',
  memberships_tenant_user_uq: 'This person is already on your staff list',
  users_email_unique: 'An account with this email already exists',
  accounts_tenant_code_uq: 'Another account already uses this code',
  attributes_tenant_name_uq: 'Another attribute already has this name',
  attribute_values_uq: 'This attribute already has that value',
  journal_entry_balanced: 'Debits and credits must be equal',
  journal_entry_open_period: 'That date is in a closed period. Reopen the period or use a later date',
  journal_entries_reverses_uq: 'This entry has already been reversed',
};

/** Finds the Postgres error inside a Drizzle error wrapper. */
function pgError(err: unknown): { code: string; detail?: string; constraint?: string } | undefined {
  let current: any = err;
  for (let depth = 0; current && depth < 5; depth++) {
    if (typeof current.code === 'string' && /^[0-9A-Z]{5}$/.test(current.code)) return current;
    current = current.cause;
  }
  return undefined;
}

/**
 * Turns database constraint errors into clear 4xx responses instead of 500s.
 * Everything else falls through to Nest's default handling.
 */
@Catch()
export class DbErrorFilter extends BaseExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('DbErrorFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const pg = pgError(exception);
    if (!pg) return super.catch(exception, host);

    const response = host.switchToHttp().getResponse();
    const map: Record<string, [number, string]> = {
      '23505': [HttpStatus.CONFLICT, 'A record with these details already exists'],
      '23503': [HttpStatus.BAD_REQUEST, 'A linked record does not exist or is still in use'],
      '23502': [HttpStatus.BAD_REQUEST, 'A required field is missing'],
      '22P02': [HttpStatus.BAD_REQUEST, 'Invalid identifier or value'],
      '42501': [HttpStatus.FORBIDDEN, 'Not permitted'],
      '23514': [HttpStatus.BAD_REQUEST, 'This breaks an accounting rule'],
    };
    const known = map[pg.code];
    if (!known) {
      this.logger.error(exception);
      return response.status(500).json({ statusCode: 500, message: 'Internal server error' });
    }
    const [statusCode, generic] = known;
    const message = (pg.constraint && CONSTRAINT_MESSAGES[pg.constraint]) || generic;
    return response.status(statusCode).json({ statusCode, message, constraint: pg.constraint });
  }
}
