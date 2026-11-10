// What the admin tests share: a stand-in for the Floatly API and ways to open the admin area on it.
import 'dart:convert';

import 'package:floatly_till/admin/admin_state.dart';
import 'package:floatly_till/core/api.dart';
import 'package:floatly_till/core/local_store.dart';
import 'package:floatly_till/core/money.dart';
import 'package:floatly_till/main.dart';
import 'package:floatly_till/state/till_state.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';

/// A stand-in for the Floatly API: phone sign-in, refresh tokens that work once, and a dashboard.
class FakeServer {
  FakeServer({this.role = 'admin', this.hasPin = true, this.pin = '4321'});

  String role;
  bool hasPin;
  String pin;
  int _n = 0;
  String? liveRefresh;
  String? liveAccess;
  final requests = <String>[];
  int refreshes = 0;
  bool loggedOut = false;
  bool revoked = false;
  Map<String, String> lastHeaders = {};

  /// What the signed-in person may do.
  List<String> permissions = ['dashboard.view', 'sales.view', 'inventory.view', 'inventory.adjust', 'damaged.record', 'products.edit', 'products.price'];

  /// Stocked items: variant id → details, with quantity in thousandths per store.
  final items = <String, Map<String, dynamic>>{
    'v-rice': {'productId': 'p-rice', 'productName': 'Rice', 'variantName': '5kg', 'sku': 'RICE5', 'barcode': '600111', 'price': '9.50', 'costPrice': '7.00', 'reorderLevel': '10.000', 'stock': {'s1': 4000, 's2': 20000}},
    'v-oil': {'productId': 'p-oil', 'productName': 'Cooking oil 2L', 'variantName': 'Default', 'sku': null, 'barcode': '600222', 'price': '4.20', 'costPrice': null, 'reorderLevel': null, 'stock': {'s1': 30000}},
  };

  /// Stock movements, newest first, as GET /inventory/movements lists them.
  final movements = <Map<String, dynamic>>[];

  /// Every POST /inventory/movements body.
  final posted = <Map<String, dynamic>>[];

  /// Products added with POST /products.
  final added = <Map<String, dynamic>>[];

  String _onHand(Map<String, dynamic> item, String? store) {
    final stock = (item['stock'] as Map).cast<String, int>();
    final milli = store == null ? stock.values.fold(0, (a, b) => a + b) : stock[store] ?? 0;
    return formatFixed(milli, 3);
  }

  Map<String, dynamic> _level(String id, String? store) {
    final i = items[id]!;
    return {'variantId': id, ...i, 'onHand': _onHand(i, store)}..remove('stock');
  }

