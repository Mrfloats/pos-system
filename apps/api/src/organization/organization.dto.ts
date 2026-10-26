import { PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Role } from '../common/auth-context.js';
import { Trim } from '../common/validation.js';
import { BUSINESS_TYPES, type BusinessType } from '../auth/auth.dto.js';

export class UpdateTenantDto {
  @IsOptional() @Trim() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @IsIn(BUSINESS_TYPES) businessType?: BusinessType;
  @IsOptional() @Trim() @IsString() @MaxLength(60) timezone?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(30) tin?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(30) vatNumber?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @Trim() @IsEmail() email?: string;
}

export const STORE_TYPES = ['shop', 'warehouse', 'restaurant'] as const;

export class CreateStoreDto {
  @Trim() @IsString() @Length(1, 120) name: string;

  /** Short unique code, e.g. MAIN, HRE01. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9_-]{1,12}$/, { message: 'code must be 1–12 letters, digits, - or _' })
  code: string;

  @IsOptional() @IsIn(STORE_TYPES) type?: (typeof STORE_TYPES)[number];
  @IsOptional() @Trim() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @Trim() @IsString() @MaxLength(30) phone?: string;
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateStoreDto extends PartialType(CreateStoreDto) {}

const STAFF_ROLES: Role[] = ['owner', 'admin', 'manager', 'cashier', 'waiter', 'stock_clerk', 'accountant'];

export class CreateStaffDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email: string;

  @Trim() @IsString() @Length(2, 120) fullName: string;

  /** Required when the person has no account yet. Ignored for existing accounts. */
  @IsOptional() @IsString() @MinLength(8) @MaxLength(128) password?: string;

  @IsIn(STAFF_ROLES) role: Role;

  /** 4–6 digit PIN for signing in on a till. */
  @IsOptional() @Matches(/^\d{4,6}$/, { message: 'pin must be 4–6 digits' }) pin?: string;

  /** Stores this person may work in. Empty or omitted = all stores. */
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) storeIds?: string[];
}

export class UpdateStaffDto {
  @IsOptional() @IsIn(STAFF_ROLES) role?: Role;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @Matches(/^\d{4,6}$/, { message: 'pin must be 4–6 digits' }) pin?: string;
  @IsOptional() @IsArray() @ArrayUnique() @IsUUID('all', { each: true }) storeIds?: string[];
}

export const DEVICE_KINDS = ['till', 'handheld', 'kitchen_display', 'kiosk'] as const;

export class CreateDeviceDto {
  @IsUUID() storeId: string;
  @Trim() @IsString() @Length(1, 60) name: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z0-9]{1,6}$/, { message: 'code must be 1–6 letters or digits, e.g. T01' })
  code: string;

  @IsOptional() @IsIn(DEVICE_KINDS) kind?: (typeof DEVICE_KINDS)[number];
  @IsOptional() @IsBoolean() active?: boolean;
}
export class UpdateDeviceDto extends PartialType(CreateDeviceDto) {}

export class IdParam {
  @IsUUID() id: string;
}

export class StoreFilter {
  @IsOptional() @IsUUID() storeId?: string;
  @IsOptional() @Type(() => String) @Trim() search?: string;
}
