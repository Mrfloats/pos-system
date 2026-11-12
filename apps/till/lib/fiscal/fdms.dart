/// ZIMRA fiscalisation: the receipt and fiscal-day data a till sends to FDMS
/// (Fiscal Device Gateway API v7.2), the exact text it signs, its running day
/// totals ("fiscal counters") and the QR code printed on every receipt.
///
/// No network and no Flutter here, so all of it is unit-tested; see
/// test/fdms_test.dart, which checks it against the examples in ZIMRA's spec.
/// Amounts are whole cents and quantities whole thousandths, as in the rest of the till.
library;

import 'dart:convert';

import 'package:crypto/crypto.dart' as hashes;

import '../core/money.dart';
import '../models/catalog.dart' show TaxRate;

enum FdmsReceiptType {
  fiscalInvoice('FiscalInvoice'),
  creditNote('CreditNote'),
  debitNote('DebitNote');

  const FdmsReceiptType(this.wire);

  /// The value ZIMRA expects in JSON.
  final String wire;

  static FdmsReceiptType parse(String s) => values.firstWhere((v) => v.wire == s);
}

/// How a receipt was paid. Declared in ZIMRA's order, which day totals are sorted by.
enum MoneyType {
  cash('Cash'),
  card('Card'),
  mobileWallet('MobileWallet'),
  coupon('Coupon'),
  credit('Credit'),
  bankTransfer('BankTransfer'),
  other('Other');

  const MoneyType(this.wire);
  final String wire;

  static MoneyType parse(String s) => values.firstWhere((v) => v.wire == s);
}

/// The day totals a till keeps and reports when it closes a fiscal day, in ZIMRA's order.
enum CounterType {
  saleByTax('SaleByTax'),
  saleTaxByTax('SaleTaxByTax'),
  creditNoteByTax('CreditNoteByTax'),
  creditNoteTaxByTax('CreditNoteTaxByTax'),
  debitNoteByTax('DebitNoteByTax'),
  debitNoteTaxByTax('DebitNoteTaxByTax'),
  balanceByMoneyType('BalanceByMoneyType');

  const CounterType(this.wire);
  final String wire;

  bool get byTax => this != balanceByMoneyType;

  static CounterType parse(String s) => values.firstWhere((v) => v.wire == s);
}

/// A decimal for ZIMRA's JSON, from whole cents (or hundredths of a percent).
num _dec(int cents) => num.parse(fromCents(cents));

/// Whole cents from a JSON number or string.
int _cents(Object? v) => v == null ? 0 : toCents(v is num ? _plain(v) : v.toString());

/// A JSON number as plain text ("1.5", never "1.5e-7").
String _plain(num v) => v is int ? '$v' : v.toStringAsFixed(6);

/// Date and time as ZIMRA wants it: local time, no time zone, e.g. 2019-09-23T14:43:23.
String fdmsDateTime(DateTime d) => '${fdmsDate(d)}T${_two(d.hour)}:${_two(d.minute)}:${_two(d.second)}';

/// A date as ZIMRA wants it: 2019-09-23.
String fdmsDate(DateTime d) => '${d.year.toString().padLeft(4, '0')}-${_two(d.month)}-${_two(d.day)}';

/// Reads ZIMRA's local date-times (2019-09-23T14:43:23, maybe with fractions) as local time.
DateTime parseFdmsDateTime(String s) {
  final m = RegExp(r'^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?').firstMatch(s);
  if (m == null) throw FormatException('Not a date: $s');
  int g(int i) => int.parse(m.group(i) ?? '0');
  return DateTime(g(1), g(2), g(3), g(4), g(5), g(6));
}

String _two(int n) => n.toString().padLeft(2, '0');

/// A tax ZIMRA lets this taxpayer use (from getConfig's applicableTaxes).
class FdmsTax {
  const FdmsTax({required this.id, required this.percent, required this.name, this.validFrom, this.validTill});

