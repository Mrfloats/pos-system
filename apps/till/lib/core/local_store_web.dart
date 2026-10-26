import 'package:shared_preferences/shared_preferences.dart';

import 'local_store.dart';

LocalStore createStore() => _BrowserStore();

/// The browser's local storage.
class _BrowserStore extends LocalStore {
  final _prefs = SharedPreferencesAsync();

  @override
  Future<String?> read(String key) => _prefs.getString('till.$key');
  @override
  Future<void> write(String key, String value) => _prefs.setString('till.$key', value);
  @override
  Future<void> delete(String key) => _prefs.remove('till.$key');
}
