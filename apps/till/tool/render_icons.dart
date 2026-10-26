// Draws the app icon images from the Floatly logo (lib/widgets/brand_painter.dart):
//
//   flutter test tool/render_icons.dart
//   dart run flutter_launcher_icons
//
// The second command turns them into every platform's launcher icons.
import 'dart:io';
import 'dart:ui' as ui;

import 'package:floatly_till/widgets/brand_painter.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

Future<void> _render(String path, BrandPainter painter) async {
  const size = 1024.0;
  final recorder = ui.PictureRecorder();
  painter.paint(Canvas(recorder), const Size.square(size));
  final image = await recorder.endRecording().toImage(size.toInt(), size.toInt());
  final png = await image.toByteData(format: ui.ImageByteFormat.png);
  await File(path).create(recursive: true);
  await File(path).writeAsBytes(png!.buffer.asUint8List());
}

void main() {
  test('render icons', () async {
    // Square: phones and desktops round the corners themselves.
    await _render('assets/icon/icon.png', const BrandPainter(rounded: false));
    // Rounded, for the web and Windows where nothing rounds it.
    await _render('assets/icon/icon-rounded.png', const BrandPainter(inset: 0.04));
    // Android adaptive icon: the receipt alone, inside the middle safe area.
    await _render('assets/icon/foreground.png', const BrandPainter(tile: false, inset: 0.18));
  });
}
