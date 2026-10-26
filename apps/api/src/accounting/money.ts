import { BadRequestException } from '@nestjs/common';

/**
 * Exact decimal arithmetic for accounting. Amounts are held as integer cents
 * (bigint) and only turned back into decimal strings for storage and output,
 * so totals never drift the way floating-point numbers do.
 */

/** Parses a decimal string into an integer scaled by 10^places ("1.5", 3 → 1500n). */
export function parseFixed(value: string | number | null | undefined, places: number): bigint {
  if (value === null || value === undefined || value === '') return 0n;
  const s = String(value).trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new BadRequestException(`Invalid number: ${s}`);
  const [, sign, whole, frac = ''] = m;
  if (frac.length > places && /[1-9]/.test(frac.slice(places))) {
    throw new BadRequestException(`Too many decimal places: ${s}`);
  }
  const v = BigInt(whole) * 10n ** BigInt(places) + BigInt((frac + '0'.repeat(places)).slice(0, places) || '0');
  return sign ? -v : v;
}

export function formatFixed(v: bigint, places: number): string {
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const scale = 10n ** BigInt(places);
  const frac = places ? `.${(abs % scale).toString().padStart(places, '0')}` : '';
  return `${neg ? '-' : ''}${abs / scale}${frac}`;
}

export const toCents = (v: string | number | null | undefined) => parseFixed(v, 2);
export const fromCents = (c: bigint) => formatFixed(c, 2);

/** a ÷ b, rounded half away from zero. */
export function divRound(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new BadRequestException('Division by zero');
  const neg = a < 0n !== b < 0n;
  const [x, y] = [a < 0n ? -a : a, b < 0n ? -b : b];
  const q = (2n * x + y) / (2n * y);
  return neg ? -q : q;
}

/** Converts document-currency cents to base-currency cents. `rate` = units of the currency per 1 base unit. */
export function toBase(cents: bigint, rate: string): bigint {
  const micro = parseFixed(rate, 6);
  if (micro <= 0n) throw new BadRequestException('Exchange rate must be greater than zero');
  return divRound(cents * 1_000_000n, micro);
}

/**
 * Net and tax for one document line. `taxPercent` like "15.50".
 * Inclusive prices have the tax taken out; exclusive prices have it added.
 */
export function lineAmounts(opts: {
  quantity: string;
  unitPrice: string;
  taxPercent: string | null;
  inclusive: boolean;
}): { net: bigint; tax: bigint } {
  const amount = divRound(parseFixed(opts.quantity, 3) * toCents(opts.unitPrice), 1000n);
  const pct = toCents(opts.taxPercent ?? '0'); // hundredths of a percent
  if (!pct) return { net: amount, tax: 0n };
  if (opts.inclusive) {
    const tax = divRound(amount * pct, 10_000n + pct);
    return { net: amount - tax, tax };
  }
  return { net: amount, tax: divRound(amount * pct, 10_000n) };
}

export const sum = (values: bigint[]) => values.reduce((a, b) => a + b, 0n);
