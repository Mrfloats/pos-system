import 'dart:convert';
import 'dart:typed_data';

import 'package:basic_utils/basic_utils.dart' show CryptoUtils, X509Utils;
import 'package:floatly_till/core/money.dart';
import 'package:floatly_till/fiscal/fdms.dart';
import 'package:floatly_till/fiscal/fdms_client.dart';
import 'package:floatly_till/fiscal/fdms_keys.dart';
import 'package:pointycastle/asn1.dart';
import 'package:pointycastle/export.dart';

/// ZIMRA's Fiscal Device Gateway, in memory, checking what a real one checks:
/// the certificate, day opening, receipt numbering, the hash chain and each
/// signature, totals and taxes, and the day's totals and signature at close.
class FakeFdms extends FdmsTransport {
  FakeFdms({this.deviceId = 321, this.activationKey = 'ABC12345', this.serialNo = 'FLT-0001', this.vatNumber = '220012345', this.lastGlobalNo, this.lastDayNo});

  final int deviceId;
  final String activationKey, serialNo;
  String? vatNumber;

  /// When ZIMRA's certificate for the device runs out.
  DateTime certificateValidTill = DateTime(2027, 11, 1);

  bool offline = false;
  final calls = <String>[];

  /// Answer the next call to this path (e.g. "SubmitReceipt") with this status and body.
  final failNext = <String, (int, Object?)>{};

  ECPublicKey? _publicKey;
  String? certificate;
  int _certNo = 0;

  String dayStatus = 'FiscalDayClosed';
  int? lastDayNo;
  int? lastGlobalNo;
  String? closingError;
  DateTime? _dayOpened;
  String? _lastHash;
  DateTime? _lastDate;
  int _receiptId = 9000;

  /// Receipts accepted in the open day, as sent.
  final receipts = <Map<String, dynamic>>[];

  /// Validation errors given for each receipt, by invoice number.
  final errorsFor = <String, List<String>>{};

  static const taxes = [
    {'taxID': 1, 'taxName': 'Exempt', 'validFrom': '2023-01-01T00:00:00'},
    {'taxID': 2, 'taxPercent': 0.0, 'taxName': 'Zero rated 0%', 'validFrom': '2023-01-01T00:00:00'},
    {'taxID': 517, 'taxPercent': 15.5, 'taxName': 'Standard rated 15.5%', 'validFrom': '2025-01-01T00:00:00'},
  ];

