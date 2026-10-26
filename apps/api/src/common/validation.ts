import { NotFoundException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min, registerDecorator, ValidationOptions } from 'class-validator';

const MONEY = /^-?\d{1,12}(\.\d{1,2})?$/;
const QTY = /^-?\d{1,11}(\.\d{1,3})?$/;

function decimalValidator(pattern: RegExp, name: string, allowNegative: boolean) {
  return (options?: ValidationOptions) => (object: object, propertyName: string) => {
    registerDecorator({
      name,
      target: object.constructor,
      propertyName,
      options: {
        message: `${propertyName} must be a ${allowNegative ? '' : 'non-negative '}${name === 'isMoney' ? 'amount with up to 2 decimals' : 'quantity with up to 3 decimals'}`,
        ...options,
      },
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string' || !pattern.test(value)) return false;
          return allowNegative || !value.startsWith('-');
        },
      },
    });
  };
}

/** Accepts a number or numeric string and normalises it to a string for exact decimal storage. */
export const ToDecimalString = () =>
  Transform(({ value }) =>
    typeof value === 'number' && Number.isFinite(value) ? String(value) : value,
  );

/** Money amount ≥ 0, max 2 decimals. Stored as numeric, returned as a string. */
export const IsMoney = decimalValidator(MONEY, 'isMoney', false);
/** Quantity, may be negative (adjustments). Max 3 decimals. */
export const IsSignedQuantity = decimalValidator(QTY, 'isQuantity', true);
/** Quantity ≥ 0. Max 3 decimals. */
export const IsQuantity = decimalValidator(QTY, 'isQuantity', false);

/** Trims strings; turns '' into undefined so optional fields can be cleared by omission. */
export const Trim = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() || undefined : value));

export class ListQuery {
  @IsOptional()
  @IsString()
  @Trim()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize = 50;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** Throws 404 when a lookup came back empty. */
export function found<T>(row: T | undefined | null, what = 'Record'): T {
  if (!row) throw new NotFoundException(`${what} not found`);
  return row;
}

/** Escapes % and _ for use in ILIKE patterns. */
export const likeEscape = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