  http.Response? _stock(http.Request req, String path, Map<String, dynamic> body) {
    final q = req.url.queryParameters;
    final store = q['storeId'];
    if (path == '/inventory/levels') {
      var ids = items.keys.toList();
      final search = q['search']?.toLowerCase();
      if (search != null) ids = [for (final id in ids) if ('${items[id]!['productName']} ${items[id]!['sku']} ${items[id]!['barcode']}'.toLowerCase().contains(search)) id];
      if (q['lowStock'] == 'true') {
        ids = [
          for (final id in ids)
            if (items[id]!['reorderLevel'] != null && parseFixed(_onHand(items[id]!, store), 3) <= parseFixed(items[id]!['reorderLevel'], 3)) id,
        ];
      }
      return _json({'items': [for (final id in ids) _level(id, store)], 'total': ids.length, 'page': 1, 'pageSize': 30});
    }
    if (path.startsWith('/inventory/items/')) {
      final id = path.substring('/inventory/items/'.length);
      if (!items.containsKey(id)) return _json({'statusCode': 404, 'message': 'Item not found'}, 404);
      final i = items[id]!;
      return _json({
        ..._level(id, null),
        'categoryName': 'Groceries',
        'trackStock': true,
        'active': true,
        'stores': [
          {'storeId': 's2', 'storeName': 'Depot', 'storeCode': 'DEP', 'storeType': 'warehouse', 'onHand': _onHand(i, 's2')},
          {'storeId': 's1', 'storeName': 'Main Store', 'storeCode': 'MAIN', 'storeType': 'shop', 'onHand': _onHand(i, 's1')},
        ],
      });
    }
    if (path == '/inventory/movements' && req.method == 'GET') {
      final list = [
        for (final m in movements)
          if ((q['type'] == null || m['type'] == q['type']) && (q['variantId'] == null || m['variantId'] == q['variantId']) && (store == null || m['storeId'] == store)) m,
      ];
      return _json({'items': list, 'total': list.length, 'page': 1, 'pageSize': 30});
    }
    if (path == '/inventory/movements' && req.method == 'POST') {
      posted.add(body);
      for (final l in (body['lines'] as List).cast<Map>()) {
        final item = items[l['variantId']]!;
        var milli = parseFixed(l['quantity'], 3);
        if (body['type'] == 'waste') milli = -milli;
        final stock = (item['stock'] as Map).cast<String, int>();
        stock[body['storeId'] as String] = (stock[body['storeId']] ?? 0) + milli;
        item['stock'] = stock;
        movements.insert(0, {
          'id': 'mv-${movements.length}',
          'variantId': l['variantId'],
          'productName': item['productName'],
          'variantName': item['variantName'],
          'storeId': body['storeId'],
          'storeName': body['storeId'] == 's1' ? 'Main Store' : 'Depot',
          'type': body['type'],
          'quantity': formatFixed(milli, 3),
          'unitCost': item['costPrice'],
          'note': body['note'],
          'createdByName': 'Admin User',
          'createdAt': '2026-11-10T13:00:00.000Z',
        });
      }
      return _json({'recorded': (body['lines'] as List).length, 'skippedDuplicates': 0}, 201);
    }
    if (path.startsWith('/products/variants/') && req.method == 'PATCH') {
      final id = path.substring('/products/variants/'.length);
      final item = items[id]!;
      if (body.containsKey('price') && body['price'] != item['price']) {
        final given = req.headers['X-Floatly-Pin'];
        if (given == null) return _json({'statusCode': 403, 'code': 'pin_required', 'message': 'Enter your PIN to confirm this'}, 403);
        if (given != pin) return _json({'statusCode': 403, 'code': 'wrong_pin', 'message': 'Wrong PIN'}, 403);
      }
      for (final k in ['price', 'costPrice', 'reorderLevel']) {
        if (body.containsKey(k)) item[k] = body[k];
      }
      return _json({'id': item['productId']});
    }
    if (path == '/products' && req.method == 'POST') {
      added.add(body);
      final v = (body['variants'] as List).first as Map;
      final id = 'v-new-${added.length}';
      items[id] = {
        'productId': 'p-new',
        'productName': body['name'],
        'variantName': 'Default',
        'sku': v['sku'],
        'barcode': v['barcode'],
        'price': v['price'],
        'costPrice': v['costPrice'],
        'reorderLevel': v['reorderLevel'],
        'stock': <String, int>{},
      };
      return _json({
        'id': 'p-new',
        'name': body['name'],
        'variants': [
          {'id': id, 'name': 'Default'},
        ],
      }, 201);
    }
    if (path == '/categories') {
      return _json([
        {'id': 'c1', 'name': 'Groceries'},
        {'id': 'c2', 'name': 'Drinks'},
      ]);
    }
    if (path.startsWith('/products/barcode/')) {
      final code = Uri.decodeComponent(path.substring('/products/barcode/'.length));
      final id = items.keys.where((k) => items[k]!['barcode'] == code).firstOrNull;
      if (id == null) return _json({'statusCode': 404, 'message': 'Barcode not found'}, 404);
      final i = items[id]!;
      return _json({
        'match': 'variant',
        'variantId': id,
        'product': {
          'id': i['productId'],
          'name': i['productName'],
          'variants': [
            {'id': id, 'name': i['variantName']},
          ],
        },
      });
    }
    return null;
  }

  /// What GET /sales lists, and every set of filters it was asked with.
  List<Map<String, dynamic>> sales = fakeSales();
  final salesQueries = <Map<String, String>>[];

  http.Response _json(Object body, [int status = 200]) => http.Response(jsonEncode(body), status, headers: {'content-type': 'application/json'});

