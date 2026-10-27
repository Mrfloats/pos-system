import 'package:flutter/material.dart';

import '../core/api.dart';
import '../state/till_state.dart';
import '../theme.dart';
import '../widgets/common.dart';

/// The Floatly server most businesses use.
/// For testing against another server: flutter run --dart-define=FLOATLY_SERVER=http://localhost:4000
const defaultServer = String.fromEnvironment('FLOATLY_SERVER', defaultValue: 'https://floatly-api.vercel.app');

enum _Step { signIn, business, store, device }

/// Pairs this device with a store: an owner or admin signs in, picks the store
/// and the till (or adds one), and the device gets its own secret. The owner's
/// sign-in isn't kept; from then on staff use their PINs.
class SetupScreen extends StatefulWidget {
  const SetupScreen({super.key, this.canCancel = false});

  /// Opened from the PIN screen to pair again, rather than on first start.
  final bool canCancel;

  @override
  State<SetupScreen> createState() => _SetupScreenState();
}

class _SetupScreenState extends State<SetupScreen> {
  final _server = TextEditingController(text: defaultServer);
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _newName = TextEditingController(text: 'Till 1');
  final _newCode = TextEditingController(text: 'T01');

  _Step _step = _Step.signIn;
  bool _busy = false;
  String? _error;
  bool _showServer = false;

  Api? _api;
  String _businessName = '';
  List<Map> _businesses = [];
  List<Map> _stores = [];
  List<Map> _devices = [];
  Map? _store;

  @override
  void initState() {
    super.initState();
    final current = TillScope.read(context).device;
    if (current != null) _server.text = current.server;
  }