  FdmsTax.fromJson(Map<String, dynamic> j)
    : id = j['taxID'] as int,
      percent = j['taxPercent'] == null ? null : _cents(j['taxPercent']),
      name = j['taxName'] as String? ?? '',
      validFrom = j['validFrom'] as String? ?? j['taxValidFrom'] as String?,
      validTill = j['validTill'] as String? ?? j['taxValidTill'] as String?;

  final int id;

  /// Hundredths of a percent (15.5% is 1550). Null: exempt.
  final int? percent;
  final String name;

  /// ISO dates (maybe with a time) from and until which ZIMRA accepts it.
  final String? validFrom, validTill;

  bool get exempt => percent == null;

  bool validOn(DateTime d) {
    final day = fdmsDate(d);
    if (validFrom != null && day.compareTo(validFrom!.substring(0, 10)) < 0) return false;
    if (validTill != null && day.compareTo(validTill!.substring(0, 10)) > 0) return false;
    return true;
  }

  Map<String, dynamic> toJson() => {
    'taxID': id,
    if (percent != null) 'taxPercent': _dec(percent!),
    'taxName': name,
    if (validFrom != null) 'validFrom': validFrom,
    if (validTill != null) 'validTill': validTill,
  };
}

/// Whether a business's tax rate is "exempt" rather than zero-rated: both are
/// 0%, but ZIMRA treats them as different taxes. Floatly names it Exempt (code EXEMPT).
bool isExemptRate(TaxRate rate) => rate.hundredths == 0 && (rate.code.toUpperCase() == 'EXEMPT' || rate.name.toLowerCase().contains('exempt'));

/// Which ZIMRA tax a product's tax rate is: the one named in the backoffice
/// ([TaxRate.fiscalTaxId]) if set, else ZIMRA's exempt tax for an Exempt rate,
/// else the one with the same percent valid on [date]. No tax rate means
/// exempt (or 0% if ZIMRA offers no exempt tax). Null when nothing matches:
/// the sale can't be fiscalised as it is.
FdmsTax? fdmsTaxFor(TaxRate? rate, List<FdmsTax> taxes, DateTime date) {
  final valid = taxes.where((t) => t.validOn(date)).toList();
  if (rate?.fiscalTaxId != null) return valid.where((t) => t.id == rate!.fiscalTaxId).firstOrNull;
  if (rate == null) return valid.where((t) => t.exempt).firstOrNull ?? valid.where((t) => t.percent == 0).firstOrNull;
  if (isExemptRate(rate)) return valid.where((t) => t.exempt).firstOrNull;
  return valid.where((t) => t.percent == rate.hundredths).firstOrNull;
}

/// "15.00", "14.50", "0.00", or "" for exempt: a tax percent the way ZIMRA signs it.
String fdmsPercentText(int? hundredths) => hundredths == null ? '' : formatFixed(hundredths, 2);

/// Base64 SHA-256 of the signing text: the `hash` ZIMRA expects with every signature.
String fdmsHash(String text) => base64.encode(hashes.sha256.convert(utf8.encode(text)).bytes);

/// What the hash and signature cover.
class SignatureData {
  const SignatureData({required this.hash, required this.signature});

  SignatureData.fromJson(Map<String, dynamic> j) : hash = j['hash'] as String, signature = j['signature'] as String;

  /// Base64 SHA-256 of the signed text.
  final String hash;

  /// Base64 signature (DER for ECDSA keys).
  final String signature;

  Map<String, dynamic> toJson() => {'hash': hash, 'signature': signature};
}

/// One line of a ZIMRA receipt.
class FdmsLine {
  const FdmsLine({required this.no, required this.name, required this.quantity, required this.total, required this.tax, this.price, this.hsCode, this.discount = false});

  FdmsLine.fromJson(Map<String, dynamic> j)
    : no = j['receiptLineNo'] as int,
      name = j['receiptLineName'] as String,
      hsCode = j['receiptLineHSCode'] as String?,
      quantity = parseFixed(j['receiptLineQuantity'] is num ? _plain(j['receiptLineQuantity'] as num) : j['receiptLineQuantity'], 3),
      price = j['receiptLinePrice'] == null ? null : _cents(j['receiptLinePrice']),
      total = _cents(j['receiptLineTotal']),
      discount = j['receiptLineType'] == 'Discount',
      tax = FdmsTax(id: j['taxID'] as int, percent: j['taxPercent'] == null ? null : _cents(j['taxPercent']), name: '');

