/// The till as a ZIMRA fiscal device: its registration, the fiscal day, the
/// running receipt numbers and hash chain, and the queue of signed receipts
/// on their way to ZIMRA. Everything is kept on the till, so it carries on
/// fiscalising with no internet and sends receipts, in order, once it's back.
library;

import 'dart:async';
import 'dart:math';

import 'package:flutter/foundation.dart';

import '../core/local_store.dart';
import '../models/catalog.dart' show TaxRate;
import 'fdms.dart';
import 'fdms_client.dart';
import 'fdms_keys.dart';

/// Why a receipt can't be issued right now, in words for the person at the till.
class FiscalBlocked implements Exception {
  FiscalBlocked(this.message);
  final String message;

  @override
  String toString() => message;
}

enum DayState {
  /// Selling.
  open,

  /// Close sent; ZIMRA is checking the totals.
  closing,

  /// ZIMRA found a problem with the totals; the day stays open until it closes.
  closeFailed,
}

/// The open fiscal day.
class FiscalDay {
  FiscalDay({required this.no, required this.openedAt, this.state = DayState.open, this.openSent = false, this.counter = 0, this.lastHash, this.lastDate, FdmsDayTotals? totals, this.closeError, Map<String, List<int>>? documents})
    : totals = totals ?? FdmsDayTotals(),
      documents = documents ?? {};

  FiscalDay.fromJson(Map<String, dynamic> j)
    : no = j['no'] as int,
      openedAt = parseFdmsDateTime(j['openedAt'] as String),
      state = DayState.values.byName(j['state'] as String? ?? 'open'),
      openSent = j['openSent'] as bool? ?? false,
      counter = j['counter'] as int? ?? 0,
      lastHash = j['lastHash'] as String?,
      lastDate = j['lastDate'] == null ? null : parseFdmsDateTime(j['lastDate'] as String),
      totals = FdmsDayTotals.fromJson(j['totals'] as List? ?? const []),
      closeError = j['closeError'] as String?,
      documents = {for (final e in (j['documents'] as Map? ?? const {}).entries) e.key as String: [for (final v in e.value as List) v as int]};

  final int no;

  /// The till's local time when it was opened.
  final DateTime openedAt;
  DayState state;

  /// ZIMRA has been told the day is open (receipts can't go before that).
  bool openSent;

  /// Receipts issued this day (the last receiptCounter).
  int counter;

  /// Hash of the last receipt, which the next one's signature includes.
  String? lastHash;
  DateTime? lastDate;
  final FdmsDayTotals totals;
  String? closeError;

  /// For the Z report: "FiscalInvoice|USD" → [count, total cents].
  final Map<String, List<int>> documents;

  Map<String, dynamic> toJson() => {
    'no': no,
    'openedAt': fdmsDateTime(openedAt),
    'state': state.name,
    'openSent': openSent,
    'counter': counter,
    'lastHash': lastHash,
    'lastDate': lastDate == null ? null : fdmsDateTime(lastDate!),
    'totals': totals.toJson(),
    'closeError': closeError,
    'documents': documents,
  };
}

/// A signed receipt and where it has got to.
class QueuedReceipt {
  QueuedReceipt({required this.clientId, required this.receipt, required this.dayNo, this.saleId, this.attach = false});

  QueuedReceipt.fromJson(Map<String, dynamic> j)
    : clientId = j['clientId'] as String,
      saleId = j['saleId'] as String?,
      receipt = FdmsReceipt.fromJson((j['receipt'] as Map).cast()),
      dayNo = j['dayNo'] as int,
      attach = j['attach'] as bool? ?? false,
      receiptId = j['receiptId'] as int?,
      serverDate = j['serverDate'] as String?,
      errors = [for (final e in j['errors'] as List? ?? const []) (e as Map).cast<String, String>()],
      refusal = j['refusal'] as String?,
      reported = j['reported'] as bool? ?? false;

  /// The sale's idempotency key on the till.
  final String clientId;

  /// Floatly's sale id, for a refund recorded before its credit note (approved on a phone).
  final String? saleId;
  final FdmsReceipt receipt;
  final int dayNo;

  /// Floatly has the sale without this receipt: send the whole receipt with the result.
  final bool attach;

  /// Set when ZIMRA accepted it.
  int? receiptId;
  String? serverDate;

  /// ZIMRA's validation errors on an accepted receipt (Grey, Yellow or Red).
  List<Map<String, String>> errors = [];

