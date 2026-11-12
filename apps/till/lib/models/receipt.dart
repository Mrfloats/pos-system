import '../core/money.dart';
import 'catalog.dart';
import 'sale.dart';

class ReceiptLine {
  ReceiptLine({
    required this.name,
    required this.quantity,
    required this.unitPrice,
    required this.discount,
    required this.total,
    this.note,
    this.choices = const [],
  });

  ReceiptLine.fromJson(Map<String, dynamic> j)
    : name = j['name'] as String,
      quantity = j['quantity'] as int,
      unitPrice = j['unitPrice'] as int,
      discount = j['discount'] as int,
      total = j['total'] as int,
      note = j['note'] as String?,
      choices = [for (final c in j['choices'] as List? ?? const []) c as String];

  final String name;
  final int quantity, unitPrice, discount, total;
  final String? note;

  /// Sides and extras, e.g. "Salad", "Cheese".
  final List<String> choices;

  Map<String, dynamic> toJson() => {
    'name': name,
    'quantity': quantity,
    'unitPrice': unitPrice,
    'discount': discount,
    'total': total,
    'note': note,
    'choices': choices,
  };
}

class ReceiptPayment {
  ReceiptPayment({required this.method, required this.currencyCode, required this.symbol, required this.amount, required this.change});

  ReceiptPayment.fromJson(Map<String, dynamic> j)
    : method = PayMethod.parse(j['method'] as String?),
      currencyCode = j['currencyCode'] as String,
      symbol = j['symbol'] as String,
      amount = j['amount'] as int,
      change = j['change'] as int;

  final PayMethod method;
  final String currencyCode, symbol;
  final int amount, change;

  Map<String, dynamic> toJson() => {'method': method.name, 'currencyCode': currencyCode, 'symbol': symbol, 'amount': amount, 'change': change};
}

/// One rate in a fiscal receipt's tax table.
class FiscalTaxRow {
  FiscalTaxRow({required this.label, required this.gross, required this.tax});

  FiscalTaxRow.fromJson(Map<String, dynamic> j) : label = j['label'] as String, gross = j['gross'] as int, tax = j['tax'] as int;

  /// "15.50%", "0%" or "Exempt".
  final String label;
  final int gross, tax;
  int get net => gross - tax;

  Map<String, dynamic> toJson() => {'label': label, 'gross': gross, 'tax': tax};
}

/// What a ZIMRA fiscal receipt prints besides the sale itself (spec 10.1, Receipt48).
class ReceiptFiscal {
  ReceiptFiscal({
    required this.type,
    required this.vatPayer,
    required this.taxpayerName,
    required this.taxpayerTin,
    required this.deviceId,
    required this.dayNo,
    required this.counter,
    required this.globalNo,
    required this.invoiceNo,
    required this.date,
    required this.qrCode,
    required this.verificationCode,
    required this.verifyUrl,
    this.vatNumber,
    this.branchName,
    this.branchAddress,
    this.branchEmail,
    this.branchPhone,
    this.serialNo,
    this.taxes = const [],
    this.buyerName,
    this.buyerTin,
    this.buyerVat,
    this.creditedGlobalNo,
    this.creditedInvoiceNo,
    this.creditedDate,
    this.notes,
  });

  ReceiptFiscal.fromJson(Map<String, dynamic> j)
    : type = j['type'] as String,
      vatPayer = j['vatPayer'] as bool? ?? true,
      taxpayerName = j['taxpayerName'] as String,
      taxpayerTin = j['taxpayerTin'] as String,
      vatNumber = j['vatNumber'] as String?,
      branchName = j['branchName'] as String?,
      branchAddress = j['branchAddress'] as String?,
      branchEmail = j['branchEmail'] as String?,
      branchPhone = j['branchPhone'] as String?,
      deviceId = j['deviceId'] as int,
      serialNo = j['serialNo'] as String?,
      dayNo = j['dayNo'] as int,
      counter = j['counter'] as int,
      globalNo = j['globalNo'] as int,
      invoiceNo = j['invoiceNo'] as String,
      date = DateTime.parse(j['date'] as String),
      qrCode = j['qrCode'] as String,
      verificationCode = j['verificationCode'] as String,
      verifyUrl = j['verifyUrl'] as String? ?? '',
      taxes = [for (final t in j['taxes'] as List? ?? const []) FiscalTaxRow.fromJson((t as Map).cast())],
      buyerName = j['buyerName'] as String?,
      buyerTin = j['buyerTin'] as String?,
      buyerVat = j['buyerVat'] as String?,
      creditedGlobalNo = j['creditedGlobalNo'] as int?,
      creditedInvoiceNo = j['creditedInvoiceNo'] as String?,
      creditedDate = j['creditedDate'] == null ? null : DateTime.parse(j['creditedDate'] as String),
      notes = j['notes'] as String?;

