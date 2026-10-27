import '../core/money.dart';

String? _str(Object? v) => v is String && v.isNotEmpty ? v : null;

class Business {
  Business.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      name = j['name'] as String,
      businessType = j['businessType'] as String? ?? 'retail',
      baseCurrency = j['baseCurrency'] as String? ?? 'USD',
      tin = _str(j['tin']),
      vatNumber = _str(j['vatNumber']),
      address = _str(j['address']),
      phone = _str(j['phone']),
      email = _str(j['email']);

  final String id, name, businessType, baseCurrency;
  final String? tin, vatNumber, address, phone, email;
}

class StoreInfo {
  StoreInfo.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      name = j['name'] as String,
      code = j['code'] as String,
      address = _str(j['address']),
      phone = _str(j['phone']);

  final String id, name, code;
  final String? address, phone;
}

class Currency {
  const Currency({required this.code, required this.name, required this.symbol, required this.rateToBase, required this.isBase});

  Currency.fromJson(Map<String, dynamic> j)
    : code = j['code'] as String,
      name = j['name'] as String? ?? j['code'] as String,
      symbol = j['symbol'] as String? ?? '',
      rateToBase = j['rateToBase']?.toString() ?? '1',
      isBase = j['isBase'] as bool? ?? false;

  final String code, name, symbol;

  /// Units of this currency per 1 unit of the base currency.
  final String rateToBase;
  final bool isBase;

  String get rate => isBase ? '1' : rateToBase;
  String get label => symbol.isEmpty ? code : symbol;
}

class TaxRate {
  TaxRate.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      name = j['name'] as String,
      code = j['code'] as String? ?? '',
      rate = j['rate']?.toString() ?? '0',
      inclusive = j['inclusive'] as bool? ?? true;

  final String id, name, code;

  /// Percentage, e.g. "15.50".
  final String rate;

  /// Shelf prices already include this tax.
  final bool inclusive;

  /// Hundredths of a percent: 15.50% → 1550.
  int get hundredths => toCents(rate);
}

class Category {
  Category.fromJson(Map<String, dynamic> j) : id = j['id'] as String, parentId = j['parentId'] as String?, name = j['name'] as String, color = _str(j['color']);

  final String id, name;
  final String? parentId, color;
}

class Variant {
  Variant.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      name = j['name'] as String? ?? 'Default',
      sku = _str(j['sku']),
      barcode = _str(j['barcode']),
      price = toCents(j['price']),
      isDefault = j['isDefault'] as bool? ?? false,
      packs = [for (final p in j['packagings'] as List? ?? const []) Pack.fromJson((p as Map).cast())],
      listPrices = [for (final l in j['listPrices'] as List? ?? const []) ListPrice.fromJson((l as Map).cast())];

  final String id, name;
  final String? sku, barcode;

  /// Selling price at this store, base-currency cents.
  final int price;
  final bool isDefault;

  /// Wholesale packs of this variant (a case of 24…).
  final List<Pack> packs;

  /// Prices on price lists (Wholesale…), with quantity breaks, lowest first.
  final List<ListPrice> listPrices;

  /// One unit's price, base-currency cents: on [priceListId] for [units] (thousandths), its biggest
  /// break that applies; without a list, or with no price on it, the normal (retail) price.
  /// A pack's price: its own, else the unit price on [priceListId] × the units in it.
  /// For [packs] of them, the way the API works it out: its price on [priceListId] for that many packs,
  /// else its own price, else the unit price on the list × the units in it.
  int packPrice(Pack p, String? priceListId, [int packs = 1000]) {
    final listed = _best(p.listPrices, priceListId, packs);
    if (listed != null) return listed;
    if (p.ownPrice) return p.price;
    return divRound(priceFor(priceListId, divRound(packs * p.units, 1000)) * p.units, 1000);
  }

  int priceFor(String? priceListId, [int units = 1000]) => _best(listPrices, priceListId, units) ?? price;
}

/// The price on [priceListId] for [quantity] (thousandths): the biggest quantity break that applies.
int? _best(List<ListPrice> prices, String? priceListId, int quantity) {
  if (priceListId == null) return null;
  int? best;
  var bestMin = -1;
  for (final l in prices) {
    if (l.priceListId == priceListId && l.minQuantity <= quantity && l.minQuantity > bestMin) {
      best = l.price;
      bestMin = l.minQuantity;
    }
  }
  return best;
}

/// A variant's price on a price list from a quantity upwards.
class ListPrice {
  ListPrice.fromJson(Map<String, dynamic> j)
    : priceListId = j['priceListId'] as String,
      minQuantity = parseFixed(j['minQuantity'], 3),
      price = toCents(j['price']);

