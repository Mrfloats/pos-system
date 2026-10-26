import 'dart:io';

import 'package:path_provider/path_provider.dart';

import 'local_store.dart';

LocalStore createStore() => _FileStore();

/// One file per key in the app's private folder.
class _FileStore extends LocalStore {
  Directory? _dir;

  Future<File> _file(String key) async {
    _dir ??= await Directory('${(await getApplicationSupportDirectory()).path}${Platform.pathSeparator}till').create(recursive: true);
    return File('${_dir!.path}${Platform.pathSeparator}$key.json');
  }

  @override
  Future<String?> read(String key) async {
    final f = await _file(key);
    try {
      return await f.exists() ? await f.readAsString() : null;
    } on FileSystemException {
      return null;
    }
  }

  /// Writes a temporary file first, then swaps it in, so a power cut never leaves half a file.
  @override
  Future<void> write(String key, String value) async {
    final f = await _file(key);
    final tmp = File('${f.path}.tmp');
    await tmp.writeAsString(value, flush: true);
    try {
      await tmp.rename(f.path);
    } on FileSystemException {
      if (await f.exists()) await f.delete();
      await tmp.rename(f.path);
    }
  }

  @override
  Future<void> delete(String key) async {
    final f = await _file(key);
    if (await f.exists()) await f.delete();
  }
}