  /// A sale's fiscal details as Floatly keeps them (GET /sales/:id), for reprints.
  /// The taxpayer's details come from the business; there's no tax table.
  factory ReceiptFiscal.fromApi(Map<String, dynamic> f, {required String businessName, String? tin, String? vatNumber}) {
    final date = f['date'] as String;
    return ReceiptFiscal(
      type: f['receiptType'] as String,
      vatPayer: vatNumber != null,
      taxpayerName: businessName,
      taxpayerTin: tin ?? '',
      vatNumber: vatNumber,
      deviceId: f['deviceId'] as int,
      dayNo: f['fiscalDayNo'] as int,
      counter: f['counter'] as int,
      globalNo: f['globalNo'] as int,
      invoiceNo: f['invoiceNo'] as String,
      date: DateTime.parse(date),
      qrCode: f['qrCode'] as String,
      verificationCode: f['verificationCode'] as String,
      verifyUrl: Uri.parse(f['qrCode'] as String).replace(path: '/').toString(),
    );
  }

  /// FiscalInvoice, CreditNote or DebitNote.
  final String type;
  final bool vatPayer;
  final String taxpayerName, taxpayerTin;
  final String? vatNumber, branchName, branchAddress, branchEmail, branchPhone;
  final int deviceId;
  final String? serialNo;
  final int dayNo, counter, globalNo;

  /// The "customer reference number": unique for the taxpayer.
  final String invoiceNo;

  /// The receipt's date as sent to ZIMRA.
  final DateTime date;
  final String qrCode, verificationCode;

  /// Where a customer can check a receipt by hand.
  final String verifyUrl;
  final List<FiscalTaxRow> taxes;
  final String? buyerName, buyerTin, buyerVat;

  /// The receipt a credit note corrects.
  final int? creditedGlobalNo;
  final String? creditedInvoiceNo;
  final DateTime? creditedDate;
  final String? notes;

  bool get isCreditNote => type == 'CreditNote';

  /// The title ZIMRA requires (field [9]).
  String get label => switch (type) {
    'CreditNote' => 'CREDIT NOTE',
    'DebitNote' => 'DEBIT NOTE',
    _ => vatPayer ? 'FISCAL TAX INVOICE' : 'FISCAL INVOICE',
  };

  Map<String, dynamic> toJson() => {
    'type': type,
    'vatPayer': vatPayer,
    'taxpayerName': taxpayerName,
    'taxpayerTin': taxpayerTin,
    'vatNumber': vatNumber,
    'branchName': branchName,
    'branchAddress': branchAddress,
    'branchEmail': branchEmail,
    'branchPhone': branchPhone,
    'deviceId': deviceId,
    'serialNo': serialNo,
    'dayNo': dayNo,
    'counter': counter,
    'globalNo': globalNo,
    'invoiceNo': invoiceNo,
    'date': date.toIso8601String(),
    'qrCode': qrCode,
    'verificationCode': verificationCode,
    'verifyUrl': verifyUrl,
    'taxes': [for (final t in taxes) t.toJson()],
    'buyerName': buyerName,
    'buyerTin': buyerTin,
    'buyerVat': buyerVat,
    'creditedGlobalNo': creditedGlobalNo,
    'creditedInvoiceNo': creditedInvoiceNo,
    'creditedDate': creditedDate?.toIso8601String(),
    'notes': notes,
  };
}

/// A sale as printed. Kept on the till for reprints, and works offline: the sale
/// number from Floatly is filled in once the sale has uploaded.
class Receipt {
  Receipt({
    required this.clientId,
    required this.reference,
    required this.soldAt,
    required this.businessName,
    required this.storeName,
    required this.cashier,
    required this.currencyCode,
    required this.symbol,
    required this.lines,
    required this.subtotal,
    required this.discountTotal,
    required this.taxTotal,
    required this.taxIncluded,
    required this.total,
    required this.payments,
    this.address,
    this.phone,
    this.tin,
    this.vatNumber,
    this.customerName,
    this.customerTin,
    this.customerVat,
    this.priceListName,
    this.number,
    this.saleId,
    this.discarded = false,
    this.isReturn = false,
    this.fiscal,
  });

