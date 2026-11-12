import 'fdms_client.dart';

FdmsTransport createTransport() => _NoTransport();

/// Browsers can't present a TLS client certificate, which every ZIMRA call needs.
class _NoTransport extends FdmsTransport {
  @override
  bool get supported => false;

  @override
  Future<(int, Object?)> send(String method, Uri url, {required Map<String, String> headers, Object? body, String? certificate, String? privateKey}) =>
      throw FdmsException(0, 'ZIMRA fiscalisation needs the Android or Windows Floatly Till app, not the browser.');
}