  final String priceListId;

  /// Thousandths: 50000 means from 50.
  final int minQuantity;

  /// Base-currency cents.
  final int price;
}

/// A set of prices: Retail (the normal prices), Wholesale…
class PriceList {
  PriceList.fromJson(Map<String, dynamic> j) : id = j['id'] as String, name = j['name'] as String, isDefault = j['isDefault'] as bool? ?? false;

  final String id, name;

  /// The normal prices (Retail).
  final bool isDefault;
}

/// The same variant sold as a case or carton, with its own barcode and price.
class Pack {
  Pack.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      name = j['name'] as String,
      units = parseFixed(j['quantity'], 3),
      barcode = _str(j['barcode']),
      price = toCents(j['price']),
      ownPrice = j['ownPrice'] as bool? ?? true,
      listPrices = [for (final l in j['listPrices'] as List? ?? const []) ListPrice.fromJson((l as Map).cast())];

  final String id, name;

  /// Stock units in one pack, in thousandths (24000 for 24).
  final int units;
  final String? barcode;

  /// Price of one pack at this store, base-currency cents.
  final int price;

  /// The pack has a price of its own; otherwise it is the unit price × units (on the sale's price list).
  final bool ownPrice;

  /// The pack's own prices on price lists (Wholesale…).
  final List<ListPrice> listPrices;
}

/// A restaurant choice: "Choose a side" (exactly 1), "Extras" (up to 3)…
class ChoiceGroup {
  ChoiceGroup.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      name = j['name'] as String,
      minSelect = j['minSelect'] as int? ?? 0,
      maxSelect = j['maxSelect'] as int? ?? 1,
      options = [for (final m in j['modifiers'] as List) Choice.fromJson((m as Map).cast(), j['name'] as String)];

  final String id, name;
  final int minSelect, maxSelect;
  final List<Choice> options;
}

class Choice {
  Choice.fromJson(Map<String, dynamic> j, this.groupName) : id = j['id'] as String, name = j['name'] as String, priceDelta = toCents(j['priceDelta']);

  final String id, name, groupName;

  /// Added to the item's price (may be negative), base-currency cents.
  final int priceDelta;
}

class Product {
  Product.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      name = j['name'] as String,
      categoryId = j['categoryId'] as String?,
      taxRateId = j['taxRateId'] as String?,
      kind = j['kind'] as String? ?? 'standard',
      soldByWeight = j['soldByWeight'] as bool? ?? false,
      kitchenStation = _str(j['kitchenStation']),
      unit = _str(j['unit']),
      allowsDecimal = j['allowsDecimal'] as bool? ?? false,
      variants = [for (final v in j['variants'] as List) Variant.fromJson((v as Map).cast())],
      choiceGroups = [for (final g in j['modifierGroups'] as List? ?? const []) ChoiceGroup.fromJson((g as Map).cast())];

  final String id, name, kind;
  final String? categoryId, taxRateId, kitchenStation, unit;
  final bool soldByWeight, allowsDecimal;
  final List<Variant> variants;

  /// Restaurant choices to ask for when it is sold (sides, extras).
  final List<ChoiceGroup> choiceGroups;

  /// More than one thing to pick from when tapped: variants or packs.
  bool get hasOptions => variants.length > 1 || variants.any((v) => v.packs.isNotEmpty);

  /// Sold in parts (kg, litres): the till asks how much.
  bool get partQuantities => soldByWeight || allowsDecimal;

  String nameOf(Variant v) => v.name == 'Default' || variants.length == 1 && v.isDefault ? name : '$name · ${v.name}';
}

class Customer {
  Customer.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      name = j['name'] as String,
      phone = _str(j['phone']),
      tin = _str(j['tin']),
      vatNumber = _str(j['vatNumber']),
      discountPercent = j['discountPercent']?.toString(),
      priceListId = j['priceListId'] as String?;

  final String id, name;
  final String? phone, tin, vatNumber;

  /// The customer group's discount, e.g. "10.00".
  final String? discountPercent;

  /// Their prices (Wholesale…): their own price list, else their group's.
  final String? priceListId;

  /// Hundredths of a percent, 0 when none.
  int get discountHundredths => toCents(discountPercent);

  Map<String, dynamic> toJson() => {
    'id': id,
    'name': name,
    'phone': phone,
    'tin': tin,
    'vatNumber': vatNumber,
    'discountPercent': discountPercent,
    'priceListId': priceListId,
  };
}

/// What a tap or a scan adds: a variant, sold singly or as one of its packs.
typedef Sellable = ({Product product, Variant variant, Pack? pack});

