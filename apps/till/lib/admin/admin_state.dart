import 'dart:async';

import 'package:flutter/foundation.dart';

import '../core/api.dart';
import '../core/local_store.dart';
import '../core/money.dart';

/// A business the signed-in person belongs to.
class Business {
  Business({required this.tenantId, required this.name, required this.role});

  factory Business.fromJson(Map<String, dynamic> j) => Business(tenantId: j['tenantId'] as String, name: j['name'] as String, role: j['role'] as String);

  final String tenantId, name, role;
}

/// A branch: a shop, restaurant or warehouse.
class StoreInfo {
  StoreInfo({required this.id, required this.name, required this.code, required this.type});

  factory StoreInfo.fromJson(Map<String, dynamic> j) =>
      StoreInfo(id: j['id'] as String, name: j['name'] as String, code: j['code'] as String, type: (j['type'] as String?) ?? 'shop');

  final String id, name, code, type;

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'code': code, 'type': type};
}

const roleLabels = {
  'owner': 'Owner',
  'admin': 'Admin',
  'manager': 'Manager',
  'cashier': 'Cashier',
  'waiter': 'Waiter',
  'stock_clerk': 'Stock clerk',
  'accountant': 'Accountant',
};

/// The owner, admin or manager signed in to manage the business, as the API describes them.
class AdminSession {
  AdminSession(this.json);

  /// The API's sign-in answer without its tokens: user, tenant, membership, businesses.
  final Map<String, dynamic> json;

  Map<String, dynamic> get _user => (json['user'] as Map).cast();
  Map<String, dynamic> get _tenant => (json['tenant'] as Map).cast();
  Map<String, dynamic> get _membership => (json['membership'] as Map).cast();

  String get userId => _user['id'] as String;
  String get fullName => _user['fullName'] as String;
  String get email => _user['email'] as String;
  String get role => _membership['role'] as String;
  String get roleLabel => roleLabels[role] ?? role;

  /// Short staff ID, e.g. ADM-001.
  String get staffCode => (_membership['staffCode'] as String?) ?? '';
  bool get hasPin => _membership['hasPin'] == true;
  String get tenantId => _tenant['id'] as String;
  String get businessName => _tenant['name'] as String;
  String get currencyCode => (_tenant['baseCurrency'] as String?) ?? 'USD';
  late final Set<String> permissions = {...((_membership['permissions'] as List?) ?? const []).cast<String>()};
  late final List<Business> businesses = [for (final b in (json['businesses'] as List? ?? const [])) Business.fromJson((b as Map).cast())];

  /// Whether to show something. The API checks again on every request.
  bool can(String permission) => permissions.contains(permission);

  /// Two letters for the avatar.
  String get initials {
    final parts = fullName.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return (parts.length == 1 ? parts.first.substring(0, 1) : parts.first.substring(0, 1) + parts.last.substring(0, 1)).toUpperCase();
  }

  /// What is kept on the phone between starts.
  Map<String, dynamic> toSaved() => {
    'user': _user,
    'tenant': {'id': tenantId, 'name': businessName, 'baseCurrency': currencyCode, 'timezone': _tenant['timezone']},
    'membership': _membership,
    'businesses': json['businesses'],
  };
}

/// How long the admin area stays open untouched before it asks for the PIN again.
const idleLimit = Duration(minutes: 5);

/// The backoffice in your pocket: an owner, admin or manager signed in with their
/// email and password to manage the business from this phone. Separate from the
/// till ([TillState]); a phone can be both.
///
/// The sign-in is a refreshable session: a short-lived access token kept in
/// memory and a refresh token in the phone's keychain, swapped for a new pair
/// when the access token runs out. It is only kept between starts once the
/// person has a PIN, which then unlocks the app.
class AdminState extends ChangeNotifier {
  AdminState(this.store, {DateTime Function()? clock}) : _now = clock ?? DateTime.now;

  final LocalStore store;
  final DateTime Function() _now;

  bool ready = false;
  String server = '';
  AdminSession? session;
  List<StoreInfo> stores = [];

  /// The branch being looked at; null for all of them together.
  String? storeId;

  /// The base currency's symbol ("$").
  String symbol = '';

  /// Waiting for the PIN: after starting the app, or after [idleLimit] untouched.
  bool locked = false;

  /// Signed in to manage, but using the till for now.
  bool showTill = false;

  /// Why the last session ended ("Your session has ended…"), for the sign-in screen.
  String? notice;