  Map<String, dynamic> _session() {
    _n++;
    liveAccess = 'access-$_n';
    liveRefresh = 'rt_${'r' * 30}$_n';
    return {
      'accessToken': liveAccess,
      'refreshToken': liveRefresh,
      'expiresIn': 900,
      'user': {'id': 'u1', 'email': 'admin@shop.test', 'fullName': 'Admin User', 'phone': null},
      'tenant': {'id': 't1', 'name': 'Corner Shop', 'baseCurrency': 'USD', 'timezone': 'Africa/Harare', 'address': '1 Head Office Road', 'phone': null, 'tin': '2000123456', 'vatNumber': null},
      'membership': {
        'id': 'm1',
        'role': role,
        'staffCode': 'ADM-001',
        'hasPin': hasPin,
        'permissions': permissions,
      },
      'businesses': [
        {'tenantId': 't1', 'name': 'Corner Shop', 'businessType': 'retail', 'role': role},
      ],
    };
  }

  Future<http.Response> handle(http.Request req) async {
    final path = req.url.path.replaceFirst('/api/v1', '');
    requests.add('${req.method} $path');
    lastHeaders = req.headers;
    final body = req.body.isEmpty ? const <String, dynamic>{} : (jsonDecode(req.body) as Map).cast<String, dynamic>();

    if (path == '/auth/login') {
      if (body['password'] != 'password123') return _json({'statusCode': 401, 'message': 'Wrong email or password'}, 401);
      if (role == 'cashier') {
        return _json({'statusCode': 403, 'code': 'not_for_role', 'message': 'Managing the business on a phone is for owners, admins and managers. Sign in on a till with your PIN instead.'}, 403);
      }
      expect(body['session'], 'mobile');
      return _json(_session());
    }
    if (path == '/auth/refresh') {
      refreshes++;
      if (revoked || body['refreshToken'] != liveRefresh) return _json({'statusCode': 401, 'message': 'Your session has ended. Sign in again.'}, 401);
      return _json(_session());
    }
    if (path == '/auth/logout') {
      loggedOut = true;
      liveRefresh = null;
      return _json({'ok': true});
    }
    if (req.headers['Authorization'] != 'Bearer $liveAccess') return _json({'statusCode': 401, 'message': 'Session expired or invalid'}, 401);
    expect(req.headers['X-Floatly-Client'], 'mobile');
    switch (path) {
      case '/stores':
        return _json([
          {'id': 's1', 'name': 'Main Store', 'code': 'MAIN', 'type': 'shop', 'active': true, 'address': '12 Market Street', 'phone': '+263 77 123 4567'},
          {'id': 's2', 'name': 'Depot', 'code': 'DEP', 'type': 'warehouse', 'active': true},
        ]);
      case '/currencies':
        return _json([
          {'code': 'USD', 'symbol': r'$', 'isBase': true},
        ]);
      case '/staff':
        return _json([
          {'id': 'm1', 'userId': 'u1', 'fullName': 'Admin User', 'role': 'admin'},
          {'id': 'm2', 'userId': 'u2', 'fullName': 'Chipo Cashier', 'role': 'cashier'},
        ]);
      case '/sales':
        final q = req.url.queryParameters;
        salesQueries.add(q);
        var list = sales;
        if (q['search'] != null) list = [for (final s in list) if ('${s['number']} ${s['customerName']}'.toLowerCase().contains(q['search']!.toLowerCase())) s];
        if (q['cashierId'] != null) list = [for (final s in list) if (s['salespersonId'] == q['cashierId']) s];
        if (q['paymentMethod'] != null) list = [for (final s in list) if ((s['paymentMethods'] as List).contains(q['paymentMethod'])) s];
        if (q['status'] != null) list = [for (final s in list) if (s['status'] == q['status']) s];
        if (q['type'] != null) list = [for (final s in list) if (s['type'] == q['type']) s];
        final size = int.parse(q['pageSize'] ?? '50');
        final page = int.parse(q['page'] ?? '1');
        final counted = [for (final s in list) if (s['status'] == 'completed') (s['type'] == 'return' ? -1 : 1) * double.parse(s['totalBase'] as String)];
        return _json({
          'items': list.skip((page - 1) * size).take(size).toList(),
          'total': list.length,
          'page': page,
          'pageSize': size,
          'totalBase': counted.fold<double>(0, (a, b) => a + b).toStringAsFixed(2),
        });
      case '/auth/verify-pin':
        if (req.headers['X-Floatly-Pin'] != pin) return _json({'statusCode': 403, 'code': 'wrong_pin', 'message': 'Wrong PIN'}, 403);
        return _json({'ok': true});
      case '/auth/pin':
        if (body['password'] != 'password123') return _json({'statusCode': 400, 'message': 'Wrong password'}, 400);
        pin = body['pin'] as String;
        hasPin = true;
        return _json({'ok': true});
      case '/dashboard':
        final depot = req.url.queryParameters['storeId'] == 's2';
        return _json({
          'date': '2026-11-10',
          'currencyCode': 'USD',
          'storeId': req.url.queryParameters['storeId'],
          'today': {'gross': depot ? '0.00' : '1234.50', 'sales': depot ? 0 : 41, 'returns': depot ? 0 : 2, 'averageBasket': depot ? '0.00' : '31.20'},
          'yesterday': {'gross': '1000.00', 'sales': 30, 'changePercent': depot ? null : 23.5},
          'lastWeek': {'day': '2026-11-03', 'gross': '1500.00', 'sales': 50, 'changePercent': depot ? null : -17.7},
          'trend': [
            for (var i = 3; i <= 10; i++) {'day': '2026-11-${i.toString().padLeft(2, '0')}', 'sales': i, 'returns': 0, 'gross': i == 10 ? (depot ? '0.00' : '1234.50') : '${i * 100}.00'},
          ],
          'topProducts': depot
              ? []
              : [
                  {'variantId': 'v1', 'name': 'Rice 5kg', 'quantity': '12.000', 'revenue': '120.00'},
                  {'variantId': 'v2', 'name': 'Cooking oil 2L', 'quantity': '8.500', 'revenue': '68.00'},
                ],
          'paymentMethods': depot
              ? []
              : [
                  {'method': 'cash', 'amount': '900.00'},
                  {'method': 'mobile', 'amount': '334.50'},
                ],
          'lowStock': {
            'total': depot ? 0 : 7,
            'items': depot
                ? []
                : [
                    {'variantId': 'v3', 'name': 'Sugar 2kg', 'onHand': '3.000', 'reorderLevel': '10.000'},
                  ],
          },
        });
    }
    final stock = _stock(req, path, body);
    if (stock != null) return stock;
    if (path.startsWith('/sales/')) {
      final sale = sales.where((s) => s['id'] == path.substring(7)).firstOrNull;
      if (sale == null) return _json({'statusCode': 404, 'message': 'Sale not found'}, 404);
      return _json(saleDetail(sale));
    }
    return _json({'statusCode': 404, 'message': 'Not found'}, 404);
  }
}

