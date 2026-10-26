import 'package:flutter/material.dart';

/// The Floatly logo, drawn from the same shapes as the backoffice's
/// (apps/backoffice/src/components/brand-mark.tsx): a receipt roll on a
/// ledger-green tile, on a 32 × 32 grid.
class BrandPainter extends CustomPainter {
  const BrandPainter({this.rounded = true, this.tile = true, this.inset = 0});

  /// Round the tile's corners (the launcher icons leave that to the phone).
  final bool rounded;

  /// Draw the green tile; false draws only the receipt (Android adaptive icon foreground).
  final bool tile;

  /// Shrinks the drawing towards the middle, as a share of the size.
  final double inset;

  static const _green = Color(0xFF1C6652);

  @override
  void paint(Canvas canvas, Size size) {
    canvas.translate(size.width * inset, size.height * inset);
    final s = size.width * (1 - 2 * inset) / 32;
    canvas.scale(s);

    if (tile) {
      final box = RRect.fromRectAndRadius(const Rect.fromLTWH(0, 0, 32, 32), Radius.circular(rounded ? 9 : 0));
      canvas.save();
      canvas.clipRRect(box);
      canvas.drawRect(const Rect.fromLTWH(0, 0, 32, 32), Paint()..color = _green);
      // The mint wave across the top.
      final wave = Path()
        ..moveTo(0, 0)
        ..lineTo(32, 0)
        ..lineTo(32, 14)
        ..cubicTo(22, 18, 10, 10, 0, 16)
        ..close();
      canvas.drawPath(wave, Paint()..color = const Color(0xFF34C38F).withValues(alpha: 0.45));
      canvas.restore();
    }

    // The receipt, with a torn zig-zag bottom edge.
    final receipt = Path()
      ..moveTo(10, 7)
      ..lineTo(22, 7)
      ..lineTo(22, 24)
      ..lineTo(20, 22.5)
      ..lineTo(18, 24)
      ..lineTo(16, 22.5)
      ..lineTo(14, 24)
      ..lineTo(12, 22.5)
      ..lineTo(10, 24)
      ..close();
    canvas.drawPath(receipt, Paint()..color = Colors.white);
    final ink = Paint()
      ..color = _green
      ..strokeWidth = 1.6
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(const Offset(13, 11.5), const Offset(19, 11.5), ink);
    canvas.drawLine(const Offset(13, 15), const Offset(19, 15), ink);
    canvas.drawLine(const Offset(13, 18.5), const Offset(16.5, 18.5), ink);
  }

  @override
  bool shouldRepaint(BrandPainter old) => old.rounded != rounded || old.tile != tile || old.inset != inset;
}