  String? _refreshToken;
  String? _accessToken;
  DateTime? _accessExpires;
  Future<void>? _refreshing;
  Timer? _idle;

  /// Kept only between signing in and choosing a first PIN, so that step doesn't ask for it again.
  String? _password;

  bool get signedIn => session != null;

  /// True right after signing in without a PIN yet: time to offer one.
  bool get shouldOfferPin => session != null && !session!.hasPin && _password != null;

  StoreInfo? get currentStore => stores.where((s) => s.id == storeId).firstOrNull;

  /// "$12.50" from the API's "12.50".
  String money(Object? amount) => formatMoney(toCents(amount), symbol);

  // ----- Starting up ----------------------------------------------------------------------

  Future<void> init() async {
    final saved = await store.readJson('admin');
    final refresh = await store.readSecret('admin_refresh');
    if (saved is Map && refresh != null) {
      try {
        server = saved['server'] as String;
        session = AdminSession((saved['session'] as Map).cast());
        stores = [for (final s in (saved['stores'] as List? ?? const [])) StoreInfo.fromJson((s as Map).cast())];
        storeId = saved['storeId'] as String?;
        symbol = (saved['symbol'] as String?) ?? '';
        _refreshToken = refresh;
        // Whoever opens the app proves who they are first.
        locked = true;
      } catch (_) {
        // Saved by a version that no longer reads: sign in again.
        session = null;
        await _forget();
      }
    }
    ready = true;
    notifyListeners();
  }

  @override
  void dispose() {
    _idle?.cancel();
    super.dispose();
  }

  // ----- Signing in and out ---------------------------------------------------------------

