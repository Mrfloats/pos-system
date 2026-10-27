import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { IsDay, IsRate } from '../accounting/accounting.dto.js';
import { IsMoney, IsQuantity, ListQuery, ToDecimalString, Trim } from '../common/validation.js';

export const PAYMENT_METHODS = ['cash', 'card', 'mobile', 'bank'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const Currency = () => Matches(/^[A-Z]{3}$/, { message: 'currencyCode must be a 3-letter code' });

export class SaleLineDto {
  @IsUUID() variantId: string;
  /** Sell the variant as this pack (a case of 24…). `quantity` then counts packs. */
  @IsOptional() @IsUUID() packagingId?: string;
  /**
   * Restaurant choices (a side, extras), each adding its price. When given, every
   * choice group the item requires must be answered; leave out to skip choices (imports).
   */
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ArrayUnique() @IsUUID('all', { each: true }) modifierIds?: string[];
  @ToDecimalString() @IsQuantity() quantity: string;
  /** Sale currency, per unit (per pack), choices included. Leave out for the item's price in this store. */
  @IsOptional() @ToDecimalString() @IsMoney() unitPrice?: string;
  /** Amount off the whole line, sale currency. Leave out for the customer group's discount. */
  @IsOptional() @ToDecimalString() @IsMoney() discount?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(200) note?: string;
}

export class SalePaymentDto {
  @IsIn(PAYMENT_METHODS) method: PaymentMethod;
  /** Defaults to the sale currency. */
  @IsOptional() @Currency() currencyCode?: string;
  /** Defaults to the currency's current rate. */
  @IsOptional() @IsRate() rate?: string;
  /** Amount handed over. Cash may be more than due; the difference is given back as change. */
  @ToDecimalString() @IsMoney() amount: string;
  @IsOptional() @Trim() @IsString() @MaxLength(80) reference?: string;
}

export class CreateSaleDto {
  @IsUUID() storeId: string;
  @IsOptional() @IsUUID() customerId?: string;
  /** Price the sale from this price list (Wholesale…). Leave out for the customer's list, or normal prices. */
  @IsOptional() @IsUUID() priceListId?: string;
  /** Printed on the receipt when no customer record is chosen. */
  @IsOptional() @Trim() @IsString() @MaxLength(160) customerName?: string;
  @IsOptional() @Currency() currencyCode?: string;
  @IsOptional() @IsRate() rate?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => SaleLineDto)
  lines: SaleLineDto[];
  /** Not used for quotations. */
  @IsOptional() @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SalePaymentDto)
  payments?: SalePaymentDto[];
  @IsOptional() @Trim() @IsString() @MaxLength(500) note?: string;
  /** When the sale happened (offline tills sync later). Defaults to now. */
  @IsOptional() @IsISO8601() soldAt?: string;
  @IsOptional() @IsUUID() deviceId?: string;
  @IsOptional() @IsUUID() shiftId?: string;
  @IsOptional() @IsUUID() salespersonId?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(30) appVersion?: string;
  /** Idempotency key: sending the same clientId again returns the first sale. */
  @IsOptional() @IsUUID() clientId?: string;
}

/** Same as a sale without payments: works out prices, discounts, VAT and totals without saving. */
export class PreviewSaleDto {
  @IsUUID() storeId: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() priceListId?: string;
  @IsOptional() @Currency() currencyCode?: string;
  @IsOptional() @IsRate() rate?: string;
  @IsArray() @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => SaleLineDto)
  lines: SaleLineDto[];
}

export class CreateQuotationDto extends CreateSaleDto {
  @IsOptional() @IsDay() validUntil?: string;
}

export class ConvertQuotationDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => SalePaymentDto)
  payments: SalePaymentDto[];
  @IsOptional() @IsUUID() shiftId?: string;
}

export class ReturnLineDto {
  @IsUUID() lineId: string;
  @ToDecimalString() @IsQuantity() quantity: string;
}

export class CreateReturnDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(300) @ValidateNested({ each: true }) @Type(() => ReturnLineDto)
  lines: ReturnLineDto[];
  /** How the money goes back to the customer, in the sale's currency. */
  @IsIn(PAYMENT_METHODS) method: PaymentMethod;
  @Trim() @IsString() @Length(1, 300) reason: string;
  /** False for damaged goods that shouldn't go back on the shelf. */
  @IsOptional() @IsBoolean() restock?: boolean;
  @IsOptional() @IsUUID() shiftId?: string;
}

export const SALE_TYPES = ['sale', 'return', 'quotation'] as const;
export const SALE_STATUSES = ['open', 'completed', 'converted', 'cancelled', 'void'] as const;

