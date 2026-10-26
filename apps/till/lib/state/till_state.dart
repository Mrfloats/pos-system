import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:crypto/crypto.dart';
import 'package:flutter/foundation.dart';
import 'package:uuid/uuid.dart';

import '../core/api.dart';
import '../core/local_store.dart';
import '../core/money.dart';
import '../models/catalog.dart';
import '../models/receipt.dart';
import '../models/sale.dart';

/// Sent with every sale so the backoffice can tell which till version made it.
const appVersion = 'till-1.0.0';

const _managerRoles = {'owner', 'admin', 'manager'};
const _sellerRoles = {'owner', 'admin', 'manager', 'cashier', 'waiter'};

/// Which business, store and till this device was paired as.
class DeviceConfig {
  DeviceConfig({
    required this.server,
    required this.deviceId,
    required this.deviceCode,
    required this.deviceName,
    required this.storeId,
    required this.storeName,
    required this.businessName,
  });

  DeviceConfig.fromJson(Map<String, dynamic> j)
    : server = j['server'] as String,
      deviceId = j['deviceId'] as String,
      deviceCode = j['deviceCode'] as String,
      deviceName = j['deviceName'] as String,
      storeId = j['storeId'] as String,
      storeName = j['storeName'] as String,
      businessName = j['businessName'] as String;

  final String server, deviceId, deviceCode, deviceName, storeId, storeName, businessName;

  Map<String, dynamic> toJson() => {
    'server': server,
    'deviceId': deviceId,
    'deviceCode': deviceCode,
    'deviceName': deviceName,
    'storeId': storeId,
    'storeName': storeName,
    'businessName': businessName,
  };
}

/// The staff member signed in on the till.
class Session {
  Session({required this.userId, required this.fullName, required this.role, this.token});

  final String userId, fullName, role;

  /// Null while signed in offline; sales wait until a token is had again.
  String? token;

  bool get canManage => _managerRoles.contains(role);
}

class ShiftInfo {
  ShiftInfo.fromJson(Map<String, dynamic> j)
    : id = j['id'] as String,
      number = j['number'] as String,
      openedAt = DateTime.parse(j['openedAt'] as String).toLocal();

  final String id, number;
  final DateTime openedAt;

  Map<String, dynamic> toJson() => {'id': id, 'number': number, 'openedAt': openedAt.toUtc().toIso8601String()};
}

/// A sale made on this till that hasn't reached Floatly yet.
class PendingSale {
  PendingSale({required this.clientId, required this.payload, this.error});

  PendingSale.fromJson(Map<String, dynamic> j) : clientId = j['clientId'] as String, payload = (j['payload'] as Map).cast(), error = j['error'] as String?;

  final String clientId;

  /// The body for POST /sales.
  final Map<String, dynamic> payload;

  /// Why Floatly refused it. Refused sales wait for a manager to retry or discard them.
  String? error;

  Map<String, dynamic> toJson() => {'clientId': clientId, 'payload': payload, 'error': error};
}

class TillSettings {
  TillSettings({this.paperWidth = 80, this.autoPrint = false});

  TillSettings.fromJson(Map<String, dynamic> j) : paperWidth = j['paperWidth'] as int? ?? 80, autoPrint = j['autoPrint'] as bool? ?? false;

  /// Receipt roll width in millimetres: 58 or 80.
  int paperWidth;
  bool autoPrint;

  Map<String, dynamic> toJson() => {'paperWidth': paperWidth, 'autoPrint': autoPrint};
}

/// A PIN that worked on this till before, kept (hashed) so the same person can
/// sign in when the internet is down.
class _KnownPin {
  _KnownPin({required this.userId, required this.fullName, required this.role, required this.salt, required this.hash});

  _KnownPin.fromJson(Map<String, dynamic> j)
    : userId = j['userId'] as String,
      fullName = j['fullName'] as String,
      role = j['role'] as String,
      salt = j['salt'] as String,
      hash = j['hash'] as String;

  final String userId, fullName, role, salt, hash;

  Map<String, dynamic> toJson() => {'userId': userId, 'fullName': fullName, 'role': role, 'salt': salt, 'hash': hash};
}