  /// Why ZIMRA refused it outright; it waits for a manager to try again.
  String? refusal;

  /// Floatly has been told the latest about it.
  bool reported = false;

  bool get accepted => receiptId != null;

  /// For Floatly: pending, submitted or failed.
  String get status => refusal != null || errors.any((e) => e['color']?.toLowerCase() == 'red') ? 'failed' : (accepted ? 'submitted' : 'pending');

  Map<String, dynamic> toJson() => {
    'clientId': clientId,
    'saleId': saleId,
    'receipt': receipt.toJson(),
    'dayNo': dayNo,
    'attach': attach,
    'receiptId': receiptId,
    'serverDate': serverDate,
    'errors': errors,
    'refusal': refusal,
    'reported': reported,
  };
}

/// A receipt just issued: what to print and what to tell Floatly.
class IssuedReceipt {
  IssuedReceipt({required this.deviceId, required this.dayNo, required this.receipt, required this.qrCode, required this.verificationCode});

  final int deviceId, dayNo;
  final FdmsReceipt receipt;
  final String qrCode, verificationCode;

  /// The `fiscal` field of POST /sales (and returns), and of POST /till/fiscal-receipts.
  Map<String, dynamic> forFloatly({String status = 'pending'}) => {
    'deviceId': deviceId,
    'fiscalDayNo': dayNo,
    'globalNo': receipt.globalNo,
    'counter': receipt.counter,
    'invoiceNo': receipt.invoiceNo,
    'receiptType': receipt.type.wire,
    'date': fdmsDateTime(receipt.date),
    'qrCode': qrCode,
    'verificationCode': verificationCode,
    'hash': receipt.signature!.hash,
    'signature': receipt.signature!.signature,
    'status': status,
  };
}

/// What a closed day came to, for printing the Z report.
class ZReport {
  ZReport({required this.dayNo, required this.openedAt, required this.closedAt, required this.counters, required this.documents, required this.receipts});

  ZReport.fromJson(Map<String, dynamic> j)
    : dayNo = j['dayNo'] as int,
      openedAt = parseFdmsDateTime(j['openedAt'] as String),
      closedAt = parseFdmsDateTime(j['closedAt'] as String),
      counters = [for (final c in j['counters'] as List) FdmsCounter.fromJson((c as Map).cast())],
      documents = {for (final e in (j['documents'] as Map).entries) e.key as String: [for (final v in e.value as List) v as int]},
      receipts = j['receipts'] as int? ?? 0;

  final int dayNo, receipts;
  final DateTime openedAt, closedAt;
  final List<FdmsCounter> counters;
  final Map<String, List<int>> documents;

  Map<String, dynamic> toJson() => {
    'dayNo': dayNo,
    'openedAt': fdmsDateTime(openedAt),
    'closedAt': fdmsDateTime(closedAt),
    'counters': [for (final c in counters) c.toJson()],
    'documents': documents,
    'receipts': receipts,
  };
}

class FiscalDevice extends ChangeNotifier {
  FiscalDevice({required this.store, FdmsTransport? transport, DateTime Function()? clock, this.pollDelay = const Duration(seconds: 3)})
    : transport = transport ?? FdmsTransport.platformDefault(),
      _clock = clock ?? DateTime.now;

  final LocalStore store;
  final FdmsTransport transport;
  final DateTime Function() _clock;

  /// How long to wait between asking ZIMRA whether a day has closed.
  final Duration pollDelay;

  static const _stateKey = 'fiscal';
  static const _keyKey = 'fiscal_key';
  static const _certKey = 'fiscal_cert';

  /// Device model and version sent to ZIMRA, as registered with ZIMRA.
  static const defaultModelName = 'Server';
  static const defaultModelVersion = 'v1';

  FdmsEnvironment environment = FdmsEnvironment.test;
  int? deviceId;
  String serialNo = '';
  String modelName = defaultModelName;
  String modelVersion = defaultModelVersion;
  FdmsConfig? config;
  DeviceKey? _key;
  String? _keyPem;
  String? _certificate;

  /// The last receiptGlobalNo issued.
  int globalNo = 0;
  int lastClosedDayNo = 0;
  FiscalDay? day;
  List<QueuedReceipt> queue = [];
  ZReport? lastZ;

  /// The last thing that went wrong talking to ZIMRA.
  String? lastError;

