import 'package:floatly_till/models/catalog.dart';

/// A small shop like the one the API's sales tests use.
Map<String, dynamic> catalogJson() => {
  'tenant': {'id': 't1', 'name': 'Sales Shop', 'businessType': 'retail', 'baseCurrency': 'USD', 'vatNumber': '10001234', 'tin': '2000123456'},
  'store': {'id': 's1', 'name': 'Main Store', 'code': 'MAIN'},
  'currencies': [
    {'code': 'USD', 'name': 'US Dollar', 'symbol': r'$', 'rateToBase': '1.000000', 'isBase': true},
    {'code': 'ZWG', 'name': 'Zimbabwe Gold', 'symbol': 'ZiG', 'rateToBase': '26.500000', 'isBase': false},
  ],
  'taxRates': [
    {'id': 'vat', 'name': 'VAT 15.5%', 'code': 'VAT', 'rate': '15.50', 'inclusive': true},
    {'id': 'addvat', 'name': 'VAT added', 'code': 'VATX', 'rate': '15.50', 'inclusive': false},
  ],
  'categories': [
    {'id': 'drinks', 'parentId': null, 'name': 'Drinks', 'color': '#1c6652', 'sortOrder': 0},
    {'id': 'soft', 'parentId': 'drinks', 'name': 'Soft drinks', 'color': null, 'sortOrder': 0},
  ],
  'products': [
    {
      'id': 'p-coke',
      'name': 'Coke 500ml',
      'categoryId': 'soft',
      'taxRateId': 'vat',
      'kind': 'standard',
      'soldByWeight': false,
      'unit': null,
      'allowsDecimal': false,
      'variants': [
        {'id': 'v-coke', 'name': 'Default', 'sku': 'COKE', 'barcode': '600100', 'price': '1.00', 'isDefault': true},
      ],
    },
    {
      'id': 'p-mince',
      'name': 'Mince',
      'categoryId': null,
      'taxRateId': null,
      'kind': 'standard',
      'soldByWeight': true,
      'unit': 'kg',
      'allowsDecimal': true,
      'variants': [
        {'id': 'v-mince', 'name': 'Default', 'sku': 'MINCE', 'barcode': null, 'price': '7.00', 'isDefault': true},
      ],
    },
    {
      'id': 'p-tee',
      'name': 'T-shirt',
      'categoryId': null,
      'taxRateId': 'addvat',
      'kind': 'standard',
      'soldByWeight': false,
      'unit': null,
      'allowsDecimal': false,
      'variants': [
        {'id': 'v-tee-s', 'name': 'Small', 'sku': 'TEE-S', 'barcode': '700001', 'price': '10.00', 'isDefault': true},
        {'id': 'v-tee-l', 'name': 'Large', 'sku': 'TEE-L', 'barcode': '700002', 'price': '12.00', 'isDefault': false},
      ],
    },
    {
      'id': 'p-water',
      'name': 'Water 500ml',
      'categoryId': null,
      'taxRateId': 'vat',
      'kind': 'standard',
      'soldByWeight': false,
      'unit': null,
      'allowsDecimal': false,
      'variants': [
        {
          'id': 'v-water',
          'name': 'Default',
          'sku': 'WATER',
          'barcode': '600500',
          'price': '0.50',
          'isDefault': true,
          'packagings': [
            {'id': 'k-water-24', 'name': 'Case of 24', 'quantity': '24.000', 'barcode': 'CASE500', 'price': '10.00'},
          ],
        },
      ],
    },
    {
      'id': 'p-burger',
      'name': 'Burger',
      'categoryId': null,
      'taxRateId': 'vat',
      'kind': 'menu_item',
      'soldByWeight': false,
      'unit': null,
      'allowsDecimal': false,
      'variants': [
        {'id': 'v-burger', 'name': 'Default', 'sku': 'BURGER', 'barcode': null, 'price': '6.50', 'isDefault': true},
      ],
      'modifierGroups': [
        {
          'id': 'g-side',
          'name': 'Side',
          'minSelect': 1,
          'maxSelect': 1,
          'modifiers': [
            {'id': 'm-chips', 'name': 'Chips', 'priceDelta': '0.00'},
            {'id': 'm-salad', 'name': 'Salad', 'priceDelta': '0.50'},
          ],
        },
        {
          'id': 'g-extras',
          'name': 'Extras',
          'minSelect': 0,
          'maxSelect': 2,
          'modifiers': [
            {'id': 'm-cheese', 'name': 'Cheese', 'priceDelta': '1.00'},
            {'id': 'm-onion', 'name': 'No onion', 'priceDelta': '0.00'},
          ],
        },
      ],
    },
  ],
  'customers': [
    {'id': 'c-tendai', 'name': 'Tendai', 'phone': '0772000000', 'tin': null, 'vatNumber': null, 'discountPercent': '10.00'},
    {'id': 'c-chipo', 'name': 'Chipo', 'phone': null, 'tin': '2000999999', 'vatNumber': null, 'discountPercent': null},
  ],
  'syncedAt': '2026-10-26T10:00:00.000Z',
};

Catalog catalog() => Catalog.fromJson(catalogJson());
