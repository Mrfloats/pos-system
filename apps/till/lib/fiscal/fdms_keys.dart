/// A till's own ZIMRA key: ECDSA on P-256, ZIMRA's first choice (spec 4.2).
/// The key is made on the till and never leaves it; ZIMRA only sees the
/// certificate request and the signatures.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:basic_utils/basic_utils.dart' show CryptoUtils, X509Utils;
import 'package:pointycastle/asn1.dart';
import 'package:pointycastle/export.dart';

import 'fdms.dart';

/// The name ZIMRA gives a device, which must be the certificate request's
/// subject: `ZIMRA-serialNo-deviceID`, the device ID padded to 10 digits.
String fdmsDeviceName(String serialNo, int deviceId) => 'ZIMRA-$serialNo-${deviceId.toString().padLeft(10, '0')}';

class DeviceKey {
  DeviceKey._(this._private, this._public);

  /// A new random key.
  factory DeviceKey.generate() {
    final pair = CryptoUtils.generateEcKeyPair(curve: 'prime256v1');
    return DeviceKey._(pair.privateKey as ECPrivateKey, pair.publicKey as ECPublicKey);
  }

  /// A key kept as PEM ("-----BEGIN EC PRIVATE KEY-----").
  factory DeviceKey.fromPem(String pem) {
    final private = CryptoUtils.ecPrivateKeyFromPem(pem);
    return DeviceKey._(private, ECPublicKey(private.parameters!.G * private.d!, private.parameters));
  }

  final ECPrivateKey _private;
  final ECPublicKey _public;

  /// For keeping in secure storage, and for the TLS connection to ZIMRA.
  String get pem => CryptoUtils.encodeEcPrivateKeyToPem(_private);

  /// The certificate signing request for registerDevice and issueCertificate.
  String csr({required String serialNo, required int deviceId}) =>
      X509Utils.generateEccCsrPem({'CN': fdmsDeviceName(serialNo, deviceId)}, _private, _public);

  /// Signs [text] for ZIMRA: SHA-256 hash, and an ECDSA signature over the
  /// text (deterministic, RFC 6979), DER-encoded as FDMS expects.
  SignatureData sign(String text) {
    final signer = Signer('SHA-256/DET-ECDSA')..init(true, PrivateKeyParameter<ECPrivateKey>(_private));
    final sig = signer.generateSignature(Uint8List.fromList(utf8.encode(text))) as ECSignature;
    final der = ASN1Sequence(elements: [ASN1Integer(sig.r), ASN1Integer(sig.s)]).encode();
    return SignatureData(hash: fdmsHash(text), signature: base64.encode(der));
  }

  /// Whether [signatureBase64] is this key's signature of [text].
  bool verify(String text, String signatureBase64) {
    try {
      final seq = ASN1Parser(base64.decode(signatureBase64)).nextObject() as ASN1Sequence;
      final r = (seq.elements![0] as ASN1Integer).integer!;
      final s = (seq.elements![1] as ASN1Integer).integer!;
      final verifier = Signer('SHA-256/ECDSA')..init(false, PublicKeyParameter<ECPublicKey>(_public));
      return verifier.verifySignature(Uint8List.fromList(utf8.encode(text)), ECSignature(r, s));
    } catch (_) {
      return false;
    }
  }
}