  final int no;
  final String name;
  final String? hsCode;

  /// Thousandths, always positive.
  final int quantity;

  /// Price of one, tax included; null when quantity × price isn't exactly the total (ZIMRA allows leaving it out).
  final int? price;

  /// Tax included, after discount. Negative on credit notes.
  final int total;
  final FdmsTax tax;
  final bool discount;

  Map<String, dynamic> toJson() => {
    'receiptLineType': discount ? 'Discount' : 'Sale',
    'receiptLineNo': no,
    if (hsCode != null) 'receiptLineHSCode': hsCode,
    'receiptLineName': name,
    if (price != null) 'receiptLinePrice': _dec(price!),
    'receiptLineQuantity': num.parse(formatFixed(quantity, 3)),
    'receiptLineTotal': _dec(total),
    if (tax.percent != null) 'taxPercent': _dec(tax.percent!),
    'taxID': tax.id,
  };
}

/// A receipt's total for one tax.
class FdmsTaxLine {
  const FdmsTaxLine({required this.tax, required this.taxAmount, required this.salesAmountWithTax, this.code});

  FdmsTaxLine.fromJson(Map<String, dynamic> j)
    : tax = FdmsTax(id: j['taxID'] as int, percent: j['taxPercent'] == null ? null : _cents(j['taxPercent']), name: ''),
      code = j['taxCode'] as String?,
      taxAmount = _cents(j['taxAmount']),
      salesAmountWithTax = _cents(j['salesAmountWithTax']);

  final FdmsTax tax;

  /// ZIMRA's optional short tax code (A, B…). The till doesn't use them; the spec's examples do.
  final String? code;
  final int taxAmount, salesAmountWithTax;

  Map<String, dynamic> toJson() => {
    if (code != null) 'taxCode': code,
    if (tax.percent != null) 'taxPercent': _dec(tax.percent!),
    'taxID': tax.id,
    'taxAmount': _dec(taxAmount),
    'salesAmountWithTax': _dec(salesAmountWithTax),
  };
}

class FdmsPayment {
  const FdmsPayment(this.type, this.amount);

  FdmsPayment.fromJson(Map<String, dynamic> j) : type = MoneyType.parse(j['moneyTypeCode'] as String), amount = _cents(j['paymentAmount']);

  final MoneyType type;

  /// Receipt-currency cents kept (change already taken off). Negative on credit notes.
  final int amount;

  Map<String, dynamic> toJson() => {'moneyTypeCode': type.wire, 'paymentAmount': _dec(amount)};
}

/// The buyer, for a tax invoice to a registered business. ZIMRA wants both name and TIN or neither.
class FdmsBuyer {
  const FdmsBuyer({required this.name, required this.tin, this.vatNumber, this.tradeName});

  FdmsBuyer.fromJson(Map<String, dynamic> j)
    : name = j['buyerRegisterName'] as String,
      tin = j['buyerTIN'] as String,
      vatNumber = j['vatNumber'] as String?,
      tradeName = j['buyerTradeName'] as String?;

  final String name, tin;
  final String? vatNumber, tradeName;

  /// Buyer details ZIMRA will accept, or null: a TIN is 10 digits and a VAT number 9.
  static FdmsBuyer? from({required String? name, required String? tin, String? vatNumber}) {
    final t = (tin ?? '').replaceAll(RegExp(r'\s'), '');
    if (name == null || name.trim().isEmpty || !RegExp(r'^\d{10}$').hasMatch(t)) return null;
    final v = (vatNumber ?? '').replaceAll(RegExp(r'\s'), '');
    return FdmsBuyer(name: _cut(name.trim(), 250), tin: t, vatNumber: RegExp(r'^\d{9}$').hasMatch(v) ? v : null);
  }

  Map<String, dynamic> toJson() => {
    'buyerRegisterName': name,
    if (tradeName != null) 'buyerTradeName': tradeName,
    if (vatNumber != null) 'vatNumber': vatNumber,
    'buyerTIN': tin,
  };
}