/// Everything the till knows and does. Screens listen to it and call its methods.
class TillState extends ChangeNotifier {
  TillState(this.store);

  final LocalStore store;

  bool ready = false;
  DeviceConfig? device;
  String? _deviceToken;
  Session? session;

  /// The signed-in person's PIN, in memory only, to get a fresh token after the
  /// internet comes back or the old one runs out.
  String? _sessionPin;
  Catalog? catalog;
  ShiftInfo? shift;

  /// Floatly has answered whether the signed-in person has a shift open.
  bool shiftChecked = false;
  TillSettings settings = TillSettings();

  /// Sales waiting to upload, oldest first.
  List<PendingSale> outbox = [];

  /// Recent receipts, newest first.
  List<Receipt> receipts = [];

  /// Whether the last call to Floatly got through.
  bool online = true;

  /// Something everyone should see, such as a lapsed subscription.
  String? notice;

  final List<CartLine> cart = [];
  Customer? customer;

  /// Printed on the receipt when no customer record is chosen.
  String? customerName;
  String? _saleCurrency;

  List<_KnownPin> _knownPins = [];
  Map<String, dynamic> _shifts = {};
  Timer? _timer;
  Future<void>? _syncing;

  // ----- Starting up --------------------------------------------------------------------

  Future<void> init() async {
    final d = await store.readJson('device');
    _deviceToken = await store.readSecret('device_token');
    device = d is Map && _deviceToken != null ? DeviceConfig.fromJson(d.cast()) : null;
    final c = Catalog.tryParse(await store.readJson('catalog'));
    catalog = c != null && c.store.id == device?.storeId ? c : null;
    outbox = _list(await store.readJson('outbox'), PendingSale.fromJson);
    receipts = _list(await store.readJson('receipts'), Receipt.fromJson);
    _knownPins = _list(await store.readJson('pins'), _KnownPin.fromJson);
    final s = await store.readJson('settings');
    if (s is Map) settings = TillSettings.fromJson(s.cast());
    final sh = await store.readJson('shifts');
    if (sh is Map) _shifts = sh.cast();
    ready = true;
    notifyListeners();
    _timer = Timer.periodic(const Duration(seconds: 30), (_) => _tick());
  }

