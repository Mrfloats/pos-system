import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'fdms_client.dart';

FdmsTransport createTransport() => IoFdmsTransport();

/// HTTPS to ZIMRA with the device's certificate as the TLS client certificate.
class IoFdmsTransport extends FdmsTransport {
  /// ZIMRA answers within 30 seconds (spec 7.4).
  static const timeout = Duration(seconds: 30);

  HttpClient? _plain;
  HttpClient? _mtls;
  String? _mtlsFor;

  HttpClient _client(String? certificate, String? privateKey) {
    if (certificate == null || privateKey == null) return _plain ??= HttpClient()..connectionTimeout = timeout;
    final key = '$certificate|$privateKey';
    if (_mtls == null || _mtlsFor != key) {
      _mtls?.close(force: true);
      final context = SecurityContext(withTrustedRoots: true)
        ..useCertificateChainBytes(utf8.encode(certificate))
        ..usePrivateKeyBytes(utf8.encode(privateKey));
      _mtls = HttpClient(context: context)..connectionTimeout = timeout;
      _mtlsFor = key;
    }
    return _mtls!;
  }

  @override
  Future<(int, Object?)> send(String method, Uri url, {required Map<String, String> headers, Object? body, String? certificate, String? privateKey}) async {
    try {
      final req = await _client(certificate, privateKey).openUrl(method, url).timeout(timeout);
      headers.forEach(req.headers.set);
      req.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (body != null) {
        req.headers.contentType = ContentType.json;
        req.add(utf8.encode(jsonEncode(body)));
      }
      final res = await req.close().timeout(timeout);
      final text = await res.transform(utf8.decoder).join().timeout(timeout);
      Object? json;
      if (text.trim().isNotEmpty) {
        try {
          json = jsonDecode(text);
        } on FormatException {
          json = {'title': text.length > 300 ? text.substring(0, 300) : text};
        }
      }
      return (res.statusCode, json);
    } on TlsException catch (e) {
      throw FdmsException(0, "Couldn't make a secure connection to ZIMRA: ${e.message}");
    } on SocketException {
      throw FdmsException(0, "Can't reach ZIMRA. Check the internet connection.");
    } on HttpException {
      throw FdmsException(0, "Can't reach ZIMRA. Check the internet connection.");
    } on TimeoutException {
      throw FdmsException(0, 'ZIMRA took too long to answer.');
    }
  }
}
