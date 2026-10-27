import '../core/money.dart';
import 'catalog.dart';

/// One item in the basket.
class CartLine {
  CartLine({required this.product, required this.variant, required this.quantity, this.pack, this.choices = const []}) : key = _nextKey++;

  static int _nextKey = 0;

  /// Tells lines apart in lists.
  final int key;
  final Product product;
  final Variant variant;

  /// Sold as this pack: [quantity] then counts packs.
  final Pack? pack;

  /// Sides and extras chosen, in the order the groups are asked.
  final List<Choice> choices;

  /// Thousandths: 1 item is 1000, 0.25 kg is 250.
  int quantity;

  /// Sold in parts (kg, litres) rather than whole items or packs.
  bool get partQuantities => pack == null && product.partQuantities;

  /// The shelf price of one, base-currency cents, the way the API works it out: the item's price on
  /// [priceListId] for this many units (its quantity breaks), else its normal price; a pack's own
  /// price, else that unit price × the units in it; plus the choices.
  int basePrice(String? priceListId) {
    final p = pack;
    if (p != null) return variant.packPrice(p, priceListId, quantity);
    return variant.priceFor(priceListId, quantity) + choices.fold(0, (a, c) => a + c.priceDelta);
  }

  /// Same item, same pack, same choices: scanning it again adds to this line.
  bool sameAs(Variant v, Pack? p, List<Choice> c) =>
      variant.id == v.id && pack?.id == p?.id && choices.map((x) => x.id).join(',') == c.map((x) => x.id).join(',');

  /// Price per unit typed in by a manager, sale-currency cents. Null: the shelf price.
  int? unitPrice;

  /// Amount off the whole line typed in by a manager, sale-currency cents. Null: the customer's group discount.
  int? discount;

  String? note;

  String get name => pack == null ? product.nameOf(variant) : '${product.nameOf(variant)} · ${pack!.name}';
  bool get plain => unitPrice == null && discount == null && (note ?? '').isEmpty;
}

class PricedLine {
  PricedLine({
    required this.line,
    required this.unitPrice,
    required this.gross,
    required this.discount,
    required this.net,
    required this.tax,
    required this.netBase,
    required this.taxBase,
    required this.taxRate,
  });

  final CartLine line;
  final int unitPrice, gross, discount, net, tax, netBase, taxBase;
  final TaxRate? taxRate;

  int get total => net + tax;
}

/// The basket with every price, discount and tax worked out.
class PricedCart {
  PricedCart(this.lines, this.currency, this.rate);

  final List<PricedLine> lines;
  final Currency currency;

  /// The sale's exchange rate against the base currency ("1" for the base currency).
  final String rate;

  int get subtotal => lines.fold(0, (a, l) => a + l.gross);
  int get discountTotal => lines.fold(0, (a, l) => a + l.discount);
  int get taxTotal => lines.fold(0, (a, l) => a + l.tax);
  int get total => lines.fold(0, (a, l) => a + l.total);
  int get totalBase => lines.fold(0, (a, l) => a + l.netBase + l.taxBase);
  int get itemCount => lines.fold(0, (a, l) => a + l.line.quantity);
  bool get isEmpty => lines.isEmpty;

  /// True when every taxed line already had the tax in its price.
  bool get taxIncluded => lines.every((l) => l.taxRate == null || l.taxRate!.inclusive);
}

/// Prices the basket exactly as the API does (SalesService.priceLines): shelf
/// price converted to the sale currency, the customer group's discount unless
/// one was typed in, then tax taken out of (or added to) the amount.
PricedCart priceCart({
  required List<CartLine> lines,
  required Currency currency,
  required Map<String, TaxRate> taxRates,
  Customer? customer,
  String? priceListId,
}) {
  final rate = currency.rate;
  final groupPct = customer?.discountHundredths ?? 0;
  final priced = [
    for (final l in lines)
      () {
        final shelf = l.basePrice(priceListId);
        final unitPrice = l.unitPrice ?? (currency.isBase ? shelf : fromBase(shelf, rate));
        final gross = divRound(l.quantity * unitPrice, 1000);
        final discount = (l.discount ?? (groupPct > 0 ? divRound(gross * groupPct, 10000) : 0)).clamp(0, gross);
        final amount = gross - discount;
        final taxRate = l.product.taxRateId == null ? null : taxRates[l.product.taxRateId];
        final pct = taxRate?.hundredths ?? 0;
        var net = amount;
        var tax = 0;
        if (pct > 0) {
          if (taxRate!.inclusive) {
            tax = divRound(amount * pct, 10000 + pct);
            net = amount - tax;
          } else {
            tax = divRound(amount * pct, 10000);
          }
        }
        return PricedLine(
          line: l,
          unitPrice: unitPrice,
          gross: gross,
          discount: discount,
          net: net,
          tax: tax,
          netBase: currency.isBase ? net : toBase(net, rate),
          taxBase: currency.isBase ? tax : toBase(tax, rate),
          taxRate: taxRate,
        );
      }(),
  ];
  return PricedCart(priced, currency, rate);
}

enum PayMethod {
  cash('Cash'),
  card('Card'),
  mobile('Mobile money'),
  bank('Bank transfer');

  const PayMethod(this.label);
  final String label;

  static PayMethod parse(String? s) => values.firstWhere((m) => m.name == s, orElse: () => cash);
}

class Payment {
  Payment({required this.method, required this.currency, required this.amount, this.reference});

  final PayMethod method;
  final Currency currency;

  /// Handed over, in [currency] cents.
  final int amount;
  final String? reference;
}

/// How the money handed over covers the sale.
class Settlement {
  Settlement({required this.remainingBase, this.change = 0, this.changeCurrency, this.problem});

  /// Still to pay, base-currency cents. Zero or less when covered.
  final int remainingBase;

  /// Cash to give back, in [changeCurrency].
  final int change;
  final Currency? changeCurrency;

  /// Why these payments can't be accepted, if they can't.
  final String? problem;

  bool get complete => problem == null && remainingBase <= 1;
}

/// The rate a payment is taken at: the sale's own rate in the sale currency, else today's rate.
String paymentRate(Currency currency, PricedCart cart) => currency.code == cart.currency.code ? cart.rate : currency.rate;

/// Checks payments the way the API does (SalesService.settle): any currency and
/// method, split as needed; only cash may be more than due, and the difference
/// is change in that cash payment's currency. A cent of rounding is allowed.
Settlement settle(List<Payment> payments, PricedCart cart) {
  var paidBase = 0;
  for (final p in payments) {
    paidBase += p.currency.isBase ? p.amount : toBase(p.amount, paymentRate(p.currency, cart));
  }
  final excess = paidBase - cart.totalBase;
  if (excess < -1) return Settlement(remainingBase: -excess);
  if (excess <= 1) return Settlement(remainingBase: 0);
  Payment? cash;
  for (final p in payments.reversed) {
    if (p.method == PayMethod.cash) {
      cash = p;
      break;
    }
  }
  if (cash == null) return Settlement(remainingBase: 0, problem: 'Only cash can be more than the amount due');
  final change = cash.currency.isBase ? excess : fromBase(excess, paymentRate(cash.currency, cart));
  if (change > cash.amount) return Settlement(remainingBase: 0, problem: 'The change is more than the cash handed over');
  return Settlement(remainingBase: 0, change: change, changeCurrency: cash.currency);
}

/// Base-currency cents shown in [currency].
int inCurrency(int baseCents, Currency currency, PricedCart cart) => currency.isBase ? baseCents : fromBase(baseCents, paymentRate(currency, cart));