Map<String, dynamic> _sale(int n, {String type = 'sale', String status = 'completed', String total = '12.50', String cashier = 'Chipo Cashier', String cashierId = 'u2', List<String> methods = const ['cash'], String customer = 'Cash Customer', String? original}) => {
  'id': 'sale-$n',
  'number': '${type == 'return' ? 'R' : 'S'}-${n.toString().padLeft(5, '0')}',
  'type': type,
  'status': status,
  'storeId': 's1',
  'storeName': 'Main Store',
  'deviceName': 'Front till',
  'salesperson': cashier,
  'salespersonId': cashierId,
  'customerName': customer,
  'soldAt': '2026-11-10T${(8 + n % 10).toString().padLeft(2, '0')}:15:00.000Z',
  'currencyCode': 'USD',
  'subtotal': total,
  'discountTotal': '0.00',
  'taxTotal': '1.63',
  'total': total,
  'totalBase': total,
  'note': type == 'return' ? 'Torn bag' : null,
  'originalSaleId': original,
  'paymentMethods': methods,
};

/// The sales the fake server knows: 40 ordinary ones after a few special ones, newest first.
List<Map<String, dynamic>> fakeSales() => [
  _sale(105, total: '45.00', methods: ['cash', 'mobile'], customer: 'Mai Tino'),
  _sale(104, type: 'return', total: '5.00', cashier: 'Admin User', cashierId: 'u1', original: 'sale-103'),
  _sale(103, total: '20.00', methods: ['card']),
  _sale(102, status: 'void', total: '9.99'),
  for (var n = 101; n > 61; n--) _sale(n),
];