  static List<T> _list<T>(Object? json, T Function(Map<String, dynamic>) parse) {
    if (json is! List) return [];
    final out = <T>[];
    for (final item in json) {
      try {
        out.add(parse((item as Map).cast()));
      } catch (_) {
        // Skip anything saved by an older version that no longer reads.
      }
    }
    return out;
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  // ----- Pairing ------------------------------------------------------------------------

  /// Saves what this device was paired as. Called by the setup screen after an owner
  /// or admin chose the store and till and got the till's secret.
  Future<void> pair(DeviceConfig config, String deviceToken) async {
    if (device?.storeId != config.storeId) {
      catalog = null;
      await store.delete('catalog');
    }
    if (device?.deviceId != config.deviceId) {
      _knownPins = [];
      _shifts = {};
      await store.delete('pins');
      await store.delete('shifts');
    }
    device = config;
    _deviceToken = deviceToken;
    await store.writeSecret('device_token', deviceToken);
    await store.writeJson('device', config.toJson());
    session = null;
    notifyListeners();
  }

  /// Forgets the pairing and everything downloaded. Sales still waiting are lost.
  Future<void> unpair() async {
    lock();
    for (final key in ['device', 'catalog', 'outbox', 'receipts', 'pins', 'shifts', 'counter']) {
      await store.delete(key);
    }
    await store.deleteSecret('device_token');
    device = null;
    _deviceToken = null;
    catalog = null;
    outbox = [];
    receipts = [];
    _knownPins = [];
    _shifts = {};
    notifyListeners();
  }

  // ----- Signing in ---------------------------------------------------------------------

  Api _publicApi() => Api(server: device!.server);

  /// Signs someone in with their PIN. Returns null when it worked, else what to tell them.
  Future<String?> signIn(String pin) async {
    final d = device;
    if (d == null) return 'This till is not set up';
    try {
      final res = await _publicApi().post('/auth/till', {'deviceToken': _deviceToken, 'pin': pin}, const Duration(seconds: 15)) as Map;
      final role = res['membership']['role'] as String;
      if (!_sellerRoles.contains(role)) return "Your role can't sell on a till. Ask a manager to change it in the backoffice.";
      online = true;
      notice = null;
      session = Session(userId: res['user']['id'] as String, fullName: res['user']['fullName'] as String, role: role, token: res['accessToken'] as String);
      _sessionPin = pin;
      final saved = _shifts[session!.userId];
      shift = saved is Map ? ShiftInfo.fromJson(saved.cast()) : null;
      await _rememberPin(pin, session!);
      notifyListeners();
      unawaited(_afterOnlineSignIn());
      return null;
    } on ApiException catch (e) {
      if (!e.isOffline) {
        online = true;
        notifyListeners();
        return e.message;
      }
      online = false;
      final known = _matchPin(pin);
      if (known == null) {
        notifyListeners();
        return "Can't reach Floatly, and this PIN hasn't been used on this till before. Connect to the internet to sign in.";
      }
      if (catalog == null) {
        notifyListeners();
        return 'This till has no products saved yet. Connect to the internet once to download them.';
      }
      session = Session(userId: known.userId, fullName: known.fullName, role: known.role);
      _sessionPin = pin;
      final saved = _shifts[known.userId];
      shift = saved is Map ? ShiftInfo.fromJson(saved.cast()) : null;
      notifyListeners();
      return null;
    }
  }

  Future<void> _afterOnlineSignIn() async {
    try {
      await refreshCatalog();
      await loadShift();
    } on ApiException {
      // Shown through [online] and [notice]; the till still works from what it has saved.
    }
    await sync();
  }

  /// Signs out, so the next person enters their PIN. The basket stays.
  void lock() {
    session = null;
    _sessionPin = null;
    shift = null;
    shiftChecked = false;
    notifyListeners();
  }

  String _hashPin(String pin, String salt) {
    var bytes = utf8.encode('$salt:${device?.deviceId}:$pin');
    for (var i = 0; i < 5000; i++) {
      bytes = Uint8List.fromList(sha256.convert(bytes).bytes);
    }
    return base64Encode(bytes);
  }

  Future<void> _rememberPin(String pin, Session s) async {
    final rnd = Random.secure();
    final salt = base64Encode(List.generate(16, (_) => rnd.nextInt(256)));
    _knownPins = [
      _KnownPin(userId: s.userId, fullName: s.fullName, role: s.role, salt: salt, hash: _hashPin(pin, salt)),
      // A PIN belongs to one person: drop this person's old entry and anyone else's with the same PIN.
      for (final k in _knownPins)
        if (k.userId != s.userId && k.hash != _hashPin(pin, k.salt)) k,
    ].take(30).toList();
    await store.writeJson('pins', [for (final k in _knownPins) k.toJson()]);
  }

  _KnownPin? _matchPin(String pin) {
    for (final k in _knownPins) {
      if (k.hash == _hashPin(pin, k.salt)) return k;
    }
    return null;
  }

  /// Gets a new token with the PIN in memory (after being offline, or when the old one ran out).
  Future<bool> _reauth() async {
    final pin = _sessionPin;
    final s = session;
    if (pin == null || s == null || device == null) return false;
    try {
      final res = await _publicApi().post('/auth/till', {'deviceToken': _deviceToken, 'pin': pin}, const Duration(seconds: 15)) as Map;
      if (res['user']['id'] != s.userId) return false;
      s.token = res['accessToken'] as String;
      online = true;
      notifyListeners();
      return true;
    } on ApiException catch (e) {
      online = !e.isOffline;
      notifyListeners();
      return false;
    }
  }

  /// Calls the API as the signed-in person: gets a new token when needed and keeps
  /// [online] and [notice] up to date.
  Future<T> _call<T>(Future<T> Function(Api api) fn) async {
    final s = session;
    if (s == null) throw ApiException(401, 'Sign in first');
    if (s.token == null && !await _reauth()) {
      throw ApiException(0, "Can't reach Floatly. You can keep selling; sales upload when the internet is back.");
    }
    try {
      final result = await fn(Api(server: device!.server, token: s.token));
      _setOnline(true);
      return result;
    } on ApiException catch (e) {
      _setOnline(!e.isOffline);
      if (e.status == 401) {
        if (await _reauth()) return fn(Api(server: device!.server, token: s.token));
        // The PIN no longer works (changed or removed): sales wait until someone signs in again.
        s.token = null;
        notifyListeners();
      }
      if (e.status == 402) {
        notice = e.message;
        notifyListeners();
      }
      rethrow;
    }
  }

  void _setOnline(bool value) {
    if (online == value) return;
    online = value;
    notifyListeners();
  }

  // ----- Catalog and shifts -------------------------------------------------------------------

  Future<void> refreshCatalog() async {
    final json = await _call((api) => api.get('/till/catalog', query: {'storeId': device!.storeId}, timeout: const Duration(seconds: 60)));
    final next = Catalog.fromJson((json as Map).cast());
    catalog = next;
    if (_saleCurrency != null && !next.currencies.any((c) => c.code == _saleCurrency)) _saleCurrency = null;
    await store.writeJson('catalog', json);
    notifyListeners();
  }

  /// Finds the signed-in person's open shift in this store.
  Future<void> loadShift() async {
    final res = await _call((api) => api.get('/shifts', query: {'storeId': device!.storeId, 'state': 'open', 'pageSize': '100'})) as Map;
    final mine = (res['items'] as List).cast<Map>().where((s) => s['cashierId'] == session?.userId).firstOrNull;
    shiftChecked = true;
    await _setShift(mine == null ? null : ShiftInfo.fromJson(mine.cast()));
  }

  Future<void> _setShift(ShiftInfo? s) async {
    shift = s;
    final userId = session?.userId;
    if (userId != null) {
      if (s == null) {
        _shifts.remove(userId);
      } else {
        _shifts[userId] = s.toJson();
      }
      await store.writeJson('shifts', _shifts);
    }
    notifyListeners();
  }

  /// [float] is cash in the drawer per currency, e.g. {"USD": "20.00"}.
  Future<void> openShift(Map<String, String> float) async {
    final res = await _call((api) => api.post('/shifts', {'storeId': device!.storeId, 'deviceId': device!.deviceId, 'openingFloat': float}));
    await _setShift(ShiftInfo.fromJson((res as Map).cast()));
  }

  /// Uploads every sale first, so the cash-up counts them all. Returns the cash-up.
  Future<Map<String, dynamic>> closeShift(Map<String, String> counted, String? note) async {
    final s = shift;
    if (s == null) throw ApiException(400, 'No shift is open');
    await sync();
    final waiting = outbox.where((p) => p.payload['shiftId'] == s.id).length;
    if (waiting > 0) {
      throw ApiException(
        400,
        waiting == 1
            ? 'A sale from this shift is still waiting to upload. Connect to the internet, or ask a manager to look at it under Sales, then try again.'
            : '$waiting sales from this shift are still waiting to upload. Connect to the internet, or ask a manager to look at them under Sales, then try again.',
      );
    }
    final res = await _call((api) => api.post('/shifts/${s.id}/close', {'countedCash': counted, if (note != null && note.isNotEmpty) 'note': note}));
    await _setShift(null);
    return (res as Map).cast();
  }

  // ----- The basket -----------------------------------------------------------------------

  Currency get saleCurrency => _saleCurrency == null ? catalog!.baseCurrency : catalog!.currency(_saleCurrency!);

  PricedCart get priced => priceCart(lines: cart, currency: saleCurrency, taxRates: catalog!.taxRates, customer: customer);

  void addItem(Product product, Variant variant, {int quantity = 1000}) {
    final same = product.partQuantities ? null : cart.where((l) => l.variant.id == variant.id && l.plain).firstOrNull;
    if (same != null) {
      same.quantity += quantity;
      // The line just added to moves to the bottom, where the cashier is looking.
      cart
        ..remove(same)
        ..add(same);
    } else {
      cart.add(CartLine(product: product, variant: variant, quantity: quantity));
    }
    notifyListeners();
  }

  void setQuantity(CartLine line, int quantity) {
    if (quantity <= 0) {
      cart.remove(line);
    } else {
      line.quantity = quantity;
    }
    notifyListeners();
  }

  void updateLine(CartLine line, {required int quantity, required int? unitPrice, required int? discount, required String? note}) {
    line
      ..quantity = quantity
      ..unitPrice = unitPrice
      ..discount = discount
      ..note = (note ?? '').trim().isEmpty ? null : note!.trim();
    notifyListeners();
  }

  void removeLine(CartLine line) {
    cart.remove(line);
    notifyListeners();
  }

  void clearCart() {
    cart.clear();
    customer = null;
    customerName = null;
    _saleCurrency = null;
    notifyListeners();
  }

  void setCustomer(Customer? c, {String? name}) {
    customer = c;
    customerName = c == null ? name : null;
    notifyListeners();
  }

  /// Prices typed in were in the old currency, so they are cleared.
  void setSaleCurrency(Currency c) {
    if (c.code == saleCurrency.code) return;
    _saleCurrency = c.isBase ? null : c.code;
    for (final l in cart) {
      l.unitPrice = null;
      l.discount = null;
    }
    notifyListeners();
  }

  /// Adds a customer created at the till (needs the internet).
  Future<Customer> createCustomer(Map<String, String> fields) async {
    final res = await _call((api) => api.post('/customers', fields)) as Map;
    final c = Customer.fromJson({...res.cast<String, dynamic>(), 'discountPercent': null});
    catalog = catalog!.withCustomer(c);
    await store.writeJson('catalog', catalog!.raw);
    notifyListeners();
    return c;
  }

  // ----- Selling ------------------------------------------------------------------------

  Future<String> _nextReference() async {
    final n = int.tryParse(await store.read('counter') ?? '') ?? 0;
    await store.write('counter', '${n + 1}');
    return '${device!.deviceCode}-${(n + 1).toString().padLeft(6, '0')}';
  }

  /// Records the sale on the till straight away, then tries to upload it. Works offline.
  Future<Receipt> completeSale(List<Payment> payments) async {
    final cart = priced;
    final settlement = settle(payments, cart);
    if (cart.isEmpty) throw StateError('The basket is empty');
    if (!settlement.complete) throw StateError(settlement.problem ?? 'The payment is short');
    final s = session!;
    final c = catalog!;
    final d = device!;
    final clientId = const Uuid().v4();
    final reference = await _nextReference();
    final soldAt = DateTime.now();

    final payload = <String, dynamic>{
      'storeId': d.storeId,
      'deviceId': d.deviceId,
      'shiftId': ?shift?.id,
      'clientId': clientId,
      'soldAt': soldAt.toUtc().toIso8601String(),
      'appVersion': appVersion,
      'salespersonId': s.userId,
      'currencyCode': cart.currency.code,
      if (!cart.currency.isBase) 'rate': cart.rate,
      'customerId': ?customer?.id,
      if (customer == null && (customerName ?? '').isNotEmpty) 'customerName': customerName,
      'note': 'Till receipt $reference',
      // Prices and discounts go as the customer was charged, so Floatly records exactly that.
      'lines': [
        for (final l in cart.lines)
          {
            'variantId': l.line.variant.id,
            'quantity': formatFixed(l.line.quantity, 3),
            'unitPrice': fromCents(l.unitPrice),
            'discount': fromCents(l.discount),
            'note': ?l.line.note,
          },
      ],
      'payments': [
        for (final p in payments)
          {
            'method': p.method.name,
            'currencyCode': p.currency.code,
            if (!p.currency.isBase) 'rate': paymentRate(p.currency, cart),
            'amount': fromCents(p.amount),
            if ((p.reference ?? '').isNotEmpty) 'reference': p.reference,
          },
      ],
    };
    final receipt = Receipt.forSale(
      clientId: clientId,
      reference: reference,
      soldAt: soldAt,
      catalog: c,
      cashier: s.fullName,
      cart: cart,
      payments: payments,
      settlement: settlement,
      customer: customer,
      customerName: customerName,
    );
    outbox.add(PendingSale(clientId: clientId, payload: payload));
    receipts.insert(0, receipt);
    if (receipts.length > 300) receipts.removeRange(300, receipts.length);
    await _saveOutbox();
    await _saveReceipts();
    clearCart();

    // Give it a few seconds to upload, so the receipt can carry Floatly's sale number.
    await sync().timeout(const Duration(seconds: 8), onTimeout: () {});
    return receipt;
  }

  Future<void> _saveOutbox() => store.writeJson('outbox', [for (final p in outbox) p.toJson()]);
  Future<void> _saveReceipts() => store.writeJson('receipts', [for (final r in receipts) r.toJson()]);

  int get waitingCount => outbox.where((p) => p.error == null).length;
  int get refusedCount => outbox.where((p) => p.error != null).length;

  PendingSale? pendingFor(Receipt r) => outbox.where((p) => p.clientId == r.clientId).firstOrNull;

  /// Uploads waiting sales, oldest first. Safe to call any time; calls made while
  /// an upload is running wait for it.
  Future<void> sync() => _syncing ??= _runSync().whenComplete(() => _syncing = null);

  Future<void> _runSync() async {
    if (session == null || device == null) return;
    final tried = <String>{};
    while (true) {
      final next = outbox.where((p) => p.error == null && !tried.contains(p.clientId)).firstOrNull;
      if (next == null) break;
      tried.add(next.clientId);
      try {
        final sale = await _call((api) => api.post('/sales', next.payload, const Duration(seconds: 45))) as Map;
        await _uploaded(next, sale);
      } on ApiException catch (e) {
        // A shift closed in the backoffice before this sale arrived: record it without the shift.
        if (e.status == 400 && next.payload.containsKey('shiftId') && e.message.contains('is closed')) {
          next.payload.remove('shiftId');
          tried.remove(next.clientId);
          await _saveOutbox();
          continue;
        }
        // Offline, signed out, subscription lapsed, too busy: try again later.
        if (e.isOffline || e.status == 401 || e.status == 402 || e.status == 429 || e.status >= 500) break;
        next.error = e.message;
        await _saveOutbox();
        notifyListeners();
      }
    }
  }

  Future<void> _uploaded(PendingSale p, Map sale) async {
    outbox.remove(p);
    final r = receipts.where((r) => r.clientId == p.clientId).firstOrNull;
    if (r != null) {
      r.number = sale['number'] as String?;
      r.saleId = sale['id'] as String?;
    }
    await _saveOutbox();
    await _saveReceipts();
    notifyListeners();
  }

  /// Sends a refused sale again (after the problem was fixed in the backoffice).
  Future<void> retry(PendingSale p) async {
    p.error = null;
    await _saveOutbox();
    notifyListeners();
    await sync();
  }

  /// Throws away a sale Floatly refused. Its receipt stays, marked as not recorded.
  Future<void> discard(PendingSale p) async {
    outbox.remove(p);
    receipts.where((r) => r.clientId == p.clientId).firstOrNull?.discarded = true;
    await _saveOutbox();
    await _saveReceipts();
    notifyListeners();
  }

  // ----- Refunds ------------------------------------------------------------------------

  Future<Map<String, dynamic>> loadSale(String saleId) async => ((await _call((api) => api.get('/sales/$saleId'))) as Map).cast();

  Future<Map<String, dynamic>> refund(String saleId, Map<String, dynamic> body) async =>
      ((await _call((api) => api.post('/sales/$saleId/returns', {...body, 'shiftId': ?shift?.id}))) as Map).cast();

  // ----- Settings -----------------------------------------------------------------------

  Future<void> saveSettings() async {
    await store.writeJson('settings', settings.toJson());
    notifyListeners();
  }

  /// Every 30 seconds: upload what's waiting and keep the catalog fresh.
  Future<void> _tick() async {
    if (session == null) return;
    try {
      if (session!.token == null) await _reauth();
      if (waitingCount > 0) await sync();
      final c = catalog;
      if (session?.token != null && (c == null || DateTime.now().difference(c.syncedAt) > const Duration(minutes: 5))) {
        await refreshCatalog();
      }
    } on ApiException {
      // Shown through [online]; tried again on the next tick.
    }
  }
}