  @override
  Future<(int, Object?)> send(String method, Uri url, {required Map<String, String> headers, Object? body, String? certificate, String? privateKey}) async {
    if (offline) throw FdmsException(0, "Can't reach ZIMRA. Check the internet connection.");
    final name = url.pathSegments.last;
    calls.add(name);
    if (headers['DeviceModelName'] == null || headers['DeviceModelVersion'] == null) return (400, {'title': 'Missing device model headers'});
    final fail = failNext.remove(name);
    if (fail != null) return fail;
    final b = (body as Map?)?.cast<String, dynamic>() ?? const <String, dynamic>{};
    final segments = url.pathSegments;
    if (segments.first == 'Public') {
      if (int.parse(segments[2]) != deviceId) return _problem(422, 'DEV01', 'Device not found');
      if ((b['activationKey'] as String).toUpperCase() != activationKey) return _problem(422, 'DEV02', 'Activation key is incorrect');
      if (name == 'VerifyTaxpayerInformation') {
        return (200, {'operationID': 'op', 'taxPayerName': 'Fiscal Shop (Pvt) Ltd', 'taxPayerTIN': '2000123456', 'vatNumber': vatNumber, 'deviceBranchName': 'Main branch'});
      }
      return _issue(b['certificateRequest'] as String);
    }
    if (certificate == null || certificate != this.certificate) return (401, {'title': 'Unauthorized'});
    switch (name) {
      case 'GetConfig':
        return (200, {
          'operationID': 'op',
          'taxPayerName': 'Fiscal Shop (Pvt) Ltd',
          'taxPayerTIN': '2000123456',
          'vatNumber': vatNumber,
          'deviceSerialNo': serialNo,
          'deviceBranchName': 'Main branch',
          'deviceBranchAddress': {'houseNo': '12', 'street': 'Samora Machel Ave', 'city': 'Harare', 'province': 'Harare'},
          'deviceBranchContacts': {'phoneNo': '0242 000000', 'email': 'shop@example.com'},
          'deviceOperatingMode': 'Online',
          'taxPayerDayMaxHrs': 24,
          'taxpayerDayEndNotificationHrs': 2,
          'applicableTaxes': taxes,
          'certificateValidTill': fdmsDateTime(certificateValidTill),
          'qrUrl': 'https://fdmstest.zimra.co.zw',
        });
      case 'GetStatus':
        return (200, {
          'operationID': 'op',
          'fiscalDayStatus': dayStatus,
          'lastFiscalDayNo': ?lastDayNo,
          'lastReceiptGlobalNo': ?lastGlobalNo,
          'fiscalDayClosingErrorCode': ?closingError,
        });
      case 'OpenDay':
        if (dayStatus != 'FiscalDayClosed') return _problem(422, 'FISC01', 'Open day is not allowed');
        final no = b['fiscalDayNo'] as int;
        if (no != (lastDayNo ?? 0) + 1) return _problem(422, 'FISC01', 'Wrong fiscal day number');
        dayStatus = 'FiscalDayOpened';
        lastDayNo = no;
        _dayOpened = parseFdmsDateTime(b['fiscalDayOpened'] as String);
        _lastHash = null;
        _lastDate = null;
        receipts.clear();
        return (200, {'operationID': 'op', 'fiscalDayNo': no});
      case 'SubmitReceipt':
        if (dayStatus != 'FiscalDayOpened' && dayStatus != 'FiscalDayCloseFailed') return _problem(422, 'RCPT01', 'Fiscal day is closed');
        return _submit((b['receipt'] as Map).cast());
      case 'CloseDay':
        if (dayStatus != 'FiscalDayOpened' && dayStatus != 'FiscalDayCloseFailed') return _problem(422, 'FISC04', 'Fiscal day not opened');
        _close(b);
        return (200, {'operationID': 'op'});
      case 'IssueCertificate':
        return _issue(b['certificateRequest'] as String);
      case 'Ping':
        return (200, {'operationID': 'op', 'reportingFrequency': 5});
    }
    return (404, {'title': 'Not found'});
  }

  (int, Object?) _problem(int status, String code, String title) => (status, {'type': 'about:blank', 'title': title, 'status': status, 'errorCode': code});

  (int, Object?) _issue(String csr) {
    final cn = X509Utils.csrFromPem(csr).certificationRequestInfo!.subject!['2.5.4.3'];
    if (cn != fdmsDeviceName(serialNo, deviceId)) return _problem(422, 'DEV03', 'Certificate request is invalid');
    _publicKey = publicKeyOfCsr(csr);
    certificate = '-----BEGIN CERTIFICATE-----\nFAKE${++_certNo}\n-----END CERTIFICATE-----';
    return (200, {'operationID': 'op', 'certificate': certificate});
  }