  /// Whether ZIMRA could be reached last time.
  bool online = true;

  bool get supported => transport.supported;
  bool get registered => deviceId != null && _key != null && _certificate != null && config != null;

  /// Every sale on this till is fiscalised.
  bool get active => supported && registered;

  int get unsent => queue.where((q) => !q.accepted).length;

  DateTime _now() {
    final t = _clock();
    return DateTime(t.year, t.month, t.day, t.hour, t.minute, t.second);
  }

  FdmsClient get _client => FdmsClient(
    environment: environment,
    deviceId: deviceId!,
    modelName: modelName,
    modelVersion: modelVersion,
    transport: transport,
    certificate: _certificate,
    privateKey: _keyPem,
  );

  // ----- Keeping it on the till ---------------------------------------------------------

  Future<void> load() async {
    final j = await store.readJson(_stateKey);
    _keyPem = await store.readSecret(_keyKey);
    _certificate = await store.readSecret(_certKey);
    _key = _keyPem == null ? null : DeviceKey.fromPem(_keyPem!);
    if (j is Map) {
      final m = j.cast<String, dynamic>();
      environment = FdmsEnvironment.parse(m['environment'] as String?);
      deviceId = m['deviceId'] as int?;
      serialNo = m['serialNo'] as String? ?? '';
      modelName = m['modelName'] as String? ?? defaultModelName;
      modelVersion = m['modelVersion'] as String? ?? defaultModelVersion;
      config = m['config'] == null ? null : FdmsConfig.fromJson((m['config'] as Map).cast());
      globalNo = m['globalNo'] as int? ?? 0;
      lastClosedDayNo = m['lastClosedDayNo'] as int? ?? 0;
      day = m['day'] == null ? null : FiscalDay.fromJson((m['day'] as Map).cast());
      queue = [for (final q in m['queue'] as List? ?? const []) QueuedReceipt.fromJson((q as Map).cast())];
      lastZ = m['lastZ'] == null ? null : ZReport.fromJson((m['lastZ'] as Map).cast());
      lastError = m['lastError'] as String?;
    }
    notifyListeners();
  }

  /// One write for everything that changes together (the store swaps whole files in).
  Future<void> _save() => store.writeJson(_stateKey, {
    'environment': environment.name,
    'deviceId': deviceId,
    'serialNo': serialNo,
    'modelName': modelName,
    'modelVersion': modelVersion,
    'config': config?.toJson(),
    'globalNo': globalNo,
    'lastClosedDayNo': lastClosedDayNo,
    'day': day?.toJson(),
    'queue': [for (final q in queue) q.toJson()],
    'lastZ': lastZ?.toJson(),
    'lastError': lastError,
  });

  // ----- Registering ----------------------------------------------------------------------

  /// Who ZIMRA says this device belongs to, to check before registering.
  Future<Map<String, dynamic>> verify({required FdmsEnvironment environment, required int deviceId, required String activationKey, required String serialNo, String? modelName, String? modelVersion}) =>
      FdmsClient(environment: environment, deviceId: deviceId, modelName: modelName ?? this.modelName, modelVersion: modelVersion ?? this.modelVersion, transport: transport)
          .verifyTaxpayer(activationKey: activationKey.trim(), serialNo: serialNo.trim());

  /// Registers this till with ZIMRA as device [deviceId]: makes its key, gets
  /// its certificate and settings, and carries on ZIMRA's receipt and day numbers.
  Future<void> register({
    required FdmsEnvironment environment,
    required int deviceId,
    required String activationKey,
    required String serialNo,
    String modelName = defaultModelName,
    String modelVersion = defaultModelVersion,
  }) async {
    if (!supported) throw FiscalBlocked('ZIMRA fiscalisation needs the Android or Windows Floatly Till app.');
    if (registered && (unsent > 0 || day != null)) {
      throw FiscalBlocked('Close the fiscal day and send every receipt to ZIMRA before registering this till again.');
    }
    // Everything from ZIMRA first; nothing on the till changes until it has all worked.
    final key = DeviceKey.generate();
    FdmsClient client([String? certificate]) => FdmsClient(
      environment: environment,
      deviceId: deviceId,
      modelName: modelName,
      modelVersion: modelVersion,
      transport: transport,
      certificate: certificate,
      privateKey: certificate == null ? null : key.pem,
    );
    final certificate = await client().registerDevice(activationKey: activationKey.trim(), csr: key.csr(serialNo: serialNo.trim(), deviceId: deviceId));
    final settings = await client(certificate).getConfig();
    final status = await client(certificate).getStatus();

    await store.writeSecret(_keyKey, key.pem);
    await store.writeSecret(_certKey, certificate);
    this.environment = environment;
    this.deviceId = deviceId;
    this.serialNo = serialNo.trim();
    this.modelName = modelName;
    this.modelVersion = modelVersion;
    _key = key;
    _keyPem = key.pem;
    _certificate = certificate;
    config = settings;
    day = null;
    queue = [];
    lastZ = null;
    lastError = null;
    // Carry on ZIMRA's numbering: receipt numbers never repeat, days follow on.
    globalNo = status.lastGlobalNo ?? 0;
    lastClosedDayNo = status.lastDayNo ?? 0;
    if (status.dayStatus != 'FiscalDayClosed') {
      lastError = 'ZIMRA has fiscal day ${status.lastDayNo} still open from before this till was registered. '
          'It must be closed on ZIMRA’s FDMS portal before this till can fiscalise.';
    }
    online = true;
    await _save();
    notifyListeners();
  }

