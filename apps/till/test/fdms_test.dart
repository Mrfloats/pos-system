import 'package:basic_utils/basic_utils.dart' show X509Utils;
import 'package:floatly_till/fiscal/fdms.dart';
import 'package:floatly_till/fiscal/fdms_keys.dart';
import 'package:floatly_till/models/catalog.dart';
import 'package:flutter_test/flutter_test.dart';

/// The previous-receipt hash used in every example in ZIMRA's spec (section 13.2.1).
const specPrevious = 'hNVJXP/ACOiE8McD3pKsDlqBXpuaUqQOfPnMyfZWI9k=';

const exempt = FdmsTax(id: 1, percent: null, name: 'Exempt');
const zero = FdmsTax(id: 2, percent: 0, name: 'Zero rated');
const vat = FdmsTax(id: 3, percent: 1550, name: 'Standard rated 15.5%');

FdmsTaxLine tax(FdmsTax t, int amount, int sales, [String? code]) => FdmsTaxLine(tax: t, taxAmount: amount, salesAmountWithTax: sales, code: code);

FdmsReceipt receipt({
  required FdmsReceiptType type,
  required String currency,
  required int globalNo,
  required DateTime date,
  required int total,
  required List<FdmsTaxLine> taxes,
}) => FdmsReceipt(
  type: type,
  currency: currency,
  counter: 1,
  globalNo: globalNo,
  invoiceNo: 'x',
  date: date,
  lines: const [],
  taxes: taxes,
  payments: const [],
  total: total,
);