/// The receipt a credit (or debit) note corrects: by ZIMRA's receipt ID, or by device, number and day.
class FdmsNoteRef {
  const FdmsNoteRef({this.receiptId, this.deviceId, this.globalNo, this.fiscalDayNo});

  FdmsNoteRef.fromJson(Map<String, dynamic> j)
    : receiptId = j['receiptID'] as int?,
      deviceId = j['deviceID'] as int?,
      globalNo = j['receiptGlobalNo'] as int?,
      fiscalDayNo = j['fiscalDayNo'] as int?;

  final int? receiptId, deviceId, globalNo, fiscalDayNo;

  Map<String, dynamic> toJson() => receiptId != null
      ? {'receiptID': receiptId}
      : {'deviceID': deviceId, 'receiptGlobalNo': globalNo, 'fiscalDayNo': fiscalDayNo};
}

String _cut(String s, int max) => s.length <= max ? s : s.substring(0, max);

/// A fiscal invoice, credit note or debit note, as sent to ZIMRA (submitReceipt).
class FdmsReceipt {
  FdmsReceipt({
    required this.type,
    required this.currency,
    required this.counter,
    required this.globalNo,
    required this.invoiceNo,
    required this.date,
    required this.lines,
    required this.taxes,
    required this.payments,
    required this.total,
    this.buyer,
    this.notes,
    this.noteRef,
    this.username,
    this.userFullName,
    this.signature,
  });

  FdmsReceipt.fromJson(Map<String, dynamic> j)
    : type = FdmsReceiptType.parse(j['receiptType'] as String),
      currency = j['receiptCurrency'] as String,
      counter = j['receiptCounter'] as int,
      globalNo = j['receiptGlobalNo'] as int,
      invoiceNo = j['invoiceNo'] as String,
      date = parseFdmsDateTime(j['receiptDate'] as String),
      lines = [for (final l in j['receiptLines'] as List) FdmsLine.fromJson((l as Map).cast())],
      taxes = [for (final t in j['receiptTaxes'] as List) FdmsTaxLine.fromJson((t as Map).cast())],
      payments = [for (final p in j['receiptPayments'] as List) FdmsPayment.fromJson((p as Map).cast())],
      total = _cents(j['receiptTotal']),
      buyer = j['buyerData'] == null ? null : FdmsBuyer.fromJson((j['buyerData'] as Map).cast()),
      notes = j['receiptNotes'] as String?,
      noteRef = j['creditDebitNote'] == null ? null : FdmsNoteRef.fromJson((j['creditDebitNote'] as Map).cast()),
      username = (j['userInfo'] as Map?)?['username'] as String?,
      userFullName = (j['userInfo'] as Map?)?['userFullName'] as String?,
      signature = j['receiptDeviceSignature'] == null ? null : SignatureData.fromJson((j['receiptDeviceSignature'] as Map).cast());

  final FdmsReceiptType type;

  /// ISO 4217, e.g. USD or ZWG.
  final String currency;

  /// 1, 2, 3… within the fiscal day.
  final int counter;

  /// 1, 2, 3… for the life of the device.
  final int globalNo;

  /// Unique for the taxpayer; the till uses `deviceID-globalNo`.
  final String invoiceNo;

  /// When it was printed, the till's local time.
  final DateTime date;
  final List<FdmsLine> lines;
  final List<FdmsTaxLine> taxes;
  final List<FdmsPayment> payments;
  final int total;
  final FdmsBuyer? buyer;

  /// The reason, required on credit and debit notes.
  final String? notes;
  final FdmsNoteRef? noteRef;
  final String? username, userFullName;

  /// Set once signed.
  SignatureData? signature;

