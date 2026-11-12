/// Talks to ZIMRA's Fiscal Device Gateway API (FDMS v7.2). Every call except
/// registration uses the till's own certificate (mutual TLS); the HTTP part is
/// behind [FdmsTransport] so tests can stand in for ZIMRA.
library;

import 'fdms.dart';
import 'fdms_transport_io.dart' if (dart.library.js_interop) 'fdms_transport_web.dart' as platform;

/// Which ZIMRA server: the test one for trying things out, the live one for real sales.
enum FdmsEnvironment {
  test('https://fdmsapitest.zimra.co.zw', 'Test'),
  live('https://fdmsapi.zimra.co.zw', 'Live');

  const FdmsEnvironment(this.url, this.label);
  final String url, label;

  static FdmsEnvironment parse(String? s) => values.firstWhere((v) => v.name == s, orElse: () => test);
}

/// What ZIMRA (or the connection) said went wrong.
class FdmsException implements Exception {
  FdmsException(this.status, this.message, {this.code});

  /// HTTP status; 0 when ZIMRA couldn't be reached.
  final int status;

  /// ZIMRA's error code (DEV01, RCPT01, FISC01…), when it gave one.
  final String? code;
  final String message;

  bool get isOffline => status == 0;

  /// Worth trying again later: no connection, or ZIMRA's side had trouble.
  bool get retryable => status == 0 || status >= 500 || status == 429;

  @override
  String toString() => code == null ? message : '$message ($code)';
}

/// One HTTP exchange with ZIMRA.
abstract class FdmsTransport {
  /// Whether this device can reach ZIMRA at all (browsers can't use a client certificate).
  bool get supported => true;

  /// Sends [body] as JSON. [certificate] and [privateKey] (PEM) are the device's
  /// TLS client credentials; null for ZIMRA's public endpoints. Returns the HTTP
  /// status and the decoded JSON body. Throws [FdmsException] with status 0 when
  /// ZIMRA can't be reached.
  Future<(int, Object?)> send(String method, Uri url, {required Map<String, String> headers, Object? body, String? certificate, String? privateKey});

  static FdmsTransport platformDefault() => platform.createTransport();
}

/// The device's settings from getConfig, kept for printing and checks.
class FdmsConfig {
  FdmsConfig({
    required this.taxpayerName,
    required this.taxpayerTin,
    required this.vatNumber,
    required this.serialNo,
    required this.branchName,
    required this.branchAddress,
    required this.branchPhone,
    required this.branchEmail,
    required this.operatingMode,
    required this.dayMaxHours,
    required this.dayEndNotificationHours,
    required this.taxes,
    required this.certificateValidTill,
    required this.qrUrl,
  });

  factory FdmsConfig.fromJson(Map<String, dynamic> j) {
    final a = (j['deviceBranchAddress'] as Map?)?.cast<String, dynamic>() ?? const {};
    final c = (j['deviceBranchContacts'] as Map?)?.cast<String, dynamic>() ?? const {};
    String? s(Object? v) => v is String && v.trim().isNotEmpty ? v.trim() : null;
    final address = [s(a['houseNo']), s(a['street']), s(a['district']), s(a['city']), s(a['province'])].whereType<String>().join(', ');
    return FdmsConfig(
      taxpayerName: j['taxPayerName'] as String? ?? '',
      taxpayerTin: j['taxPayerTIN'] as String? ?? '',
      vatNumber: s(j['vatNumber']),
      serialNo: j['deviceSerialNo'] as String? ?? '',
      branchName: j['deviceBranchName'] as String? ?? '',
      branchAddress: address.isEmpty ? (j['branchAddress'] as String? ?? '') : address,
      branchPhone: s(c['phoneNo']) ?? s(j['branchPhone']),
      branchEmail: s(c['email']) ?? s(j['branchEmail']),
      operatingMode: j['deviceOperatingMode'] as String? ?? 'Online',
      dayMaxHours: j['taxPayerDayMaxHrs'] as int? ?? 24,
      dayEndNotificationHours: j['taxpayerDayEndNotificationHrs'] as int? ?? 2,
      taxes: [for (final t in j['applicableTaxes'] as List? ?? const []) FdmsTax.fromJson((t as Map).cast())],
      certificateValidTill: j['certificateValidTill'] == null ? null : parseFdmsDateTime(j['certificateValidTill'] as String),
      qrUrl: j['qrUrl'] as String? ?? '',
    );
  }