  /// A receipt for a sale (or refund) as the API returns it from GET /sales/:id,
  /// for looking up and reprinting from the admin area. [symbolOf] gives a
  /// currency's symbol from its code.
  factory Receipt.fromApiSale(
    Map<String, dynamic> sale, {
    required String businessName,
    String? address,
    String? phone,
    String? tin,
    String? vatNumber,
    required String Function(String code) symbolOf,
  }) {
    final currency = sale['currencyCode'] as String;
    final isReturn = sale['type'] == 'return';
    String lineName(Map l) {
      final variant = l['variantName'] as String?;
      final pack = l['packName'] as String?;
      return '${l['productName']}${variant != null && variant != 'Default' ? ' · $variant' : ''}${pack != null ? ' ($pack)' : ''}';
    }

    return Receipt(
      clientId: (sale['clientId'] ?? sale['id']) as String,
      reference: sale['number'] as String,
      number: sale['number'] as String,
      saleId: sale['id'] as String,
      soldAt: DateTime.parse(sale['soldAt'] as String).toLocal(),
      businessName: businessName,
      storeName: (sale['storeName'] as String?) ?? '',
      address: address,
      phone: phone,
      tin: tin,
      vatNumber: vatNumber,
      cashier: (sale['salesperson'] as String?) ?? '—',
      customerName: sale['customerName'] as String?,
      currencyCode: currency,
      symbol: symbolOf(currency),
      isReturn: isReturn,
      fiscal: sale['fiscal'] is Map ? ReceiptFiscal.fromApi((sale['fiscal'] as Map).cast(), businessName: businessName, tin: tin, vatNumber: vatNumber) : null,
      lines: [
        for (final l in (sale['lines'] as List).cast<Map>())
          ReceiptLine(
            name: lineName(l),
            quantity: parseFixed(l['quantity'], 3),
            unitPrice: toCents(l['unitPrice']),
            discount: toCents(l['discount']),
            total: toCents(l['total']),
            note: l['note'] as String?,
            choices: [for (final m in (l['modifiers'] as List? ?? const [])) (m as Map)['name'] as String],
          ),
      ],
      subtotal: toCents(sale['subtotal']),
      discountTotal: toCents(sale['discountTotal']),
      taxTotal: toCents(sale['taxTotal']),
      taxIncluded: true,
      total: toCents(sale['total']),
      payments: [
        for (final p in (sale['payments'] as List).cast<Map>())
          ReceiptPayment(
            method: PayMethod.parse(p['method'] as String?),
            currencyCode: p['currencyCode'] as String,
            symbol: symbolOf(p['currencyCode'] as String),
            // A refund's payment is stored as money going out; the receipt says "Refund" instead of a minus.
            amount: toCents(p['amount']).abs(),
            change: toCents(p['change']),
          ),
      ],
    );
  }

  factory Receipt.forSale({
    required String clientId,
    required String reference,
    required DateTime soldAt,
    required Catalog catalog,
    required String cashier,
    required PricedCart cart,
    required List<Payment> payments,
    required Settlement settlement,
    Customer? customer,
    String? customerName,
    String? priceListName,
  }) {
    final b = catalog.business;
    final s = catalog.store;
    // Change is always given from the last cash payment (as the API does).
    final changeFrom = payments.lastIndexWhere((p) => p.method == PayMethod.cash);
    return Receipt(
      clientId: clientId,
      reference: reference,
      soldAt: soldAt,
      businessName: b.name,
      storeName: s.name,
      address: s.address ?? b.address,
      phone: s.phone ?? b.phone,
      tin: b.tin,
      vatNumber: b.vatNumber,
      cashier: cashier,
      customerName: customer?.name ?? customerName,
      customerTin: customer?.tin,
      customerVat: customer?.vatNumber,
      priceListName: priceListName,
      currencyCode: cart.currency.code,
      symbol: cart.currency.label,
      lines: [
        for (final l in cart.lines)
          ReceiptLine(
            name: l.line.name,
            quantity: l.line.quantity,
            unitPrice: l.unitPrice,
            discount: l.discount,
            total: l.total,
            note: l.line.note,
            choices: [for (final c in l.line.choices) c.name],
          ),
      ],
      subtotal: cart.subtotal,
      discountTotal: cart.discountTotal,
      taxTotal: cart.taxTotal,
      taxIncluded: cart.taxIncluded,
      total: cart.total,
      payments: [
        for (final (i, p) in payments.indexed)
          ReceiptPayment(
            method: p.method,
            currencyCode: p.currency.code,
            symbol: p.currency.label,
            amount: p.amount,
            change: i == changeFrom ? settlement.change : 0,
          ),
      ],
    );
  }