  /// The text the device signs (spec 13.2.1). [previousHash] is the hash of
  /// the receipt before this one in the same fiscal day; null for the first.
  String signingText(int deviceId, String? previousHash) {
    final sorted = [...taxes]..sort((a, b) => a.tax.id != b.tax.id ? a.tax.id.compareTo(b.tax.id) : (a.code ?? '').compareTo(b.code ?? ''));
    final b = StringBuffer()
      ..write(deviceId)
      ..write(type.wire.toUpperCase())
      ..write(currency.toUpperCase())
      ..write(globalNo)
      ..write(fdmsDateTime(date))
      ..write(total);
    for (final t in sorted) {
      b
        ..write(t.code ?? '')
        ..write(fdmsPercentText(t.tax.percent))
        ..write(t.taxAmount)
        ..write(t.salesAmountWithTax);
    }
    b.write(previousHash ?? '');
    return b.toString();
  }

  /// What ZIMRA's submitReceipt takes in its `receipt` field.
  Map<String, dynamic> toJson() => {
    'receiptType': type.wire,
    'receiptCurrency': currency,
    'receiptCounter': counter,
    'receiptGlobalNo': globalNo,
    'invoiceNo': invoiceNo,
    if (buyer != null) 'buyerData': buyer!.toJson(),
    if (notes != null) 'receiptNotes': notes,
    'receiptDate': fdmsDateTime(date),
    if (noteRef != null) 'creditDebitNote': noteRef!.toJson(),
    'receiptLinesTaxInclusive': true,
    'receiptLines': [for (final l in lines) l.toJson()],
    'receiptTaxes': [for (final t in taxes) t.toJson()],
    'receiptPayments': [for (final p in payments) p.toJson()],
    'receiptTotal': _dec(total),
    'receiptPrintForm': 'Receipt48',
    if (signature != null) 'receiptDeviceSignature': signature!.toJson(),
    if (username != null) 'userInfo': {'username': username, 'userFullName': userFullName ?? username},
  };
}

/// One item on a sale or refund, as the till priced it.
class FiscalItem {
  const FiscalItem({required this.name, required this.quantity, required this.unitPrice, required this.total, required this.tax, this.hsCode, this.priceIncludesTax = true});

  final String name;

  /// Thousandths, positive.
  final int quantity;

  /// Price of one before discount, receipt-currency cents.
  final int unitPrice;

  /// What the line comes to, tax included and discount taken off. Positive, also on refunds.
  final int total;
  final FdmsTax tax;
  final String? hsCode;

  /// The shelf price already had the tax in it.
  final bool priceIncludesTax;
}

/// Money kept for a sale (or given back for a refund), already in the receipt currency. Positive.
class FiscalPay {
  const FiscalPay(this.type, this.amount);
  final MoneyType type;
  final int amount;
}

/// Puts a sale (or refund, as a credit note) into ZIMRA's form: all lines tax
/// inclusive, one tax line per ZIMRA tax with the tax worked out the way ZIMRA
/// checks it, and payments that add up to exactly the total. Not signed yet.
FdmsReceipt buildFdmsReceipt({
  required FdmsReceiptType type,
  required String currency,
  required List<FiscalItem> items,
  required List<FiscalPay> payments,
  required DateTime date,
  required int counter,
  required int globalNo,
  required String invoiceNo,
  FdmsBuyer? buyer,
  String? notes,
  FdmsNoteRef? noteRef,
  String? username,
  String? userFullName,
}) {
  if (items.isEmpty) throw ArgumentError('A receipt needs at least one line');
  final sign = type == FdmsReceiptType.creditNote ? -1 : 1;
  final lines = <FdmsLine>[];
  for (final (i, item) in items.indexed) {
    final exact = item.priceIncludesTax && item.unitPrice > 0 && (item.unitPrice * item.quantity) % 1000 == 0 && item.unitPrice * item.quantity ~/ 1000 == item.total;
    lines.add(
      FdmsLine(
        no: i + 1,
        name: _cut(item.name, 200),
        hsCode: item.hsCode,
        quantity: item.quantity,
        price: exact ? sign * item.unitPrice : null,
        total: sign * item.total,
        tax: item.tax,
      ),
    );
  }

  // One tax line per ZIMRA tax, in order of first use.
  final groups = <int, (FdmsTax, int)>{};
  for (final l in lines) {
    final g = groups[l.tax.id];
    groups[l.tax.id] = (l.tax, (g?.$2 ?? 0) + l.total);
  }
  final taxes = [
    for (final (tax, sales) in groups.values)
      FdmsTaxLine(tax: tax, salesAmountWithTax: sales, taxAmount: (tax.percent ?? 0) == 0 ? 0 : divRound(sales * tax.percent!, 10000 + tax.percent!)),
  ];
  final total = lines.fold(0, (a, l) => a + l.total);

  // Payments by kind, made to add up to the total exactly (conversions between currencies round).
  final byType = <MoneyType, int>{};
  for (final p in payments) {
    byType[p.type] = (byType[p.type] ?? 0) + sign * p.amount;
  }
  if (byType.isEmpty) byType[MoneyType.cash] = 0;
  final diff = total - byType.values.fold<int>(0, (a, b) => a + b);
  if (diff != 0) {
    final biggest = byType.entries.reduce((a, b) => b.value.abs() > a.value.abs() ? b : a).key;
    byType[biggest] = byType[biggest]! + diff;
  }

  return FdmsReceipt(
    type: type,
    currency: currency.toUpperCase(),
    counter: counter,
    globalNo: globalNo,
    invoiceNo: _cut(invoiceNo, 50),
    date: date,
    lines: lines,
    taxes: taxes,
    payments: [for (final e in byType.entries) FdmsPayment(e.key, e.value)],
    total: total,
    buyer: buyer,
    notes: notes == null ? null : _cut(notes, 500),
    noteRef: noteRef,
    username: username == null ? null : _cut(username, 100),
    userFullName: userFullName == null ? null : _cut(userFullName, 250),
  );
}