  /// Forgets the registration on this till (ZIMRA keeps the device).
  Future<void> forget() async {
    if (unsent > 0) throw FiscalBlocked('$unsent receipt${unsent == 1 ? " hasn't" : "s haven't"} reached ZIMRA yet.');
    if (day != null && day!.counter > 0) throw FiscalBlocked('Close the fiscal day (Z report) first.');
    await store.deleteSecret(_keyKey);
    await store.deleteSecret(_certKey);
    await store.delete(_stateKey);
    deviceId = null;
    config = null;
    _key = null;
    _keyPem = null;
    _certificate = null;
    day = null;
    queue = [];
    lastZ = null;
    globalNo = 0;
    lastClosedDayNo = 0;
    lastError = null;
    notifyListeners();
  }

  // ----- Keeping in touch with ZIMRA --------------------------------------------------------

  /// Fresh settings and day status from ZIMRA; renews the certificate a month before it runs out.
  Future<void> refresh() async {
    if (!active) return;
    try {
      config = await _client.getConfig();
      await _checkStatus();
      final till = config!.certificateValidTill;
      if (till != null && till.difference(_clock()) < const Duration(days: 30)) {
        _certificate = await _client.issueCertificate(_key!.csr(serialNo: serialNo, deviceId: deviceId!));
        await store.writeSecret(_certKey, _certificate!);
        config = await _client.getConfig();
      }
      online = true;
    } on FdmsException catch (e) {
      online = !e.isOffline;
      if (!e.isOffline) lastError = e.message;
      rethrow;
    } finally {
      await _save();
      notifyListeners();
    }
  }

  /// Asks ZIMRA how the day stands and catches up: a close that went through or failed.
  Future<void> _checkStatus() async {
    final status = await _client.getStatus();
    if (status.lastGlobalNo != null && status.lastGlobalNo! > globalNo) globalNo = status.lastGlobalNo!;
    final d = day;
    if (d != null && status.lastDayNo == d.no) {
      if (status.dayStatus == 'FiscalDayClosed' && d.state != DayState.open) {
        _dayClosed(d);
      } else if (status.dayStatus == 'FiscalDayCloseFailed') {
        d.state = DayState.closeFailed;
        d.closeError = _closeError(status.closingError);
      }
    } else if (d == null && status.dayStatus == 'FiscalDayClosed' && (status.lastDayNo ?? 0) > lastClosedDayNo) {
      lastClosedDayNo = status.lastDayNo!;
    }
  }

  static String _closeError(String? code) => switch (code) {
    'BadCertificateSignature' => 'ZIMRA says the day’s signature is wrong.',
    'MissingReceipts' => 'ZIMRA is missing some of the day’s receipts.',
    'ReceiptsWithValidationErrors' => 'Some of the day’s receipts have errors ZIMRA won’t accept.',
    'CountersMismatch' => 'The day’s totals don’t match the receipts ZIMRA has.',
    _ => 'ZIMRA couldn’t close the day${code == null ? '' : ' ($code)'}.',
  };

  void _dayClosed(FiscalDay d) {
    lastZ = ZReport(dayNo: d.no, openedAt: d.openedAt, closedAt: _now(), counters: d.totals.counters, documents: d.documents, receipts: d.counter);
    lastClosedDayNo = d.no;
    day = null;
  }