void main() {
  group('signing text (spec 13.2.1)', () {
    test("matches ZIMRA's credit note example and its published hash", () {
      final r = receipt(
        type: FdmsReceiptType.creditNote,
        currency: 'USD',
        globalNo: 85,
        date: DateTime(2020, 9, 19, 9, 23, 7),
        total: -4035,
        // Out of order on purpose: taxes are signed by tax ID.
        taxes: [
          tax(const FdmsTax(id: 3, percent: 1450, name: ''), -300, -2300),
          tax(exempt, 0, -700),
          tax(zero, 0, -1000),
        ],
      );
      final text = r.signingText(322, specPrevious);
      expect(text, '322CREDITNOTEUSD852020-09-19T09:23:07-40350-7000.000-100014.50-300-2300$specPrevious');
      expect(fdmsHash(text), 'F9/QB0vhxQlEF2nk+oebwP8V+qBcNlOFvoTeE/1QxPc=');
    });

    test("matches the layout of ZIMRA's invoice example with tax codes", () {
      final r = receipt(
        type: FdmsReceiptType.fiscalInvoice,
        currency: 'zwl',
        globalNo: 432,
        date: DateTime(2019, 9, 19, 15, 43, 12),
        total: 945000,
        taxes: [
          tax(const FdmsTax(id: 3, percent: 1500, name: ''), 30000, 230000, 'D'),
          tax(const FdmsTax(id: 3, percent: 1500, name: ''), 15000, 115000, 'C'),
          tax(zero, 0, 350000, 'B'),
          tax(exempt, 0, 250000, 'A'),
        ],
      );
      expect(
        r.signingText(321, specPrevious),
        '321FISCALINVOICEZWL4322019-09-19T15:43:12945000A0250000B0.000350000C15.0015000115000D15.0030000230000$specPrevious',
      );
    });

    test('leaves out the previous hash on the first receipt of the day', () {
      final r = receipt(type: FdmsReceiptType.fiscalInvoice, currency: 'USD', globalNo: 1, date: DateTime(2026, 1, 2, 3, 4, 5), total: 5, taxes: [tax(zero, 0, 5)]);
      // 7 · FISCALINVOICE · USD · 1 · date · total 5 · tax "0.00" "0" "5"
      expect(r.signingText(7, null), '7FISCALINVOICEUSD12026-01-02T03:04:0550.0005');
    });

    test('formats tax percents the way ZIMRA signs them', () {
      expect(fdmsPercentText(1500), '15.00');
      expect(fdmsPercentText(1450), '14.50');
      expect(fdmsPercentText(1550), '15.50');
      expect(fdmsPercentText(0), '0.00');
      expect(fdmsPercentText(null), '');
    });

    test("hashes like ZIMRA's FDMS signature example", () {
      const device =
          'YyXTSizBBrMjMk4VQL+sCNr+2AC6aQbDAn9JMV2rk3yJ6MDZwie0wqQW3oisNWrMkeZsuAyFSnFkU2A+pKm91sOHVdjeRBebjQgAQQIMTCVIcYrx+BizQ7Ib9iCdsVI+Jel2nThqQiQzfRef6EgtgsaIAN+PV55xSrHvPkIe+Bc=';
      expect(fdmsHash('${device}483772019-09-19T15:43:12'), 'JQoIo/AgOsvm+PUQpvlQ/U7YMei3m/jbygNrBVfz6Sg=');
    });
  });

  group('fiscal day (spec 6 and 13.3.1)', () {
    test('signs non-zero totals ordered by type, currency, then tax ID or payment kind', () {
      final day = FdmsDayTotals([
        FdmsCounter(type: CounterType.balanceByMoneyType, currency: 'ZWL', moneyType: MoneyType.card, value: 1500000),
        FdmsCounter(type: CounterType.saleByTax, currency: 'ZWL', taxId: 4, percent: 1500, value: 1200),
        FdmsCounter(type: CounterType.saleTaxByTax, currency: 'ZWL', taxId: 4, percent: 1500, value: 230000),
        FdmsCounter(type: CounterType.saleByTax, currency: 'USD', taxId: 3, percent: 1450, value: 2500),
        FdmsCounter(type: CounterType.balanceByMoneyType, currency: 'ZWL', moneyType: MoneyType.cash, value: 2000000),
        FdmsCounter(type: CounterType.saleByTax, currency: 'ZWL', taxId: 2, percent: 0, value: 1200000),
        FdmsCounter(type: CounterType.saleTaxByTax, currency: 'USD', taxId: 3, percent: 1500, value: 250),
        FdmsCounter(type: CounterType.saleByTax, currency: 'ZWL', taxId: 1, value: 2300000),
        FdmsCounter(type: CounterType.balanceByMoneyType, currency: 'USD', moneyType: MoneyType.cash, value: 3700),
        FdmsCounter(type: CounterType.saleTaxByTax, currency: 'ZWL', taxId: 1, value: 0),
      ]);
      expect(
        fdmsDaySigningText(deviceId: 321, dayNo: 84, dayOpened: DateTime(2019, 9, 23, 8), counters: day.counters),
        '321842019-09-23'
        'SALEBYTAXUSD14.502500SALEBYTAXZWL2300000SALEBYTAXZWL0.001200000SALEBYTAXZWL15.001200'
        'SALETAXBYTAXUSD15.00250SALETAXBYTAXZWL15.00230000'
        'BALANCEBYMONEYTYPEUSDCASH3700BALANCEBYMONEYTYPEZWLCASH2000000BALANCEBYMONEYTYPEZWLCARD1500000',
      );
      expect(day.counters.any((c) => c.value == 0), isFalse);
    });

    test('adds invoices and takes credit notes off', () {
      final day = FdmsDayTotals();
      final sale = buildFdmsReceipt(
        type: FdmsReceiptType.fiscalInvoice,
        currency: 'USD',
        items: const [FiscalItem(name: 'Bread', quantity: 2000, unitPrice: 155, total: 310, tax: vat)],
        payments: const [FiscalPay(MoneyType.cash, 310)],
        date: DateTime(2026, 11, 12, 9),
        counter: 1,
        globalNo: 10,
        invoiceNo: '5-10',
      );
      final refund = buildFdmsReceipt(
        type: FdmsReceiptType.creditNote,
        currency: 'USD',
        items: const [FiscalItem(name: 'Bread', quantity: 1000, unitPrice: 155, total: 155, tax: vat)],
        payments: const [FiscalPay(MoneyType.cash, 155)],
        date: DateTime(2026, 11, 12, 10),
        counter: 2,
        globalNo: 11,
        invoiceNo: '5-11',
        notes: 'Stale',
        noteRef: const FdmsNoteRef(deviceId: 5, globalNo: 10, fiscalDayNo: 3),
      );
      day
        ..add(sale)
        ..add(refund);
      final json = {for (final c in day.counters) '${c.type.wire} ${c.moneyType?.wire ?? c.taxId}': c.value};
      expect(json, {
        'SaleByTax 3': 310,
        'SaleTaxByTax 3': 42, // 310 × 15.5 / 115.5
        'CreditNoteByTax 3': -155,
        'CreditNoteTaxByTax 3': -21,
        'BalanceByMoneyType Cash': 155,
      });
      // Kept on the till and read back.
      final again = FdmsDayTotals.fromJson(day.toJson());
      expect(again.counters.map((c) => c.toJson()).toList(), day.counters.map((c) => c.toJson()).toList());
      expect(day.counters.first.toJson(), {'fiscalCounterType': 'SaleByTax', 'fiscalCounterCurrency': 'USD', 'fiscalCounterTaxID': 3, 'fiscalCounterTaxPercent': 15.5, 'fiscalCounterValue': 3.1});
      expect(day.counters.last.toJson(), {'fiscalCounterType': 'BalanceByMoneyType', 'fiscalCounterCurrency': 'USD', 'fiscalCounterMoneyType': 'Cash', 'fiscalCounterValue': 1.55});
    });
  });

  group('building a receipt', () {
    test('groups taxes the way ZIMRA checks them and makes payments add up', () {
      final r = buildFdmsReceipt(
        type: FdmsReceiptType.fiscalInvoice,
        currency: 'usd',
        items: const [
          FiscalItem(name: 'Cooking oil 2L', quantity: 3000, unitPrice: 450, total: 1350, tax: vat, hsCode: '15079000'),
          FiscalItem(name: 'Maize meal', quantity: 1000, unitPrice: 800, total: 720, tax: exempt, hsCode: '11022000'), // discounted
          FiscalItem(name: 'Tomatoes', quantity: 375, unitPrice: 299, total: 112, tax: exempt, hsCode: '07020000'), // 0.375 kg
          FiscalItem(name: 'Soap', quantity: 1000, unitPrice: 100, total: 116, tax: vat, priceIncludesTax: false, hsCode: '3401'),
        ],
        // A USD sale paid partly in ZiG: converted amounts may be a cent out.
        payments: const [FiscalPay(MoneyType.cash, 1000), FiscalPay(MoneyType.mobileWallet, 1297)],
        date: DateTime(2026, 11, 12, 14, 5, 9),
        counter: 4,
        globalNo: 120,
        invoiceNo: '12345-120',
        buyer: FdmsBuyer.from(name: 'Acme (Pvt) Ltd', tin: '2000123456', vatNumber: '220012345'),
        username: 'Tendai',
      );
      expect(r.total, 2298);
      expect(r.lines.map((l) => l.price), [450, null, null, null]);
      expect(r.taxes.map((t) => (t.tax.id, t.salesAmountWithTax, t.taxAmount)), [(3, 1466, 197), (1, 832, 0)]);
      expect(r.payments.map((p) => (p.type, p.amount)), [(MoneyType.cash, 1000), (MoneyType.mobileWallet, 1298)]);
      final json = r.toJson();
      expect(json['receiptCurrency'], 'USD');
      expect(json['receiptDate'], '2026-11-12T14:05:09');
      expect(json['receiptLinesTaxInclusive'], true);
      expect(json['buyerData'], {'buyerRegisterName': 'Acme (Pvt) Ltd', 'vatNumber': '220012345', 'buyerTIN': '2000123456'});
      expect((json['receiptLines'] as List)[2], {
        'receiptLineType': 'Sale',
        'receiptLineNo': 3,
        'receiptLineHSCode': '07020000',
        'receiptLineName': 'Tomatoes',
        'receiptLineQuantity': 0.375,
        'receiptLineTotal': 1.12,
        'taxID': 1,
      });
      expect(json['userInfo'], {'username': 'Tendai', 'userFullName': 'Tendai'});
      // What the till keeps reads back the same.
      expect(FdmsReceipt.fromJson(json).toJson(), json);
    });

    test('makes everything negative on a credit note', () {
      final r = buildFdmsReceipt(
        type: FdmsReceiptType.creditNote,
        currency: 'USD',
        items: const [FiscalItem(name: 'Bread', quantity: 1000, unitPrice: 155, total: 155, tax: vat)],
        payments: const [FiscalPay(MoneyType.card, 155)],
        date: DateTime(2026, 11, 12),
        counter: 1,
        globalNo: 2,
        invoiceNo: '5-2',
        notes: 'Customer returned it',
        noteRef: const FdmsNoteRef(deviceId: 5, globalNo: 1, fiscalDayNo: 1),
      );
      final json = r.toJson();
      expect(json['receiptTotal'], -1.55);
      expect((json['receiptLines'] as List).single, containsPair('receiptLinePrice', -1.55));
      expect((json['receiptTaxes'] as List).single, {'taxPercent': 15.5, 'taxID': 3, 'taxAmount': -0.21, 'salesAmountWithTax': -1.55});
      expect(json['receiptPayments'], [
        {'moneyTypeCode': 'Card', 'paymentAmount': -1.55},
      ]);
      expect(json['creditDebitNote'], {'deviceID': 5, 'receiptGlobalNo': 1, 'fiscalDayNo': 1});
    });

    test('accepts only proper buyer tax numbers', () {
      expect(FdmsBuyer.from(name: 'Acme', tin: '123'), isNull);
      expect(FdmsBuyer.from(name: '', tin: '2000123456'), isNull);
      expect(FdmsBuyer.from(name: 'Acme', tin: '2000 123 456', vatNumber: 'n/a')!.toJson(), {'buyerRegisterName': 'Acme', 'buyerTIN': '2000123456'});
    });

    test('checks HS codes as ZIMRA does', () {
      expect(hsCodeProblem(null, vatPayer: false, tax: vat), isNull);
      expect(hsCodeProblem(null, vatPayer: true, tax: vat), 'needs an HS code');
      expect(hsCodeProblem('123', vatPayer: true, tax: vat), 'HS code must be 4 or 8 digits');
      expect(hsCodeProblem('3401', vatPayer: true, tax: vat), isNull);
      expect(hsCodeProblem('1102', vatPayer: true, tax: exempt), 'HS code must be 8 digits for 0% and exempt items');
      expect(hsCodeProblem('11022000', vatPayer: true, tax: zero), isNull);
    });
  });

  group("ZIMRA's taxes", () {
    final taxes = [
      FdmsTax.fromJson({'taxID': 1, 'taxName': 'Exempt', 'validFrom': '2023-01-01T00:00:00'}),
      FdmsTax.fromJson({'taxID': 2, 'taxPercent': 0, 'taxName': 'Zero rated 0%', 'validFrom': '2023-01-01T00:00:00'}),
      FdmsTax.fromJson({'taxID': 3, 'taxPercent': 15.0, 'taxName': 'Standard rated 15%', 'validFrom': '2023-01-01T00:00:00', 'validTill': '2024-12-31T00:00:00'}),
      FdmsTax.fromJson({'taxID': 517, 'taxPercent': 15.5, 'taxName': 'Standard rated 15.5%', 'validFrom': '2025-01-01T00:00:00'}),
    ];
    TaxRate rate(String pct, [int? fiscalTaxId]) => TaxRate.fromJson({'id': 'r', 'name': 'VAT', 'rate': pct, 'fiscalTaxId': fiscalTaxId});
    final today = DateTime(2026, 11, 12);

    test('finds the tax for a rate by percent, on the day', () {
      expect(fdmsTaxFor(rate('15.50'), taxes, today)!.id, 517);
      expect(fdmsTaxFor(rate('15.00'), taxes, today), isNull, reason: '15% ended in 2024');
      expect(fdmsTaxFor(rate('15.00'), taxes, DateTime(2024, 6, 1))!.id, 3);
      expect(fdmsTaxFor(rate('0'), taxes, today)!.id, 2);
      expect(fdmsTaxFor(null, taxes, today)!.id, 1, reason: 'no tax rate is exempt');
    });

    test('uses the tax named in the backoffice', () {
      expect(fdmsTaxFor(rate('0', 1), taxes, today)!.id, 1);
      expect(fdmsTaxFor(rate('15.50', 99), taxes, today), isNull);
    });
  });

  group('QR code (spec 11)', () {
    test("builds ZIMRA's example", () {
      expect(
        fdmsQrCode(qrUrl: 'https://invoice.zimra.co.zw', deviceId: 321, date: DateTime(2023, 4, 3, 10), globalNo: 1112223331, qrData: '4C8BE27663330417'),
        'https://invoice.zimra.co.zw/00000003210304202311122233314C8BE27663330417',
      );
      expect(
        fdmsQrCode(qrUrl: 'https://invoice.zimra.co.zw/', deviceId: 322, date: DateTime(2023, 4, 4), globalNo: 1332, qrData: 'C10B0476B3B14678'),
        'https://invoice.zimra.co.zw/00000003220404202300000013 32C10B0476B3B14678'.replaceAll(' ', ''),
      );
    });

    test('takes the check characters from the MD5 of the signature', () {
      const signature =
          'YyXTSizBBrMjMk4VQL+sCNr+2AC6aQbDAn9JMV2rk3yJ6MDZwie0wqQW3oisNWrMkeZsuAyFSnFkU2A+pKm91sOHVdjeRBebjQgAQQIMTCVIcYrx+BizQ7Ib9iCdsVI+Jel2nThqQiQzfRef6EgtgsaIAN+PV55xSrHvPkIe+Bc=';
      expect(fdmsQrData(signature), 'C2D166DBFFC6CB19');
      expect(fdmsVerificationCode(signature), 'C2D1-66DB-FFC6-CB19');
    });
  });

  group('device key', () {
    final key = DeviceKey.generate();

    test('signs receipts so they verify, and only for that text', () {
      const text = '7FISCALINVOICEUSD12026-01-02T03:04:0550.00005';
      final s = key.sign(text);
      expect(s.hash, fdmsHash(text));
      expect(key.verify(text, s.signature), isTrue);
      expect(key.verify('${text}x', s.signature), isFalse);
      expect(key.sign(text).signature, s.signature, reason: 'deterministic (RFC 6979)');
      expect(DeviceKey.generate().verify(text, s.signature), isFalse);
    });

    test('survives being kept as PEM', () {
      final again = DeviceKey.fromPem(key.pem);
      expect(key.pem, startsWith('-----BEGIN EC PRIVATE KEY-----'));
      expect(again.verify('abc', key.sign('abc').signature), isTrue);
    });

    test('asks for a certificate in the name ZIMRA gave the device', () {
      final csr = key.csr(serialNo: 'FLT-0001', deviceId: 187);
      expect(csr, startsWith('-----BEGIN CERTIFICATE REQUEST-----'));
      final parsed = X509Utils.csrFromPem(csr);
      expect(parsed.certificationRequestInfo!.subject!['2.5.4.3'], 'ZIMRA-FLT-0001-0000000187');
      expect(fdmsDeviceName('SN: 001', 187), 'ZIMRA-SN: 001-0000000187');
    });
  });
}