/// Why ZIMRA would refuse this HS code (RCPT047/RCPT048), or null if it's fine.
/// VAT-registered businesses must send one on every line: 8 digits for 0% and
/// exempt items, 4 or 8 otherwise.
String? hsCodeProblem(String? hsCode, {required bool vatPayer, required FdmsTax tax}) {
  final code = hsCode?.trim() ?? '';
  if (code.isEmpty) return vatPayer ? 'needs an HS code' : null;
  if (!RegExp(r'^(\d{4}|\d{8})$').hasMatch(code)) return 'HS code must be 4 or 8 digits';
  if (vatPayer && (tax.percent ?? 0) == 0 && code.length != 8) return 'HS code must be 8 digits for 0% and exempt items';
  return null;
}

/// One fiscal day total.
class FdmsCounter {
  FdmsCounter({required this.type, required this.currency, this.taxId, this.percent, this.moneyType, this.value = 0});

  FdmsCounter.fromJson(Map<String, dynamic> j)
    : type = CounterType.parse(j['fiscalCounterType'] as String),
      currency = j['fiscalCounterCurrency'] as String,
      taxId = j['fiscalCounterTaxID'] as int?,
      percent = j['fiscalCounterTaxPercent'] == null ? null : _cents(j['fiscalCounterTaxPercent']),
      moneyType = j['fiscalCounterMoneyType'] == null ? null : MoneyType.parse(j['fiscalCounterMoneyType'] as String),
      value = _cents(j['fiscalCounterValue']);

  final CounterType type;
  final String currency;

  /// For the "by tax" totals.
  final int? taxId, percent;

  /// For BalanceByMoneyType.
  final MoneyType? moneyType;
  int value;

  String get key => '${type.wire}|$currency|${taxId ?? ''}|${moneyType?.wire ?? ''}';

  Map<String, dynamic> toJson() => {
    'fiscalCounterType': type.wire,
    'fiscalCounterCurrency': currency,
    if (type.byTax) 'fiscalCounterTaxID': taxId,
    if (type.byTax && percent != null) 'fiscalCounterTaxPercent': _dec(percent!),
    if (!type.byTax) 'fiscalCounterMoneyType': moneyType!.wire,
    'fiscalCounterValue': _dec(value),
  };
}

/// A fiscal day's running totals (spec section 6), kept as receipts are issued
/// and sent with closeDay.
class FdmsDayTotals {
  FdmsDayTotals([Iterable<FdmsCounter> counters = const []]) {
    for (final c in counters) {
      _counters[c.key] = c;
    }
  }