  /// Tells ZIMRA the till is on.
  Future<void> ping() async {
    if (!active) return;
    try {
      await _client.ping();
      online = true;
    } on FdmsException catch (e) {
      online = !e.isOffline;
    }
  }

  // ----- The fiscal day ---------------------------------------------------------------------

  /// Hours left before ZIMRA's limit on the day's length; null with no day open.
  Duration? get timeLeft {
    final d = day;
    final c = config;
    if (d == null || c == null) return null;
    return d.openedAt.add(Duration(hours: c.dayMaxHours)).difference(_clock());
  }

  /// A warning for the till when the day must be closed soon (ZIMRA requirement 5).
  String? get dayWarning {
    final left = timeLeft;
    final c = config;
    if (left == null || c == null) return null;
    if (left <= Duration.zero) return 'The fiscal day has reached ZIMRA’s ${c.dayMaxHours}-hour limit. Close it (Z report) to keep selling.';
    if (left <= Duration(hours: c.dayEndNotificationHours)) {
      final h = left.inHours;
      return 'Close the fiscal day (Z report) within ${h >= 1 ? '$h hour${h == 1 ? '' : 's'}' : '${max(1, left.inMinutes)} minutes'}: ZIMRA allows ${c.dayMaxHours} hours.';
    }
    return null;
  }

  /// Opens a new fiscal day on the till (ZIMRA is told when it can be reached).
  Future<FiscalDay> _openDay() async {
    // Fresh settings first when ZIMRA can be reached (requirement 2); fine without.
    try {
      config = await _client.getConfig();
      await _checkStatus();
      online = true;
    } on FdmsException catch (e) {
      online = !e.isOffline;
    }
    final d = FiscalDay(no: lastClosedDayNo + 1, openedAt: _now());
    day = d;
    await _save();
    return d;
  }

  /// ZIMRA's tax for a product's tax rate, or why there isn't one.
  FdmsTax taxFor(TaxRate? rate, {DateTime? on}) {
    final tax = fdmsTaxFor(rate, config!.taxes, on ?? _clock());
    if (tax == null) {
      final what = rate == null ? 'items with no tax' : '${rate.name} (${fdmsPercentText(rate.hundredths)}%)';
      throw FiscalBlocked('ZIMRA has no matching tax for $what. Set the ZIMRA tax ID on the tax rate in the backoffice.');
    }
    if (tax.percent != null && tax.percent! > 0 && !config!.vatPayer) {
      throw FiscalBlocked('ZIMRA says this business isn’t VAT-registered, so it can’t sell items with VAT. Change the tax rates in the backoffice.');
    }
    return tax;
  }

  /// Signs a sale (or a refund, as a credit note) and queues it for ZIMRA. The
  /// receipt is ready to print with its QR code straight away, online or not.
  Future<IssuedReceipt> issue({
    required String clientId,
    required FdmsReceiptType type,
    required String currency,
    required List<FiscalItem> items,
    required List<FiscalPay> payments,
    FdmsBuyer? buyer,
    String? notes,
    FdmsNoteRef? noteRef,
    String? username,
    String? saleId,
    bool attach = false,
  }) async {
    if (!active) throw FiscalBlocked('This till isn’t registered with ZIMRA.');
    final c = config!;
    for (final item in items) {
      final problem = hsCodeProblem(item.hsCode, vatPayer: c.vatPayer, tax: item.tax);
      if (problem != null) throw FiscalBlocked('“${item.name}” $problem for ZIMRA. Set it on the product in the backoffice.');
    }
    if (type != FdmsReceiptType.fiscalInvoice && (notes ?? '').trim().isEmpty) throw FiscalBlocked('A credit note needs a reason.');
    var d = day;
    if (d != null && d.state == DayState.closing) throw FiscalBlocked('ZIMRA is closing the fiscal day. Wait a moment and try again.');
    d ??= await _openDay();
    final left = timeLeft;
    if (left != null && left <= Duration.zero) throw FiscalBlocked(dayWarning!);

    // ZIMRA wants each receipt later than the day's opening and the receipt before it.
    var date = _now();
    final floor = d.lastDate ?? d.openedAt;
    if (!date.isAfter(floor)) date = floor.add(const Duration(seconds: 1));

    final no = globalNo + 1;
    final receipt = buildFdmsReceipt(
      type: type,
      currency: currency,
      items: items,
      payments: payments,
      date: date,
      counter: d.counter + 1,
      globalNo: no,
      invoiceNo: '$deviceId-$no',
      buyer: buyer,
      notes: notes,
      noteRef: noteRef,
      username: username,
    );
    receipt.signature = _key!.sign(receipt.signingText(deviceId!, d.lastHash));

    globalNo = no;
    d
      ..counter += 1
      ..lastHash = receipt.signature!.hash
      ..lastDate = date
      ..totals.add(receipt);
    final doc = d.documents.putIfAbsent('${type.wire}|${receipt.currency}', () => [0, 0]);
    doc[0] += 1;
    doc[1] += receipt.total;
    queue.add(QueuedReceipt(clientId: clientId, saleId: saleId, receipt: receipt, dayNo: d.no, attach: attach));
    await _save();
    notifyListeners();
    final qrData = fdmsQrData(receipt.signature!.signature);
    return IssuedReceipt(
      deviceId: deviceId!,
      dayNo: d.no,
      receipt: receipt,
      qrCode: fdmsQrCode(qrUrl: c.qrUrl, deviceId: deviceId!, date: date, globalNo: no, qrData: qrData),
      verificationCode: fdmsVerificationCode(receipt.signature!.signature),
    );
  }