export class SaleQuery extends ListQuery {
  @IsOptional() @IsIn(SALE_TYPES) type?: (typeof SALE_TYPES)[number];
  @IsOptional() @IsIn(SALE_STATUSES) status?: (typeof SALE_STATUSES)[number];
  @IsOptional() @IsUUID() storeId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
}

export const KITCHEN_STATUSES = ['pending', 'preparing', 'ready', 'served'] as const;
export type KitchenStatus = (typeof KITCHEN_STATUSES)[number];

export class KitchenQuery {
  @IsOptional() @IsUUID() storeId?: string;
  @IsOptional() @Trim() @IsString() station?: string;
}

export class KitchenUpdateDto {
  @IsIn(KITCHEN_STATUSES) status: KitchenStatus;
  /** Only these lines; leave out for the whole ticket. */
  @IsOptional() @IsArray() @IsUUID(undefined, { each: true }) lineIds?: string[];
}

// ----- Shifts and cash -------------------------------------------------------------

export class OpenShiftDto {
  @IsUUID() storeId: string;
  @IsOptional() @IsUUID() deviceId?: string;
  /** Float per currency, e.g. { "USD": "20.00", "ZWG": "100.00" }. */
  @IsOptional() @IsObject() openingFloat?: Record<string, string>;
}

export class CloseShiftDto {
  /** Cash counted per currency. */
  @IsObject() countedCash: Record<string, string>;
  @IsOptional() @Trim() @IsString() @MaxLength(500) note?: string;
}

export class ShiftQuery extends ListQuery {
  @IsOptional() @IsUUID() storeId?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
  @IsOptional() @IsIn(['open', 'closed']) state?: 'open' | 'closed';
}

export class CashTransferDto {
  @IsUUID() storeId: string;
  /** A bank or other money account… */
  @IsOptional() @IsUUID() toAccountId?: string;
  /** …or another store's till. */
  @IsOptional() @IsUUID() toStoreId?: string;
  @IsOptional() @Currency() currencyCode?: string;
  @IsOptional() @IsRate() rate?: string;
  @ToDecimalString() @IsMoney() amount: string;
  @IsOptional() @Trim() @IsString() @MaxLength(80) reference?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) note?: string;
  @IsOptional() @IsUUID() shiftId?: string;
}

export class CashTransferQuery extends ListQuery {
  @IsOptional() @IsUUID() storeId?: string;
  @IsOptional() @IsDay() from?: string;
  @IsOptional() @IsDay() to?: string;
}

// ----- Customer groups -----------------------------------------------------------------

export class CustomerGroupDto {
  @Trim() @IsString() @Length(1, 80) name: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @ToDecimalString() @Matches(/^\d{1,2}(\.\d{1,2})?$|^100(\.0{1,2})?$/, { message: 'discountPercent must be between 0 and 100' })
  discountPercent?: string;
  @IsOptional() @IsUUID() priceListId?: string | null;
}
export class UpdateCustomerGroupDto extends PartialType(CustomerGroupDto) {}

// ----- Import ---------------------------------------------------------------------------

export class ImportRowDto {
  /** Rows with the same reference become one sale. */
  @Trim() @IsString() @Length(1, 60) reference: string;
  /** Date or date and time. */
  @IsISO8601() date: string;
  /** Store code, e.g. MAIN. */
  @Trim() @IsString() @Length(1, 20) store: string;
  @IsOptional() @Trim() @IsString() @MaxLength(160) customer?: string;
  /** SKU or barcode. */
  @Trim() @IsString() @Length(1, 60) item: string;
  @ToDecimalString() @IsQuantity() quantity: string;
  /** Per unit, tax included. Leave out for the item's normal price. */
  @IsOptional() @ToDecimalString() @IsMoney() unitPrice?: string;
  @IsOptional() @IsIn(PAYMENT_METHODS) paymentMethod?: PaymentMethod;
  @IsOptional() @Currency() currencyCode?: string;
}

export class ImportSalesDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => ImportRowDto)
  rows: ImportRowDto[];
}

// ----- Reports ----------------------------------------------------------------------------

export class SalesRangeQuery {
  @IsDay() from: string;
  @IsDay() to: string;
  @IsOptional() @IsUUID() storeId?: string;
}

export const PROFIT_BY = ['item', 'category', 'cashier', 'store'] as const;

export class ProfitQuery extends SalesRangeQuery {
  @IsIn(PROFIT_BY) by: (typeof PROFIT_BY)[number];
}

export class CashbookQuery {
  @IsDay() from: string;
  @IsDay() to: string;
  @IsUUID() storeId: string;
  @IsOptional() @Currency() currencyCode?: string;
}