/// GET /sales/:id for one of [fakeSales].
Map<String, dynamic> saleDetail(Map<String, dynamic> s) => {
  ...s,
  'lines': [
    {
      'id': 'l1',
      'productName': 'Rice 5kg',
      'variantName': 'Default',
      'packName': null,
      'modifiers': null,
      'quantity': '2.000',
      'unitPrice': '5.00',
      'discount': '0.00',
      'total': '10.00',
      'note': null,
      'returnedQuantity': s['id'] == 'sale-103' ? '1.000' : '0.000',
    },
    {
      'id': 'l2',
      'productName': 'Cola',
      'variantName': '500ml',
      'packName': 'Case of 24',
      'modifiers': null,
      'quantity': '1.000',
      'unitPrice': '10.00',
      'discount': '0.00',
      'total': '10.00',
      'note': null,
      'returnedQuantity': '0.000',
    },
  ],
  'payments': [
    for (final m in s['paymentMethods'] as List)
      {'method': m, 'currencyCode': 'USD', 'amount': s['type'] == 'return' ? '-${s['total']}' : s['total'], 'change': m == 'cash' && s['type'] != 'return' ? '0.50' : '0.00', 'reference': null},
  ],
  'related': s['id'] == 'sale-103'
      ? [
          {'id': 'sale-104', 'number': 'R-00104', 'type': 'return', 'status': 'completed', 'total': '5.00', 'soldAt': '2026-11-10T12:15:00.000Z'},
        ]
      : [],
};

Future<(AdminState, FakeServer, MemoryStore)> signedIn({FakeServer? server, DateTime Function()? clock}) async {
  final fake = server ?? FakeServer();
  Api.httpClient = MockClient(fake.handle);
  final store = MemoryStore();
  final admin = AdminState(store, clock: clock);
  await admin.init();
  expect(await admin.signIn(server: 'http://localhost:4000', email: 'admin@shop.test', password: 'password123'), isNull);
  return (admin, fake, store);
}

/// Lets real network futures (the fake server) finish, then the frames they cause.
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 5; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await tester.pump(const Duration(milliseconds: 100));
  }
}

/// Signs in on a fake server and shows the app, as on a phone unless [size] says otherwise.
Future<(AdminState, FakeServer, TillState)> openAdmin(WidgetTester tester, {Size size = const Size(420, 900), FakeServer? server}) async {
  tester.view.physicalSize = size;
  tester.view.devicePixelRatio = 1;
  addTearDown(tester.view.reset);
  addTearDown(() => Api.httpClient = http.Client());
  late AdminState admin;
  late FakeServer fake;
  late TillState till;
  await tester.runAsync(() async {
    final (a, f, store) = await signedIn(server: server);
    admin = a;
    fake = f;
    till = TillState(store);
    await till.init();
  });
  addTearDown(() {
    admin.dispose();
    till.dispose();
  });
  await tester.pumpWidget(TillApp(state: till, admin: admin));
  await settle(tester);
  return (admin, fake, till);
}

/// Taps outside the test's fake clock, so the request it starts really runs, then lets the screen catch up.
Future<void> tapAndSettle(WidgetTester tester, Finder finder) async {
  await tester.runAsync(() async {
    await tester.tap(finder);
    await Future<void>.delayed(const Duration(milliseconds: 60));
  });
  await settle(tester);
}

/// Opens the menu and chooses a section.
Future<void> goTo(WidgetTester tester, String section) async {
  await tester.runAsync(() => tester.tap(find.byTooltip('Open navigation menu')));
  await tester.pumpAndSettle();
  await tapAndSettle(tester, find.text(section));
}