  FdmsDayTotals.fromJson(List<dynamic> j) : this([for (final c in j) FdmsCounter.fromJson((c as Map).cast())]);

  final _counters = <String, FdmsCounter>{};

  /// Adds a receipt. Credit note amounts are negative, so they bring their totals down.
  void add(FdmsReceipt r) {
    final (byTax, taxOf) = switch (r.type) {
      FdmsReceiptType.fiscalInvoice => (CounterType.saleByTax, CounterType.saleTaxByTax),
      FdmsReceiptType.creditNote => (CounterType.creditNoteByTax, CounterType.creditNoteTaxByTax),
      FdmsReceiptType.debitNote => (CounterType.debitNoteByTax, CounterType.debitNoteTaxByTax),
    };
    final currency = r.currency.toUpperCase();
    for (final t in r.taxes) {
      _add(FdmsCounter(type: byTax, currency: currency, taxId: t.tax.id, percent: t.tax.percent), t.salesAmountWithTax);
      _add(FdmsCounter(type: taxOf, currency: currency, taxId: t.tax.id, percent: t.tax.percent), t.taxAmount);
    }
    for (final p in r.payments) {
      _add(FdmsCounter(type: CounterType.balanceByMoneyType, currency: currency, moneyType: p.type), p.amount);
    }
  }

  void _add(FdmsCounter c, int amount) => (_counters[c.key] ??= c).value += amount;

  /// The totals ZIMRA wants: non-zero ones only, ordered by type, currency, then tax ID or payment kind.
  List<FdmsCounter> get counters {
    final list = _counters.values.where((c) => c.value != 0).toList()
      ..sort((a, b) {
        if (a.type != b.type) return a.type.index.compareTo(b.type.index);
        final cur = a.currency.toUpperCase().compareTo(b.currency.toUpperCase());
        if (cur != 0) return cur;
        if (a.type.byTax) return (a.taxId ?? -1).compareTo(b.taxId ?? -1);
        return a.moneyType!.index.compareTo(b.moneyType!.index);
      });
    return list;
  }

  /// Every total, zero or not, for keeping on the till.
  List<Map<String, dynamic>> toJson() => [for (final c in _counters.values) c.toJson()];
}

/// The text the device signs to close a fiscal day (spec 13.3.1).
String fdmsDaySigningText({required int deviceId, required int dayNo, required DateTime dayOpened, required List<FdmsCounter> counters}) {
  final b = StringBuffer()
    ..write(deviceId)
    ..write(dayNo)
    ..write(fdmsDate(dayOpened));
  for (final c in counters) {
    if (c.value == 0) continue;
    b
      ..write(c.type.wire.toUpperCase())
      ..write(c.currency.toUpperCase())
      ..write(c.type.byTax ? fdmsPercentText(c.percent) : c.moneyType!.wire.toUpperCase())
      ..write(c.value);
  }
  return b.toString();
}

/// The 16 characters ZIMRA checks a receipt by: the start of the MD5 of its signature, in capitals.
String fdmsQrData(String signatureBase64) => hashes.md5.convert(base64.decode(signatureBase64)).toString().substring(0, 16).toUpperCase();

/// The same, in fours for people to type: 4C8B-E276-6333-0417.
String fdmsVerificationCode(String signatureBase64) {
  final d = fdmsQrData(signatureBase64);
  return [for (var i = 0; i < 16; i += 4) d.substring(i, i + 4)].join('-');
}

/// The QR code's content (spec section 11): ZIMRA's link, the device, date,
/// receipt number and check characters, e.g.
/// https://invoice.zimra.co.zw/0000000321030420231112223331 4C8BE27663330417 (without the space).
String fdmsQrCode({required String qrUrl, required int deviceId, required DateTime date, required int globalNo, required String qrData}) {
  final base = qrUrl.endsWith('/') ? qrUrl : '$qrUrl/';
  return '$base${deviceId.toString().padLeft(10, '0')}${_two(date.day)}${_two(date.month)}${date.year.toString().padLeft(4, '0')}'
      '${globalNo.toString().padLeft(10, '0')}$qrData';
}