  Future<void>? _sending;

  /// Sends the day's opening and every waiting receipt to ZIMRA, in order.
  /// Stops at the first one that can't go (offline, or refused: a manager
  /// then tries again). Safe to call any time.
  Future<void> send() => _sending ??= _send().whenComplete(() => _sending = null);

  Future<void> _send() async {
    if (!active) return;
    try {
      final d = day;
      if (d != null && !d.openSent) await _sendOpen(d);
      for (final q in [...queue]..sort((a, b) => a.receipt.globalNo.compareTo(b.receipt.globalNo))) {
        if (q.accepted) continue;
        if (q.refusal != null) break;
        if (q.dayNo == day?.no && day?.openSent == false) break;
        try {
          final res = await _client.submitReceipt(q.receipt);
          q
            ..receiptId = res.receiptId
            ..serverDate = res.serverDate
            ..errors = [for (final e in res.errors) {'code': e.code, 'color': e.color, 'description': e.description}]
            ..reported = false;
          lastError = res.red ? 'ZIMRA found errors on receipt ${q.receipt.invoiceNo}: ${res.errors.map((e) => e.description).join('; ')}' : null;
        } on FdmsException catch (e) {
          if (e.retryable) rethrow;
          q
            ..refusal = e.message
            ..reported = false;
          lastError = 'ZIMRA refused receipt ${q.receipt.invoiceNo}: ${e.message}';
          break;
        } finally {
          await _save();
          notifyListeners();
        }
      }
      online = true;
    } on FdmsException catch (e) {
      online = !e.isOffline;
      if (!e.isOffline) lastError = e.message;
    } finally {
      await _save();
      notifyListeners();
    }
  }

  Future<void> _sendOpen(FiscalDay d) async {
    try {
      await _client.openDay(dayNo: d.no, opened: d.openedAt);
    } on FdmsException catch (e) {
      if (e.retryable) rethrow;
      // Already open there (a reply lost on the way back)? Then carry on.
      final status = await _client.getStatus();
      if (!(status.dayStatus != 'FiscalDayClosed' && status.lastDayNo == d.no)) rethrow;
    }
    d.openSent = true;
    await _save();
  }

  /// Sends a refused receipt again (after the problem was sorted out).
  Future<void> retry(QueuedReceipt q) async {
    q.refusal = null;
    await _save();
    notifyListeners();
    await send();
  }

