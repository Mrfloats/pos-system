import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

/// Reads one barcode with the phone or tablet camera and returns it.
/// Countertop tills with a built-in or USB scanner don't need this: the
/// scanner types straight into the search box.
class ScannerScreen extends StatefulWidget {
  const ScannerScreen({super.key});

  @override
  State<ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<ScannerScreen> {
  final _controller = MobileScannerController(detectionSpeed: DetectionSpeed.noDuplicates);
  bool _done = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  void _detected(BarcodeCapture capture) {
    if (_done) return;
    final code = capture.barcodes.map((b) => b.rawValue).whereType<String>().where((v) => v.isNotEmpty).firstOrNull;
    if (code == null) return;
    _done = true;
    Navigator.of(context).pop(code);
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        title: const Text('Scan a barcode'),
        actions: [
          IconButton(tooltip: 'Torch', onPressed: () => _controller.toggleTorch(), icon: const Icon(Icons.flashlight_on_outlined)),
          IconButton(tooltip: 'Switch camera', onPressed: () => _controller.switchCamera(), icon: const Icon(Icons.cameraswitch_outlined)),
        ],
      ),
      body: Stack(
        alignment: Alignment.center,
        children: [
          MobileScanner(controller: _controller, onDetect: _detected),
          IgnorePointer(
            child: Container(
              width: 280,
              height: 170,
              decoration: BoxDecoration(
                border: Border.all(color: Colors.white, width: 3),
                borderRadius: BorderRadius.circular(16),
              ),
            ),
          ),
          const Positioned(
            bottom: 40,
            child: Text('Hold the barcode inside the frame', style: TextStyle(color: Colors.white70)),
          ),
        ],
      ),
    );
  }
}
