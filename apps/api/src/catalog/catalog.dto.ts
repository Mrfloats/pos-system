import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsMoney, IsQuantity, ListQuery, ToDecimalString, Trim } from '../common/validation.js';

const toBool = () =>
  Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value));

// ----- Categories ----------------------------------------------------------

export class CreateCategoryDto {
  @Trim() @IsString() @Length(1, 80) name: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'color must be like #1a2b3c' }) color?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100000) sortOrder?: number;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

// ----- Tax rates -----------------------------------------------------------

export class CreateTaxRateDto {
  @Trim() @IsString() @Length(1, 60) name: string;
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9_]{1,12}$/)
  code: string;
  /** Percentage, e.g. 15.5 */
  @ToDecimalString() @Matches(/^\d{1,3}(\.\d{1,2})?$/, { message: 'rate must be a percentage like 15.5' })
  rate: string;
  @IsOptional() @IsBoolean() inclusive?: boolean;
  @IsOptional() @IsInt() @Min(0) fiscalTaxId?: number;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateTaxRateDto extends PartialType(CreateTaxRateDto) {}

// ----- Units ---------------------------------------------------------------

export class CreateUnitDto {
  @Trim() @IsString() @Length(1, 40) name: string;
  @Trim() @IsString() @Length(1, 10) abbreviation: string;
  @IsOptional() @IsBoolean() allowsDecimal?: boolean;
}
export class UpdateUnitDto extends PartialType(CreateUnitDto) {}

// ----- Currencies ----------------------------------------------------------

export class CreateCurrencyDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'code must be a 3-letter currency code, e.g. ZWG' })
  code: string;
  @Trim() @IsString() @Length(1, 40) name: string;
  @Trim() @IsString() @Length(1, 6) symbol: string;
  /** Units of this currency per 1 unit of the base currency. */
  @ToDecimalString()
  @Matches(/^\d{1,12}(\.\d{1,6})?$/, { message: 'rateToBase must be a positive number' })
  rateToBase: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateCurrencyDto extends PartialType(CreateCurrencyDto) {}

// ----- Price lists ---------------------------------------------------------

export class CreatePriceListDto {
  @Trim() @IsString() @Length(1, 60) name: string;
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/)
  currencyCode?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdatePriceListDto extends PartialType(CreatePriceListDto) {}

export class PriceListItemDto {
  @IsUUID() variantId: string;
  /** Price applies from this quantity upwards. Default 1. */
  @IsOptional() @ToDecimalString() @IsQuantity() minQuantity?: string;
  @ToDecimalString() @IsMoney() price: string;
}

export class SetPriceListItemsDto {
  /** Replaces every price on the list for the variants included here. */
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => PriceListItemDto)
  items: PriceListItemDto[];
  /** Variants to take off the list entirely. */
  @IsOptional() @IsArray() @ArrayMaxSize(1000) @IsUUID(undefined, { each: true }) removeVariantIds?: string[];
}

// ----- Modifiers (restaurants) ----------------------------------------------

export class ModifierDto {
  @IsOptional() @IsUUID() id?: string;
  @Trim() @IsString() @Length(1, 60) name: string;
  @IsOptional() @ToDecimalString() @Matches(/^-?\d{1,12}(\.\d{1,2})?$/) priceDelta?: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
}

export class CreateModifierGroupDto {
  @Trim() @IsString() @Length(1, 60) name: string;
  @IsOptional() @IsInt() @Min(0) @Max(50) minSelect?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) maxSelect?: number;
  @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ModifierDto)
  modifiers: ModifierDto[];
}
export class UpdateModifierGroupDto extends PartialType(CreateModifierGroupDto) {}

// ----- Products --------------------------------------------------------------

export const PRODUCT_KINDS = ['standard', 'service', 'menu_item', 'bundle'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

export class PackagingDto {
  @IsOptional() @IsUUID() id?: string;
  /** e.g. "Case of 24" */
  @Trim() @IsString() @Length(1, 60) name: string;
  /** Base units in one pack. */
  @ToDecimalString() @IsQuantity() quantity: string;
  @IsOptional() @Trim() @IsString() @MaxLength(64) barcode?: string;
  @IsOptional() @ToDecimalString() @IsMoney() price?: string;
}

export class ComponentDto {
  @IsUUID() componentVariantId: string;
  @ToDecimalString() @IsQuantity() quantity: string;
}

export class VariantDto {
  /** Include to update an existing variant; omit to add a new one. */
  @IsOptional() @IsUUID() id?: string;
  @IsOptional() @Trim() @IsString() @Length(1, 60) name?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(64) sku?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(64) barcode?: string;
  @ToDecimalString() @IsMoney() price: string;
  @IsOptional() @ToDecimalString() @IsMoney() costPrice?: string;
  @IsOptional() @ToDecimalString() @IsQuantity() reorderLevel?: string;
  @IsOptional() @IsBoolean() active?: boolean;

  /** Wholesale packs of this variant. Sent list replaces the existing packs. */
  @IsOptional() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => PackagingDto)
  packagings?: PackagingDto[];

  /** Recipe / bundle contents. Sent list replaces the existing components. */
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ComponentDto)
  components?: ComponentDto[];
}

export class CreateProductDto {
  @Trim() @IsString() @Length(1, 160) name: string;
  @IsOptional() @Trim() @IsString() @MaxLength(2000) description?: string;
  @IsOptional() @IsIn(PRODUCT_KINDS) kind?: ProductKind;
  @IsOptional() @IsUUID() categoryId?: string | null;
  @IsOptional() @IsUUID() taxRateId?: string | null;
  @IsOptional() @IsUUID() unitId?: string | null;
  @IsOptional() @IsBoolean() trackStock?: boolean;
  @IsOptional() @IsBoolean() soldByWeight?: boolean;
  @IsOptional() @Trim() @IsString() @MaxLength(40) kitchenStation?: string;
  @IsOptional() @IsUrl({ require_tld: false }) imageUrl?: string;
  @IsOptional() @IsBoolean() active?: boolean;

  /** At least one variant. The first becomes the default. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => VariantDto)
  variants: VariantDto[];

  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true })
  modifierGroupIds?: string[];
}

export class UpdateProductDto extends PartialType(CreateProductDto) {}

export class ProductQuery extends ListQuery {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsIn(PRODUCT_KINDS) kind?: ProductKind;
  @IsOptional() @toBool() @IsBoolean() active?: boolean;
  /** Also return quantity on hand (all stores) and the stores holding stock. */
  @IsOptional() @toBool() @IsBoolean() withStock?: boolean;
}

export class CategoryQuery {
  @IsOptional() @toBool() @IsBoolean() active?: boolean;
}