  final String taxpayerName, taxpayerTin, serialNo, branchName, branchAddress, operatingMode, qrUrl;
  final String? vatNumber, branchPhone, branchEmail;

  /// A fiscal day may last this long; the till warns this many hours before.
  final int dayMaxHours, dayEndNotificationHours;
  final List<FdmsTax> taxes;
  final DateTime? certificateValidTill;

  bool get vatPayer => vatNumber != null;
  bool get online => operatingMode == 'Online';

  /// For keeping on the till (getConfig's own field names, so [FdmsConfig.fromJson] reads it back).
  Map<String, dynamic> toJson() => {
    'taxPayerName': taxpayerName,
    'taxPayerTIN': taxpayerTin,
    'vatNumber': vatNumber,
    'deviceSerialNo': serialNo,
    'deviceBranchName': branchName,
    'branchAddress': branchAddress,
    'branchPhone': branchPhone,
    'branchEmail': branchEmail,
    'deviceOperatingMode': operatingMode,
    'taxPayerDayMaxHrs': dayMaxHours,
    'taxpayerDayEndNotificationHrs': dayEndNotificationHours,
    'applicableTaxes': [for (final t in taxes) t.toJson()],
    if (certificateValidTill != null) 'certificateValidTill': fdmsDateTime(certificateValidTill!),
    'qrUrl': qrUrl,
  };
}

/// ZIMRA's answer to getStatus.
class FdmsStatus {
  FdmsStatus.fromJson(Map<String, dynamic> j)
    : dayStatus = j['fiscalDayStatus'] as String? ?? 'FiscalDayClosed',
      lastDayNo = j['lastFiscalDayNo'] as int?,
      lastGlobalNo = j['lastReceiptGlobalNo'] as int?,
      closingError = j['fiscalDayClosingErrorCode'] as String?;

  /// FiscalDayClosed, FiscalDayOpened, FiscalDayCloseInitiated or FiscalDayCloseFailed.
  final String dayStatus;
  final int? lastDayNo, lastGlobalNo;
  final String? closingError;
}

/// ZIMRA's answer to submitReceipt.
class FdmsSubmitted {
  FdmsSubmitted.fromJson(Map<String, dynamic> j)
    : receiptId = j['receiptID'] as int,
      serverDate = j['serverDate'] as String?,
      errors = [
        for (final e in j['validationErrors'] as List? ?? const [])
          (
            code: (e as Map)['validationErrorCode'] as String? ?? '',
            color: e['validationErrorColor'] as String? ?? '',
            description: e['validationErrorDescription'] as String? ?? '',
          ),
      ];

  final int receiptId;
  final String? serverDate;
  final List<({String code, String color, String description})> errors;

  /// Red errors mean ZIMRA won't let the day close until they're sorted out.
  bool get red => errors.any((e) => e.color.toLowerCase() == 'red');
}

class FdmsClient {
  FdmsClient({
    required this.environment,
    required this.deviceId,
    required this.modelName,
    required this.modelVersion,
    required this.transport,
    this.certificate,
    this.privateKey,
  });

  final FdmsEnvironment environment;
  final int deviceId;

  /// The device model and version as registered with ZIMRA (sent with every call).
  final String modelName, modelVersion;
  final FdmsTransport transport;
  final String? certificate, privateKey;

