import {
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
import { Transform } from 'class-transformer';
import { Trim } from '../common/validation.js';

const lower = () => Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value));

export const BUSINESS_TYPES = ['retail', 'wholesale', 'restaurant', 'mixed'] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export class SignupDto {
  @Trim()
  @IsString()
  @Length(2, 120)
  businessName: string;

  @IsIn(BUSINESS_TYPES)
  businessType: BusinessType;

  /** ISO 3166 country code. Defaults to ZW. */
  @IsOptional()
  @Matches(/^[A-Z]{2}$/)
  country?: string;

  /** ISO 4217 base currency. Defaults to USD. */
  @IsOptional()
  @Matches(/^[A-Z]{3}$/)
  baseCurrency?: string;

  @Trim()
  @IsString()
  @Length(2, 120)
  fullName: string;

  @lower()
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(30)
  phone?: string;
}

export class LoginDto {
  @lower()
  @IsEmail()
  email: string;

  @IsString()
  @MaxLength(128)
  password: string;

  /** Business to sign in to when the user belongs to several. Defaults to the first. */
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  /**
   * "mobile" for the phone app: the access token is short-lived and comes with a
   * refresh token to keep in the phone's keychain (see POST /auth/refresh).
   */
  @IsOptional()
  @IsIn(['mobile'])
  session?: 'mobile';
}

const RefreshToken = () => Matches(/^rt_[A-Za-z0-9_-]{20,100}$/, { message: 'refreshToken is not a refresh token' });

export class RefreshDto {
  @IsString() @RefreshToken() refreshToken: string;

  /** Carry on in another business the person belongs to. */
  @IsOptional() @IsUUID() tenantId?: string;
}

export class LogoutDto {
  @IsString() @RefreshToken() refreshToken: string;
}

/** Choosing your own PIN, proven with your password. */
export class SetPinDto {
  @IsString() @MaxLength(128) password: string;
  @Matches(/^\d{4,6}$/, { message: 'pin must be 4–6 digits' }) pin: string;
}

/** Signing in on a paired till: the device's secret picks the business and store, the PIN picks the person. */
export class TillSignInDto {
  /** The secret the till was given when it was paired (POST /devices/:id/token). */
  @IsString()
  @Matches(/^dev_[A-Za-z0-9_-]{20,100}$/, { message: 'deviceToken is not a till token' })
  deviceToken: string;

  @Matches(/^\d{4,6}$/, { message: 'pin must be 4–6 digits' })
  pin: string;
}

export class SwitchTenantDto {
  @IsUUID()
  tenantId: string;
}

export class ChangePasswordDto {
  @IsString()
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}

export const BILLING_PERIODS = ['monthly', 'yearly'] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

/** A request to open a business: the sign-up details plus the plan chosen. */
export class SignupRequestDto extends SignupDto {
  @IsUUID() planId: string;
  @IsIn(BILLING_PERIODS) billingPeriod: BillingPeriod;
  /** Anything the applicant wants Floatly to know. */
  @IsOptional() @Trim() @IsString() @MaxLength(1000) message?: string;
}
