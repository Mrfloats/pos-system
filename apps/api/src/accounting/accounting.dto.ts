import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsMoney, IsQuantity, ListQuery, ToDecimalString, Trim } from '../common/validation.js';
import type { AccountType } from './chart.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const RATE = /^\d{1,12}(\.\d{1,6})?$/;

/** A calendar date, YYYY-MM-DD. */
export const IsDay = () => (target: object, key: string) => {
  Matches(DAY, { message: `${key} must be a date like 2026-10-31` })(target, key);
  IsISO8601({ strict: true }, { message: `${key} must be a real date` })(target, key);
};

/** Exchange rate: units of the currency per 1 unit of the base currency. */
export const IsRate = () => (target: object, key: string) => {
  ToDecimalString()(target, key);
  Matches(RATE, { message: `${key} must be a positive exchange rate with up to 6 decimals` })(target, key);
};

const CurrencyCode = () => (target: object, key: string) => {
  Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() || undefined : value))(target, key);
  Matches(/^[A-Z]{3}$/, { message: `${key} must be a 3-letter currency code` })(target, key);
};

// ----- Chart of accounts --------------------------------------------------------

export const ACCOUNT_TYPES: AccountType[] = ['asset', 'liability', 'equity', 'income', 'expense'];

export class CreateAccountDto {
  @Trim() @IsString() @Matches(/^[A-Za-z0-9.-]{1,12}$/, { message: 'code must be up to 12 letters, digits, dots or dashes' })
  code: string;
  @Trim() @IsString() @Length(1, 120) name: string;
  @IsIn(ACCOUNT_TYPES) type: AccountType;
  /** Cash, bank or mobile money: money can be paid from or into it. Assets only. */
  @IsOptional() @IsBoolean() isBank?: boolean;
  @IsOptional() @Trim() @IsString() @MaxLength(300) description?: string;
}

export class UpdateAccountDto {
  @IsOptional() @Trim() @IsString() @Matches(/^[A-Za-z0-9.-]{1,12}$/) code?: string;
  @IsOptional() @Trim() @IsString() @Length(1, 120) name?: string;
  @IsOptional() @IsBoolean() isBank?: boolean;
  @IsOptional() @Trim() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

// ----- Suppliers ------------------------------------------------------------------

export class CreateSupplierDto {
  @Trim() @IsString() @Length(1, 160) name: string;
  @IsOptional() @Trim() @IsString() @MaxLength(120) contactName?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @Trim() @IsEmail() email?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(30) tin?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(30) vatNumber?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) paymentTermsDays?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}

// ----- Invoices and bills ---------------------------------------------------------------

export class DocumentLineDto {
  /** Income account for invoices (defaults to Sales); expense, stock or asset account for bills. */
  @IsOptional() @IsUUID() accountId?: string;
  @Trim() @IsString() @Length(1, 300) description: string;
  @IsOptional() @ToDecimalString() @IsQuantity() quantity?: string;
  @ToDecimalString() @IsMoney() unitPrice: string;
  /** Leave out for no tax. */
  @IsOptional() @IsUUID() taxRateId?: string | null;
}

class DocumentDto {
  @IsDay() date: string;
  /** Defaults to the date (invoices) or the supplier's payment terms (bills). */
  @IsOptional() @IsDay() dueDate?: string;
  /** Defaults to the base currency. */
  @IsOptional() @CurrencyCode() currencyCode?: string;
  /** Defaults to the currency's current rate. */
  @IsOptional() @IsRate() rate?: string;
  /** True when the prices entered already include tax. */
  @IsOptional() @IsBoolean() taxInclusive?: boolean;
  @IsOptional() @Trim() @IsString() @MaxLength(1000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => DocumentLineDto)
  lines: DocumentLineDto[];
}

export class CreateInvoiceDto extends DocumentDto {
  @IsUUID() customerId: string;
}