  Future<Object?> _call(String method, String path, {Object? body, bool public = false}) async {
    if (!public && (certificate == null || privateKey == null)) throw FdmsException(401, 'This till has no ZIMRA certificate. Register it first.');
    final (status, json) = await transport.send(
      method,
      Uri.parse('${environment.url}$path'),
      headers: {'DeviceModelName': modelName, 'DeviceModelVersion': modelVersion},
      body: body,
      certificate: public ? null : certificate,
      privateKey: public ? null : privateKey,
    );
    if (status >= 200 && status < 300) return json;
    final problem = json is Map ? json.cast<String, dynamic>() : const <String, dynamic>{};
    final code = problem['errorCode'] as String?;
    final text = (problem['detail'] ?? problem['title']) as String?;
    throw FdmsException(status, _explain(status, code, text), code: code);
  }

  /// Plain words for ZIMRA's commonest refusals.
  static String _explain(int status, String? code, String? text) {
    switch (code) {
      case 'DEV01':
        return "ZIMRA doesn't know this device or it isn't active. Check the device ID with ZIMRA.";
      case 'DEV02':
        return 'The activation key is wrong.';
      case 'DEV03':
        return 'ZIMRA refused the certificate request. Check the serial number.';
      case 'DEV04':
        return 'ZIMRA has blocked this device model.';
      case 'DEV05':
        return 'ZIMRA says the taxpayer is not active.';
      case 'DEV06':
        return "ZIMRA doesn't know this device model and version. Check them with ZIMRA or your supplier.";
    }
    if (status == 401) return "ZIMRA didn't accept this till's certificate. It may have expired: renew it, or register the till again.";
    return text ?? 'ZIMRA answered with an error ($status).';
  }

  String get _device => '/Device/v1/$deviceId';

  /// Who ZIMRA says the device belongs to, before registering it.
  Future<Map<String, dynamic>> verifyTaxpayer({required String activationKey, required String serialNo}) async =>
      ((await _call('POST', '/Public/v1/$deviceId/VerifyTaxpayerInformation', body: {'activationKey': activationKey, 'deviceSerialNo': serialNo}, public: true)) as Map)
          .cast();

  /// Registers the device and returns its certificate (PEM).
  Future<String> registerDevice({required String activationKey, required String csr}) async =>
      ((await _call('POST', '/Public/v1/$deviceId/RegisterDevice', body: {'certificateRequest': csr, 'activationKey': activationKey}, public: true)) as Map)['certificate']
          as String;

  /// A new certificate before the current one runs out.
  Future<String> issueCertificate(String csr) async => ((await _call('POST', '$_device/IssueCertificate', body: {'certificateRequest': csr})) as Map)['certificate'] as String;

  Future<FdmsConfig> getConfig() async => FdmsConfig.fromJson(((await _call('GET', '$_device/GetConfig')) as Map).cast());

  Future<FdmsStatus> getStatus() async => FdmsStatus.fromJson(((await _call('GET', '$_device/GetStatus')) as Map).cast());

  /// Opens fiscal day [dayNo] (opened at [opened], the till's time). Returns the day's number.
  Future<int> openDay({required int dayNo, required DateTime opened}) async =>
      ((await _call('POST', '$_device/OpenDay', body: {'fiscalDayNo': dayNo, 'fiscalDayOpened': fdmsDateTime(opened)})) as Map)['fiscalDayNo'] as int;

  Future<FdmsSubmitted> submitReceipt(FdmsReceipt receipt) async =>
      FdmsSubmitted.fromJson(((await _call('POST', '$_device/SubmitReceipt', body: {'receipt': receipt.toJson()})) as Map).cast());

  /// Asks ZIMRA to close the day; ZIMRA checks the totals afterwards (see [getStatus]).
  Future<void> closeDay({required int dayNo, required List<FdmsCounter> counters, required SignatureData signature, required int receiptCounter}) async {
    await _call(
      'POST',
      '$_device/CloseDay',
      body: {
        'fiscalDayNo': dayNo,
        'fiscalDayCounters': [for (final c in counters) c.toJson()],
        'fiscalDayDeviceSignature': signature.toJson(),
        'receiptCounter': receiptCounter,
      },
    );
  }

  /// Tells ZIMRA the device is on. Returns how often (minutes) ZIMRA wants to hear it.
  Future<int> ping() async => ((await _call('POST', '$_device/Ping')) as Map)['reportingFrequency'] as int? ?? 5;
}
