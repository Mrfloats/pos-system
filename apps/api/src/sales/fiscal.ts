import type { SaleFiscal } from '../db/schema.js';
import type { FiscalReceiptDto, FiscalResultDto } from './sales.dto.js';

/**
 * ZIMRA fiscalisation happens on the till: it signs each receipt, prints the
 * QR code and sends the receipt to ZIMRA FDMS itself (works offline, ZIMRA's
 * own model). The server keeps a copy of each receipt's fiscal details with the
 * sale, for reprints and for the backoffice to show what ZIMRA has accepted.
 */

/** The sale columns for a receipt the till issued. */
export function fiscalColumns(f: FiscalReceiptDto) {
  const fiscal: SaleFiscal = {
    deviceId: f.deviceId,
    fiscalDayNo: f.fiscalDayNo,
    globalNo: f.globalNo,
    counter: f.counter,
    invoiceNo: f.invoiceNo,
    receiptType: f.receiptType,
    date: f.date,
    qrCode: f.qrCode,
    verificationCode: f.verificationCode,
    hash: f.hash,
    signature: f.signature,
    receiptId: f.receiptId ?? null,
    serverDate: f.serverDate ?? null,
    errors: f.errors?.map((e) => ({ code: e.code, color: e.color, description: e.description })) ?? [],
  };
  return { fiscal, fiscalStatus: f.status, fiscalReference: f.invoiceNo };
}

/** A receipt's fiscal details with ZIMRA's latest answer. */
export function withResult(fiscal: SaleFiscal, r: FiscalResultDto): SaleFiscal {
  return {
    ...fiscal,
    receiptId: r.receiptId ?? fiscal.receiptId ?? null,
    serverDate: r.serverDate ?? fiscal.serverDate ?? null,
    errors: r.errors ? r.errors.map((e) => ({ code: e.code, color: e.color, description: e.description })) : (fiscal.errors ?? []),
  };
}
