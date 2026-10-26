import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

import 'local_store_io.dart' if (dart.library.js_interop) 'local_store_web.dart' as platform;

/// What the till keeps on the device: its pairing, the product catalog, sales
/// waiting to upload and recent receipts. Files on phones, tablets and
/// desktops; browser storage on the web. Secrets go to the system keychain.
abstract class LocalStore {
  static LocalStore create() => platform.createStore();

  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> delete(String key);

  Future<Object?> readJson(String key) async {
    final s = await read(key);
    if (s == null) return null;
    try {
      return jsonDecode(s);
    } on FormatException {
      return null;
    }
  }

  Future<void> writeJson(String key, Object? value) => write(key, jsonEncode(value));

  static const _secure = FlutterSecureStorage();

  Future<String?> readSecret(String key) => _secure.read(key: key);
  Future<void> writeSecret(String key, String value) => _secure.write(key: key, value: value);
  Future<void> deleteSecret(String key) => _secure.delete(key: key);
}

/// Keeps everything in memory. For tests.
class MemoryStore extends LocalStore {
  final values = <String, String>{};
  final secrets = <String, String>{};

  @override
  Future<String?> read(String key) async => values[key];
  @override
  Future<void> write(String key, String value) async => values[key] = value;
  @override
  Future<void> delete(String key) async => values.remove(key);
  @override
  Future<String?> readSecret(String key) async => secrets[key];
  @override
  Future<void> writeSecret(String key, String value) async => secrets[key] = value;
  @override
  Future<void> deleteSecret(String key) async => secrets.remove(key);
}