  /// Closes the fiscal day: sends what's waiting, then the day's totals and
  /// signature. ZIMRA checks them afterwards; the till asks how it went.
  Future<void> closeDay() async {
    final d = day;
    if (d == null) throw FiscalBlocked('No fiscal day is open.');
    if (!active) throw FiscalBlocked('This till isn’t registered with ZIMRA.');
    if (d.state != DayState.closing) {
      await send();
      final waiting = queue.where((q) => q.dayNo == d.no && !q.accepted).length;
      if (!d.openSent || waiting > 0) {
        throw FiscalBlocked(
          waiting > 0
              ? '$waiting receipt${waiting == 1 ? " hasn't" : "s haven't"} reached ZIMRA yet${online ? '' : ': connect to the internet'}. The day can close once ${waiting == 1 ? 'it has' : 'they have'}.'
              : 'ZIMRA hasn’t been told this day opened yet${online ? '' : ': connect to the internet'}.',
        );
      }
      final counters = d.totals.counters;
      final signature = _key!.sign(fdmsDaySigningText(deviceId: deviceId!, dayNo: d.no, dayOpened: d.openedAt, counters: counters));
      try {
        await _client.closeDay(dayNo: d.no, counters: counters, signature: signature, receiptCounter: d.counter);
        online = true;
      } on FdmsException catch (e) {
        online = !e.isOffline;
        lastError = e.message;
        await _save();
        notifyListeners();
        rethrow;
      }
      d
        ..state = DayState.closing
        ..closeError = null;
      lastError = null;
      await _save();
      notifyListeners();
    }
    // ZIMRA checks the totals in the background: ask a few times.
    for (var i = 0; i < 5 && day?.state == DayState.closing; i++) {
      await Future<void>.delayed(pollDelay);
      try {
        await _checkStatus();
      } on FdmsException catch (e) {
        if (!e.retryable) rethrow;
      }
    }
    await _save();
    notifyListeners();
    final after = day;
    if (after != null && after.state == DayState.closeFailed) throw FiscalBlocked(after.closeError ?? 'ZIMRA couldn’t close the day.');
  }

  // ----- Telling Floatly --------------------------------------------------------------------

  /// Receipts Floatly hasn't heard the latest about.
  List<QueuedReceipt> get unreported => queue.where((q) => !q.reported && (q.accepted || q.refusal != null || q.attach)).toList();

  /// Body items for POST /till/fiscal-receipts.
  List<Map<String, dynamic>> reportBody(Iterable<QueuedReceipt> items) => [
    for (final q in items)
      {
        if (q.saleId != null) 'saleId': q.saleId else 'clientId': q.clientId,
        'status': q.status,
        'receiptId': ?q.receiptId,
        'serverDate': ?q.serverDate,
        if (q.errors.isNotEmpty || q.refusal != null)
          'errors': [
            ...q.errors,
            if (q.refusal != null) {'code': 'REFUSED', 'color': 'Red', 'description': q.refusal!},
          ],
        if (q.attach) 'receipt': _issued(q).forFloatly(),
      },
  ];

  IssuedReceipt _issued(QueuedReceipt q) => IssuedReceipt(
    deviceId: deviceId!,
    dayNo: q.dayNo,
    receipt: q.receipt,
    qrCode: fdmsQrCode(qrUrl: config?.qrUrl ?? '', deviceId: deviceId!, date: q.receipt.date, globalNo: q.receipt.globalNo, qrData: fdmsQrData(q.receipt.signature!.signature)),
    verificationCode: fdmsVerificationCode(q.receipt.signature!.signature),
  );

  /// Floatly took these (by clientId or saleId): accepted ones leave the queue.
  Future<void> markReported(Iterable<String> keys) async {
    final done = keys.toSet();
    for (final q in queue) {
      if (done.contains(q.saleId ?? q.clientId)) q.reported = true;
    }
    queue.removeWhere((q) => q.reported && q.accepted);
    await _save();
    notifyListeners();
  }

  /// The latest status of a sale's receipt, to send along when the sale uploads.
  QueuedReceipt? queuedFor(String clientId) => queue.where((q) => q.clientId == clientId).firstOrNull;

  /// For PUT /till/fiscal-device.
  Map<String, dynamic> statusForFloatly() => {
    'fiscalDeviceId': deviceId,
    'serialNo': serialNo,
    'state': {
      'environment': environment.name,
      'taxpayerName': config?.taxpayerName,
      'taxpayerTin': config?.taxpayerTin,
      'vatNumber': config?.vatNumber,
      'branchName': config?.branchName,
      'dayStatus': switch (day?.state) {
        null => 'FiscalDayClosed',
        DayState.open => 'FiscalDayOpened',
        DayState.closing => 'FiscalDayCloseInitiated',
        DayState.closeFailed => 'FiscalDayCloseFailed',
      },
      'dayNo': day?.no ?? lastClosedDayNo,
      'dayOpenedAt': day?.openedAt.toUtc().toIso8601String(),
      'unsent': unsent,
      'lastGlobalNo': globalNo,
      'certificateValidTill': config?.certificateValidTill?.toUtc().toIso8601String(),
      'lastError': lastError,
    },
  };
}
