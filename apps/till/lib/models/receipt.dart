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
  });

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
      discarded = j['discarded'] as bool? ?? false;

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

  bool get uploaded => saleId != null;
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
  };
}