export class CreateBillDto extends DocumentDto {
  @IsUUID() supplierId: string;
  /** The supplier's own invoice number. */
  @IsOptional() @Trim() @IsString() @MaxLength(60) supplierReference?: string;
}

export const DOCUMENT_STATUSES = ['unpaid', 'overdue', 'paid', 'void'] as const;

export class DocumentQuery extends ListQuery {
  @IsOptional() @IsIn(DOCUMENT_STATUSES) status?: (typeof DOCUMENT_STATUSES)[number];
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
  /** Bills only: just purchases of stock (bills received into a store). */
  @IsOptional() @Transform(({ value }) => value === true || value === 'true') @IsBoolean() purchases?: boolean;
}

export class PaymentDto {
  /** The cash, bank or mobile money account the money went into or came out of. */
  @IsUUID() accountId: string;
  @IsDay() date: string;
  /** In the document's currency. */
  @ToDecimalString() @IsMoney() amount: string;
  /** Rate on the day of payment. Defaults to the currency's current rate. */
  @IsOptional() @IsRate() rate?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(80) reference?: string;
}

// ----- Expenses and transfers -------------------------------------------------------------

export class CreateExpenseDto {
  @IsDay() date: string;
  /** What it was spent on. */
  @IsUUID() accountId: string;
  /** Where the money came from. */
  @IsUUID() paidFromAccountId: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(160) payee?: string;
  @Trim() @IsString() @Length(1, 300) description: string;
  @IsOptional() @Trim() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @CurrencyCode() currencyCode?: string;
  @IsOptional() @IsRate() rate?: string;
  /** Amount paid, including any tax. */
  @ToDecimalString() @IsMoney() total: string;
  /** The tax included in the total, if any. */
  @IsOptional() @IsUUID() taxRateId?: string | null;
}

export class ExpenseQuery extends ListQuery {
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
  @IsOptional() @IsUUID() accountId?: string;
}

export class CreateTransferDto {
  @IsUUID() fromAccountId: string;
  @IsUUID() toAccountId: string;
  @IsDay() date: string;
  /** Base currency. */
  @ToDecimalString() @IsMoney() amount: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(80) reference?: string;
}

// ----- Journal entries ------------------------------------------------------------------------

export class JournalLineDto {
  @IsUUID() accountId: string;
  @IsOptional() @ToDecimalString() @IsMoney() debit?: string;
  @IsOptional() @ToDecimalString() @IsMoney() credit?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) memo?: string;
}

export class CreateJournalDto {
  @IsDay() date: string;
  @Trim() @IsString() @Length(1, 300) description: string;
  @IsOptional() @Trim() @IsString() @MaxLength(80) reference?: string;
  /** Opening balances when moving onto this system, or an everyday adjustment. */
  @IsOptional() @IsBoolean() opening?: boolean;
  @IsArray() @ArrayMinSize(2) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => JournalLineDto)
  lines: JournalLineDto[];
}

export class ReverseDto {
  @IsOptional() @IsDay() date?: string;
}

export const JOURNAL_SOURCES = [
  'manual',
  'opening',
  'invoice',
  'invoice_payment',
  'bill',
  'bill_payment',
  'expense',
  'transfer',
  'stock',
  'sale',
  'sale_return',
  'cash_transfer',
  'reversal',
] as const;

export class JournalQuery extends ListQuery {
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
  @IsOptional() @IsIn(JOURNAL_SOURCES) source?: (typeof JOURNAL_SOURCES)[number];
  @IsOptional() @IsUUID() accountId?: string;
}

// ----- Periods and reports ----------------------------------------------------------------------

export class CloseBooksDto {
  /** Nothing can be posted on or before this date afterwards. Null reopens everything. */
  @IsOptional() @IsDay() through: string | null;
}

export class RangeQuery {
  @IsDay() from: string;
  @IsDay() to: string;
}

export class AsOfQuery {
  @IsOptional() @IsDay() asOf?: string;
}

export class LedgerQuery extends RangeQuery {
  @IsUUID() accountId: string;
}