  Receipt.fromJson(Map<String, dynamic> j)
    : clientId = j['clientId'] as String,
      reference = j['reference'] as String,
      soldAt = DateTime.parse(j['soldAt'] as String).toLocal(),
      businessName = j['businessName'] as String,
      storeName = j['storeName'] as String,
      address = j['address'] as String?,
      phone = j['phone'] as String?,
      tin = j['tin'] as String?,
      vatNumber = j['vatNumber'] as String?,
      cashier = j['cashier'] as String,
      customerName = j['customerName'] as String?,
      customerTin = j['customerTin'] as String?,
      customerVat = j['customerVat'] as String?,
      priceListName = j['priceListName'] as String?,
      currencyCode = j['currencyCode'] as String,
      symbol = j['symbol'] as String,
      lines = [for (final l in j['lines'] as List) ReceiptLine.fromJson((l as Map).cast())],
      subtotal = j['subtotal'] as int,
      discountTotal = j['discountTotal'] as int,
      taxTotal = j['taxTotal'] as int,
      taxIncluded = j['taxIncluded'] as bool? ?? true,
      total = j['total'] as int,
      payments = [for (final p in j['payments'] as List) ReceiptPayment.fromJson((p as Map).cast())],
      number = j['number'] as String?,
      saleId = j['saleId'] as String?,
      discarded = j['discarded'] as bool? ?? false,
      isReturn = j['isReturn'] as bool? ?? false,
      fiscal = j['fiscal'] == null ? null : ReceiptFiscal.fromJson((j['fiscal'] as Map).cast());

  /// The idempotency key the sale was uploaded with.
  final String clientId;

  /// This till's own running number, e.g. T01-000042, printed when the sale hasn't uploaded yet.
  final String reference;
  final DateTime soldAt;
  final String businessName, storeName, cashier, currencyCode, symbol;
  final String? address, phone, tin, vatNumber, customerName, customerTin, customerVat;

  /// Priced from this list (Wholesale…); null for normal prices.
  final String? priceListName;
  final List<ReceiptLine> lines;
  final int subtotal, discountTotal, taxTotal, total;
  final bool taxIncluded;
  final List<ReceiptPayment> payments;

  /// Floatly's sale number (S-00042) and id, once uploaded.
  String? number;
  String? saleId;

  /// A manager threw away a sale Floatly refused.
  bool discarded;

  /// Money given back, not taken.
  final bool isReturn;

  /// The ZIMRA fiscal invoice or credit note, when this till is a fiscal device.
  ReceiptFiscal? fiscal;

  /// The line that names the receipt: "Sale S-00042", "Refund R-00003", or the till's own number before upload.
  String get heading => number != null ? '${isReturn ? 'Refund' : 'Sale'} $number' : 'Receipt $reference';

  /// The till's own running number, when there is one besides Floatly's.
  bool get showTillRef => number != null && reference != number;

  bool get uploaded => saleId != null;

  /// How many items (thousandths), for ZIMRA's "Number of items".
  int get itemCount => lines.fold(0, (a, l) => a + l.quantity);
  int get change => payments.fold(0, (a, p) => a + p.change);
  String? get changeSymbol => payments.where((p) => p.change > 0).map((p) => p.symbol).firstOrNull;

  Map<String, dynamic> toJson() => {
    'clientId': clientId,
    'reference': reference,
    'soldAt': soldAt.toUtc().toIso8601String(),
    'businessName': businessName,
    'storeName': storeName,
    'address': address,
    'phone': phone,
    'tin': tin,
    'vatNumber': vatNumber,
    'cashier': cashier,
    'customerName': customerName,
    'customerTin': customerTin,
    'customerVat': customerVat,
    'priceListName': priceListName,
    'currencyCode': currencyCode,
    'symbol': symbol,
    'lines': [for (final l in lines) l.toJson()],
    'subtotal': subtotal,
    'discountTotal': discountTotal,
    'taxTotal': taxTotal,
    'taxIncluded': taxIncluded,
    'total': total,
    'payments': [for (final p in payments) p.toJson()],
    'number': number,
    'saleId': saleId,
    'discarded': discarded,
    'isReturn': isReturn,
    'fiscal': fiscal?.toJson(),
  };
}