  @override
  void dispose() {
    for (final c in [_server, _email, _password, _newName, _newCode]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _run(Future<void> Function() task) async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await task();
    } on ApiException catch (e) {
      _error = e.message;
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _signIn() => _run(() async {
    final server = _server.text.trim().isEmpty ? defaultServer : _server.text.trim();
    final res = await Api(server: server).post('/auth/login', {'email': _email.text.trim(), 'password': _password.text}) as Map;
    _businesses = (res['businesses'] as List).cast<Map>().where((b) => b['role'] == 'owner' || b['role'] == 'admin').toList();
    if (_businesses.isEmpty) {
      throw ApiException(403, 'Only an owner or admin can set up a till. Ask one of them to sign in here.');
    }
    _password.clear();
    final current = (res['tenant'] as Map)['id'];
    final role = (res['membership'] as Map)['role'];
    if (_businesses.length > 1) {
      _api = Api(server: server, token: res['accessToken'] as String);
      _step = _Step.business;
    } else if (_businesses.first['tenantId'] == current && (role == 'owner' || role == 'admin')) {
      await _useBusiness(Api(server: server, token: res['accessToken'] as String), (res['tenant'] as Map)['name'] as String);
    } else {
      _api = Api(server: server, token: res['accessToken'] as String);
      await _chooseBusiness(_businesses.first);
    }
  });

  Future<void> _chooseBusiness(Map b) async {
    final res = await _api!.post('/auth/switch-tenant', {'tenantId': b['tenantId']}) as Map;
    await _useBusiness(Api(server: _api!.base, token: res['accessToken'] as String), b['name'] as String);
  }

  Future<void> _useBusiness(Api api, String name) async {
    _api = api;
    _businessName = name;
    _stores = (await api.get('/stores') as List).cast<Map>().where((s) => s['active'] == true).toList();
    if (_stores.isEmpty) throw ApiException(400, 'This business has no open stores. Add one in the backoffice first.');
    _step = _Step.store;
    if (_stores.length == 1) await _chooseStore(_stores.first);
  }

  Future<void> _chooseStore(Map store) async {
    _store = store;
    _devices = (await _api!.get('/devices', query: {'storeId': store['id'] as String}) as List)
        .cast<Map>()
        .where((d) => d['active'] == true && d['kind'] != 'kitchen_display')
        .toList();
    final used = _devices.map((d) => d['code']).toSet();
    var n = 1;
    while (used.contains('T${n.toString().padLeft(2, '0')}')) {
      n++;
    }
    _newCode.text = 'T${n.toString().padLeft(2, '0')}';
    _newName.text = 'Till $n';
    _step = _Step.device;
  }

  Future<void> _pairWith(Map device) async {
    if (device['registered'] == true &&
        !await confirm(
          context,
          title: 'Use ${device['name']}?',
          message: 'Another device is already set up as ${device['name']}. It will be signed out and stop working.',
          yes: 'Use it here',
        )) {
      return;
    }
    await _run(() async {
      final res = await _api!.post('/devices/${device['id']}/token') as Map;
      if (!mounted) return;
      await TillScope.read(context).pair(
        DeviceConfig(
          server: _api!.base,
          deviceId: device['id'] as String,
          deviceCode: device['code'] as String,
          deviceName: device['name'] as String,
          storeId: _store!['id'] as String,
          storeName: _store!['name'] as String,
          businessName: _businessName,
        ),
        res['token'] as String,
      );
      if (mounted && widget.canCancel) Navigator.of(context).pop();
    });
  }

  Future<void> _addDevice() => _run(() async {
    final device = await _api!.post('/devices', {
      'storeId': _store!['id'],
      'name': _newName.text.trim(),
      'code': _newCode.text.trim(),
      'kind': isWide(context) ? 'till' : 'handheld',
    }) as Map;
    await _pairWith(device);
  });

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Narrow(
              maxWidth: 460,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      const BrandMark(),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text('Floatly Till', style: Theme.of(context).textTheme.titleLarge!.copyWith(fontWeight: FontWeight.w700)),
                            Text('Set up this device', style: TextStyle(color: scheme.onSurfaceVariant)),
                          ],
                        ),
                      ),
                      if (widget.canCancel) IconButton(onPressed: () => Navigator.pop(context), icon: const Icon(Icons.close)),
                    ],
                  ),
                  const SizedBox(height: 24),
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(20),
                      child: AnimatedSize(
                        duration: const Duration(milliseconds: 200),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            ..._stepContent(context),
                            if (_error != null) ...[const SizedBox(height: 12), Text(_error!, style: TextStyle(color: scheme.error))],
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  Text(
                    'An owner or admin signs in once to link this device to a store. After that, staff sign in with the till PIN set for them in the backoffice under Staff.',
                    style: TextStyle(color: scheme.onSurfaceVariant, fontSize: 13),
                    textAlign: TextAlign.center,
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  List<Widget> _stepContent(BuildContext context) {
    final heading = Theme.of(context).textTheme.titleMedium!.copyWith(fontWeight: FontWeight.w600);
    switch (_step) {
      case _Step.signIn:
        return [
          Text('Owner or admin sign-in', style: heading),
          const SizedBox(height: 16),
          TextField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            autofillHints: const [AutofillHints.email],
            decoration: const InputDecoration(labelText: 'Email'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: _password,
            obscureText: true,
            autofillHints: const [AutofillHints.password],
            decoration: const InputDecoration(labelText: 'Password'),
            onSubmitted: (_) => _busy ? null : _signIn(),
          ),
          const SizedBox(height: 8),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: () => setState(() => _showServer = !_showServer),
              icon: Icon(_showServer ? Icons.expand_less : Icons.dns_outlined, size: 18),
              label: const Text('Server'),
            ),
          ),
          if (_showServer) ...[
            TextField(
              controller: _server,
              keyboardType: TextInputType.url,
              decoration: const InputDecoration(
                labelText: 'Floatly server address',
                helperText: 'Only change this if your business runs its own Floatly server.',
              ),
            ),
            const SizedBox(height: 12),
          ],
          const SizedBox(height: 8),
          FilledButton(onPressed: _busy ? null : _signIn, child: _busy ? const _Spinner() : const Text('Continue')),
        ];
      case _Step.business:
        return [
          Text('Which business is this till for?', style: heading),
          const SizedBox(height: 8),
          for (final b in _businesses)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.storefront_outlined),
              title: Text(b['name'] as String),
              trailing: const Icon(Icons.chevron_right),
              onTap: _busy ? null : () => _run(() => _chooseBusiness(b)),
            ),
        ];
      case _Step.store:
        return [
          Text('Which store is this till in?', style: heading),
          Text(_businessName),
          const SizedBox(height: 8),
          for (final s in _stores)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.store_mall_directory_outlined),
              title: Text(s['name'] as String),
              subtitle: Text(s['code'] as String),
              trailing: const Icon(Icons.chevron_right),
              onTap: _busy ? null : () => _run(() => _chooseStore(s)),
            ),
        ];
      case _Step.device:
        return [
          Text('Which till is this?', style: heading),
          Text('$_businessName · ${_store!['name']}'),
          const SizedBox(height: 8),
          for (final d in _devices)
            ListTile(
              contentPadding: EdgeInsets.zero,
              leading: const Icon(Icons.point_of_sale),
              title: Text('${d['name']}'),
              subtitle: Text(d['registered'] == true ? '${d['code']} · set up on another device' : '${d['code']} · not set up yet'),
              trailing: const Icon(Icons.chevron_right),
              onTap: _busy ? null : () => _pairWith(d),
            ),
          if (_devices.isNotEmpty) const Divider(height: 24),
          Text('Add a new till', style: Theme.of(context).textTheme.labelLarge),
          const SizedBox(height: 10),
          Row(
            children: [
              Expanded(
                flex: 3,
                child: TextField(
                  controller: _newName,
                  decoration: const InputDecoration(labelText: 'Name'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                flex: 2,
                child: TextField(
                  controller: _newCode,
                  textCapitalization: TextCapitalization.characters,
                  maxLength: 6,
                  decoration: const InputDecoration(labelText: 'Code', counterText: '', helperText: 'On receipts'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          FilledButton.icon(
            onPressed: _busy ? null : _addDevice,
            icon: _busy ? const _Spinner() : const Icon(Icons.add),
            label: const Text('Add and use this till'),
          ),
          TextButton(onPressed: _busy ? null : () => setState(() => _step = _stores.length > 1 ? _Step.store : _Step.signIn), child: const Text('Back')),
        ];
    }
  }
}

class _Spinner extends StatelessWidget {
  const _Spinner();

  @override
  Widget build(BuildContext context) => const SizedBox.square(dimension: 20, child: CircularProgressIndicator(strokeWidth: 2.4, color: Brand.ledgerSoft));
}