/// Everything the till sells from, downloaded from GET /till/catalog and kept on
/// the device so selling carries on without internet.
class Catalog {
  Catalog.fromJson(Map<String, dynamic> j)
    : raw = j,
      business = Business.fromJson((j['tenant'] as Map).cast()),
      store = StoreInfo.fromJson((j['store'] as Map).cast()),
      currencies = [for (final c in j['currencies'] as List) Currency.fromJson((c as Map).cast())],
      priceLists = [for (final l in j['priceLists'] as List? ?? const []) PriceList.fromJson((l as Map).cast())],
      taxRates = {for (final t in j['taxRates'] as List) (t as Map)['id'] as String: TaxRate.fromJson(t.cast())},
      categories = [for (final c in j['categories'] as List) Category.fromJson((c as Map).cast())],
      products = [for (final p in j['products'] as List) Product.fromJson((p as Map).cast())],
      customers = [for (final c in j['customers'] as List) Customer.fromJson((c as Map).cast())],
      syncedAt = DateTime.tryParse(j['syncedAt'] as String? ?? '') ?? DateTime.now() {
    for (final p in products) {
      for (final v in p.variants) {
        if (v.barcode != null) _byCode[v.barcode!] = (product: p, variant: v, pack: null);
        if (v.sku != null) _byCode.putIfAbsent(v.sku!.toUpperCase(), () => (product: p, variant: v, pack: null));
        for (final pack in v.packs) {
          if (pack.barcode != null) _byCode[pack.barcode!] = (product: p, variant: v, pack: pack);
        }
      }
    }
  }

  /// A saved catalog, or null when there is none or it no longer reads.
  static Catalog? tryParse(Object? json) {
    if (json is! Map) return null;
    try {
      return Catalog.fromJson(json.cast());
    } catch (_) {
      return null;
    }
  }

  /// As it came from the API, to save on the device.
  final Map<String, dynamic> raw;
  final Business business;
  final StoreInfo store;
  final List<Currency> currencies;

  /// Retail first, then Wholesale and any others.
  final List<PriceList> priceLists;
  final Map<String, TaxRate> taxRates;
  final List<Category> categories;
  final List<Product> products;
  final List<Customer> customers;
  final DateTime syncedAt;
  final _byCode = <String, Sellable>{};

  Currency get baseCurrency => currencies.firstWhere(
    (c) => c.isBase,
    orElse: () => Currency(code: business.baseCurrency, name: business.baseCurrency, symbol: business.baseCurrency, rateToBase: '1', isBase: true),
  );

  /// The list of normal prices (Retail), if the business has one.
  PriceList? get defaultPriceList => priceLists.where((l) => l.isDefault).firstOrNull;

  /// There are prices to choose between (Retail and Wholesale).
  bool get hasPriceChoice => priceLists.any((l) => !l.isDefault);

  Currency currency(String code) => currencies.firstWhere((c) => c.code == code, orElse: () => baseCurrency);

  /// Finds what a barcode scanner read, or a SKU typed in.
  Sellable? lookup(String code) {
    final c = code.trim();
    return _byCode[c] ?? _byCode[c.toUpperCase()];
  }

  /// The category and every category under it.
  Set<String> categoryWithChildren(String id) {
    final ids = {id};
    var grew = true;
    while (grew) {
      grew = false;
      for (final c in categories) {
        if (c.parentId != null && ids.contains(c.parentId) && ids.add(c.id)) grew = true;
      }
    }
    return ids;
  }

  List<Product> search(String text, {String? categoryId}) {
    final q = text.trim().toLowerCase();
    final inCategory = categoryId == null ? null : categoryWithChildren(categoryId);
    return [
      for (final p in products)
        if ((inCategory == null || inCategory.contains(p.categoryId)) &&
            (q.isEmpty ||
                p.name.toLowerCase().contains(q) ||
                p.variants.any((v) => v.barcode == q || (v.sku?.toLowerCase().contains(q) ?? false) || v.packs.any((k) => k.barcode == q))))
          p,
    ];
  }

  List<Customer> findCustomers(String text) {
    final q = text.trim().toLowerCase();
    if (q.isEmpty) return customers;
    return [
      for (final c in customers)
        if (c.name.toLowerCase().contains(q) || (c.phone?.contains(q) ?? false) || (c.tin?.contains(q) ?? false)) c,
    ];
  }

  /// The same catalog with a customer added at the till.
  Catalog withCustomer(Customer c) => Catalog.fromJson({
    ...raw,
    'customers': [...(raw['customers'] as List), c.toJson()],
  });
}