  /// Signs in with email and password. Returns null when it worked, else what to tell them.
  Future<String?> signIn({required String server, required String email, required String password}) async {
    try {
      final res =
          await Api(server: server, client: 'mobile').post('/auth/login', {'email': email.trim(), 'password': password, 'session': 'mobile'}) as Map;
      this.server = server;
      notice = null;
      locked = false;
      showTill = false;
      storeId = null;
      _take(res.cast());
      _password = session!.hasPin ? null : password;
      await _loadBasics();
      await _save();
      _restartIdle();
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  /// Reads the tokens and profile out of a sign-in or refresh answer.
  void _take(Map<String, dynamic> res) {
    _accessToken = res['accessToken'] as String;
    _refreshToken = res['refreshToken'] as String;
    // Swap a little early, so a request never leaves with a token about to run out.
    _accessExpires = _now().add(Duration(seconds: ((res['expiresIn'] as num?) ?? 900).toInt() - 30));
    session = AdminSession({...res}..removeWhere((k, _) => k == 'accessToken' || k == 'refreshToken' || k == 'expiresIn'));
  }

  /// Branches and the currency symbol: needed by every screen.
  Future<void> _loadBasics() async {
    final list = await call((api) => api.get('/stores')) as List;
    stores = [
      for (final s in list.cast<Map>())
        if (s['active'] != false) StoreInfo.fromJson(s.cast()),
    ];
    if (storeId != null && !stores.any((s) => s.id == storeId)) storeId = null;
    final currencies = await call((api) => api.get('/currencies')) as List;
    final base = currencies.cast<Map>().where((c) => c['isBase'] == true).firstOrNull;
    symbol = (base?['symbol'] as String?) ?? session!.currencyCode;
  }

  /// Keeps the sign-in between starts, once there is a PIN to unlock it with.
  Future<void> _save() async {
    final s = session;
    if (s == null || !s.hasPin || _refreshToken == null) return;
    await store.writeSecret('admin_refresh', _refreshToken!);
    await store.writeJson('admin', {
      'server': server,
      'session': s.toSaved(),
      'stores': [for (final st in stores) st.toJson()],
      'storeId': storeId,
      'symbol': symbol,
    });
  }

  /// Removes everything kept on the phone about the sign-in.
  Future<void> _forget() async {
    await store.deleteSecret('admin_refresh');
    await store.delete('admin');
  }

  Future<void> _end(String? why) async {
    _idle?.cancel();
    session = null;
    _accessToken = null;
    _refreshToken = null;
    _accessExpires = null;
    _password = null;
    stores = [];
    storeId = null;
    locked = false;
    showTill = false;
    notice = why;
    await _forget();
    notifyListeners();
  }

  /// Signs out: the refresh token stops working on the server, and nothing is left on the phone.
  Future<void> signOut() async {
    final token = _refreshToken;
    if (token != null && server.isNotEmpty) {
      try {
        await Api(server: server, client: 'mobile').post('/auth/logout', {'refreshToken': token}, const Duration(seconds: 8));
      } on ApiException {
        // Offline: the token is forgotten here and runs out on its own.
      }
    }
    await _end(null);
  }

  // ----- Calling the API ------------------------------------------------------------------

  Api _api(String? pin) => Api(server: server, token: _accessToken, client: 'mobile', pin: pin);

  /// Calls the API as the signed-in person, swapping the refresh token for a new
  /// access token when needed. [pin] confirms a sensitive action.
  Future<T> call<T>(Future<T> Function(Api api) fn, {String? pin}) async {
    if (session == null) throw ApiException(401, 'Sign in first');
    final expires = _accessExpires;
    if (_accessToken == null || expires == null || !_now().isBefore(expires)) await _refresh();
    try {
      return await fn(_api(pin));
    } on ApiException catch (e) {
      if (e.status != 401) rethrow;
      await _refresh();
      return fn(_api(pin));
    }
  }

  /// One swap at a time: a refresh token works once, so two screens loading together must share it.
  Future<void> _refresh({String? tenantId}) => _refreshing ??= _doRefresh(tenantId).whenComplete(() => _refreshing = null);

  Future<void> _doRefresh(String? tenantId) async {
    final token = _refreshToken;
    if (token == null) throw ApiException(401, 'Sign in first');
    try {
      final res =
          await Api(server: server, client: 'mobile').post('/auth/refresh', {'refreshToken': token, 'tenantId': ?tenantId}, const Duration(seconds: 15)) as Map;
      _take(res.cast());
      await _save();
      notifyListeners();
    } on ApiException catch (e) {
      // Signed out elsewhere, access removed, role changed, or unused too long.
      if (e.status == 401 || e.status == 403) await _end(e.status == 403 ? e.message : 'Your session has ended. Sign in again.');
      rethrow;
    }
  }

  // ----- Locking --------------------------------------------------------------------------

  /// Any touch in the admin area: the idle clock starts again.
  void touch() {
    if (session != null && !locked) _restartIdle();
  }

  void _restartIdle() {
    _idle?.cancel();
    _idle = Timer(idleLimit, lock);
  }

  /// Hides the admin area until the PIN is entered. Without a PIN there is nothing to unlock with, so it signs out.
  void lock() {
    final s = session;
    if (s == null || locked) return;
    _idle?.cancel();
    if (!s.hasPin) {
      unawaited(signOut());
      return;
    }
    locked = true;
    _accessToken = null;
    notifyListeners();
  }

  /// Checks the PIN with the server. Returns null when it unlocked, else what to tell them.
  Future<String?> unlock(String pin) async {
    try {
      await call((api) => api.post('/auth/verify-pin'), pin: pin);
      locked = false;
      showTill = false;
      _restartIdle();
      notifyListeners();
      // Things may have changed while it was locked.
      unawaited(_loadBasics().then((_) => _save()).then((_) => notifyListeners()).catchError((_) {}));
      return null;
    } on ApiException catch (e) {
      if (e.isOffline) return 'Connect to the internet to unlock.';
      return e.message;
    }
  }

  /// Chooses a first PIN straight after signing in. Returns null when it worked.
  Future<String?> choosePin(String pin) async {
    final password = _password;
    if (password == null) return 'Sign in again to choose a PIN.';
    try {
      await call((api) => api.post('/auth/pin', {'password': password, 'pin': pin}));
      _password = null;
      (session!.json['membership'] as Map)['hasPin'] = true;
      session = AdminSession(session!.json);
      await _save();
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  /// Carries on without a PIN: the sign-in then lasts only until the app closes or sits idle.
  void skipPin() {
    _password = null;
    notifyListeners();
  }

  // ----- Branches and businesses ----------------------------------------------------------

  Future<void> setStore(String? id) async {
    if (storeId == id) return;
    storeId = id;
    notifyListeners();
    await _save();
  }

  /// Moves to another business the person belongs to. Returns null when it worked.
  Future<String?> switchBusiness(String tenantId) async {
    try {
      await _refresh(tenantId: tenantId);
      storeId = null;
      await _loadBasics();
      await _save();
      notifyListeners();
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  /// Leaves the admin area open (locked) and shows the till.
  void goToTill() {
    showTill = true;
    lock();
    notifyListeners();
  }

  /// Back from the till: the PIN screen comes first.
  void returnFromTill() {
    showTill = false;
    notifyListeners();
  }
}
