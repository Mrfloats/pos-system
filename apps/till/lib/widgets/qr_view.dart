import 'package:flutter/material.dart';
import 'package:qr/qr.dart';

/// A QR code drawn on screen (black on white, with the quiet zone scanners need).
class QrView extends StatelessWidget {
  const QrView(this.data, {super.key, this.size = 140});

  final String data;
  final double size;

  @override
  Widget build(BuildContext context) => Semantics(
    label: 'QR code',
    image: true,
    child: CustomPaint(
      size: Size.square(size),
      painter: _QrPainter(QrImage(QrCode.fromData(data: data, errorCorrectLevel: QrErrorCorrectLevel.M))),
    ),
  );
}

class _QrPainter extends CustomPainter {
  _QrPainter(this.image);

  final QrImage image;

  @override
  void paint(Canvas canvas, Size size) {
    const quiet = 4;
    final n = image.moduleCount;
    final cell = size.width / (n + quiet * 2);
    canvas.drawRect(Offset.zero & size, Paint()..color = Colors.white);
    final dark = Paint()..color = Colors.black;
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (image.isDark(y, x)) canvas.drawRect(Rect.fromLTWH((x + quiet) * cell, (y + quiet) * cell, cell + 0.5, cell + 0.5), dark);
      }
    }
  }

  @override
  bool shouldRepaint(_QrPainter old) => old.image != image;
}
