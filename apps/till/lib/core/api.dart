import 'dart:async';
import 'dart:convert';

import 'package:http/http.dart' as http;

/// Something the API refused, or couldn't be reached ([status] 0).
class ApiException implements Exception {
  ApiException(this.status, this.message, {this.code});

  final int status;
  final String message;
  final String? code;

  /// No answer at all: no internet, server down or timed out.
  bool get isOffline => status == 0;

  @override
  String toString() => message;
}

/// Talks to the Floatly API, the same one the backoffice uses.
class Api {
  Api({required String server, this.token}) : base = apiBase(server);

  final String base;
  final String? token;

  static final _client = http.Client();

  /// What people type ("floatly-api.vercel.app") → the API's address ("https://floatly-api.vercel.app/api/v1").
  static String apiBase(String server) {
    var s = server.trim();
    if (!s.contains('://')) s = 'https://$s';
    s = s.replaceFirst(RegExp(r'/+$'), '');
    s = s.replaceFirst(RegExp(r'/api/v1$'), '');
    return '$s/api/v1';
  }

  Future<dynamic> get(String path, {Map<String, String>? query, Duration timeout = const Duration(seconds: 20)}) =>
      _send('GET', path, query: query, timeout: timeout);

  Future<dynamic> post(String path, [Object? body, Duration timeout = const Duration(seconds: 20)]) =>
      _send('POST', path, body: body ?? const {}, timeout: timeout);

  Future<dynamic> patch(String path, Object body) => _send('PATCH', path, body: body, timeout: const Duration(seconds: 20));

  Future<dynamic> _send(String method, String path, {Map<String, String>? query, Object? body, required Duration timeout}) async {
    var uri = Uri.parse('$base$path');
    if (query != null) uri = uri.replace(queryParameters: query);
    final request = http.Request(method, uri)
      ..headers['Accept'] = 'application/json'
      ..headers['Content-Type'] = 'application/json';
    if (token != null) request.headers['Authorization'] = 'Bearer $token';
    if (body != null) request.body = jsonEncode(body);

    final http.Response res;
    try {
      res = await http.Response.fromStream(await _client.send(request).timeout(timeout));
    } on TimeoutException {
      throw ApiException(0, "Floatly took too long to answer. Check the internet connection.");
    } catch (_) {
      throw ApiException(0, "Can't reach Floatly. Check the internet connection.");
    }

    final text = res.body;
    Object? data;
    if (text.isNotEmpty) {
      try {
        data = jsonDecode(text);
      } on FormatException {
        data = null;
      }
    }
    if (res.statusCode >= 200 && res.statusCode < 300) return data;
    throw ApiException(res.statusCode, _message(res.statusCode, data), code: data is Map ? data['code'] as String? : null);
  }

  static String _message(int status, Object? data) {
    if (data is Map) {
      final m = data['message'];
      if (m is String && m.isNotEmpty) return m;
      if (m is List && m.isNotEmpty) return m.join('. ');
    }
    return switch (status) {
      401 => 'Your session has ended. Sign in again.',
      403 => "Your role can't do this.",
      404 => 'Not found.',
      429 => 'Too many attempts. Wait a minute and try again.',
      >= 500 => 'Floatly had a problem. Try again in a moment.',
      _ => 'Something went wrong ($status).',
    };
  }
}