  (int, Object?) _submit(Map<String, dynamic> json) {
    final r = FdmsReceipt.fromJson(json);
    final errors = <String>[];
    final sig = SignatureData.fromJson((json['receiptDeviceSignature'] as Map).cast());
    final text = r.signingText(deviceId, _lastHash);
    if (fdmsHash(text) != sig.hash || !verifySignature(_publicKey!, text, sig.signature)) errors.add('RCPT020');
    if (r.counter != receipts.length + 1) errors.add('RCPT011');
    if (lastGlobalNo != null && r.globalNo != lastGlobalNo! + 1 && !(r.globalNo == 1 && receipts.isEmpty)) errors.add('RCPT012');
    if (!r.date.isAfter(_dayOpened!)) errors.add('RCPT014');
    if (_lastDate != null && !r.date.isAfter(_lastDate!)) errors.add('RCPT030');
    if (r.total != r.lines.fold(0, (a, l) => a + l.total)) errors.add('RCPT019');
    if (r.total != r.taxes.fold(0, (a, t) => a + t.salesAmountWithTax)) errors.add('RCPT038');
    if (r.total != r.payments.fold(0, (a, p) => a + p.amount)) errors.add('RCPT039');
    for (final t in r.taxes) {
      final sales = r.lines.where((l) => l.tax.id == t.tax.id).fold(0, (a, l) => a + l.total);
      final pct = t.tax.percent ?? 0;
      if (t.salesAmountWithTax != sales || t.taxAmount != (pct == 0 ? 0 : divRound(sales * pct, 10000 + pct))) errors.add('RCPT026');
      if (!taxes.any((x) => x['taxID'] == t.tax.id)) errors.add('RCPT025');
    }
    if (r.type == FdmsReceiptType.creditNote && (r.noteRef == null || (r.notes ?? '').isEmpty)) errors.add('RCPT015');
    if (vatNumber != null && r.lines.any((l) => l.hsCode == null)) errors.add('RCPT047');
    _lastHash = sig.hash;
    _lastDate = r.date;
    lastGlobalNo = r.globalNo;
    receipts.add(json);
    errorsFor[r.invoiceNo] = errors;
    return (200, {
      'operationID': 'op',
      'receiptID': ++_receiptId,
      'serverDate': fdmsDateTime(r.date.add(const Duration(seconds: 2))),
      'receiptServerSignature': {'hash': 'aA==', 'signature': 'aA==', 'certificateThumbprint': 'x'},
      'validationErrors': [for (final e in errors) {'validationErrorCode': e, 'validationErrorColor': 'Red', 'validationErrorDescription': 'Fake check $e failed'}],
    });
  }

  void _close(Map<String, dynamic> b) {
    final sent = [for (final c in b['fiscalDayCounters'] as List) FdmsCounter.fromJson((c as Map).cast())];
    final expected = FdmsDayTotals();
    for (final r in receipts) {
      expected.add(FdmsReceipt.fromJson(r));
    }
    final sig = SignatureData.fromJson((b['fiscalDayDeviceSignature'] as Map).cast());
    final text = fdmsDaySigningText(deviceId: deviceId, dayNo: b['fiscalDayNo'] as int, dayOpened: _dayOpened!, counters: sent);
    if (fdmsHash(text) != sig.hash || !verifySignature(_publicKey!, text, sig.signature)) {
      dayStatus = 'FiscalDayCloseFailed';
      closingError = 'BadCertificateSignature';
    } else if (receipts.any((r) => errorsFor[r['invoiceNo']]!.isNotEmpty)) {
      dayStatus = 'FiscalDayCloseFailed';
      closingError = 'ReceiptsWithValidationErrors';
    } else if (jsonEncode([for (final c in sent) c.toJson()]) != jsonEncode([for (final c in expected.counters) c.toJson()]) ||
        b['receiptCounter'] != receipts.length) {
      dayStatus = 'FiscalDayCloseFailed';
      closingError = 'CountersMismatch';
    } else {
      dayStatus = 'FiscalDayClosed';
      closingError = null;
    }
  }
}

/// The public key in a certificate signing request.
ECPublicKey publicKeyOfCsr(String csr) {
  final der = base64.decode(csr.replaceAll(RegExp(r'-----[^-]+-----'), '').replaceAll(RegExp(r'\s'), ''));
  final info = (ASN1Parser(der).nextObject() as ASN1Sequence).elements![0] as ASN1Sequence;
  return CryptoUtils.ecPublicKeyFromDerBytes((info.elements![2] as ASN1Sequence).encodedBytes!);
}

/// Checks a DER ECDSA signature over [text].
bool verifySignature(ECPublicKey key, String text, String signatureBase64) {
  try {
    final seq = ASN1Parser(base64.decode(signatureBase64)).nextObject() as ASN1Sequence;
    final verifier = Signer('SHA-256/ECDSA')..init(false, PublicKeyParameter<ECPublicKey>(key));
    return verifier.verifySignature(
      Uint8List.fromList(utf8.encode(text)),
      ECSignature((seq.elements![0] as ASN1Integer).integer!, (seq.elements![1] as ASN1Integer).integer!),
    );
  } catch (_) {
    return false;
  }
}
