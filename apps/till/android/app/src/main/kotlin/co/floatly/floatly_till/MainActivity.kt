package co.floatly.floatly_till

import android.Manifest
import android.annotation.SuppressLint
import android.app.PendingIntent
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import java.io.IOException
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Sends ESC/POS receipts straight to receipt printers (lib/printing/printers.dart calls this):
 * printers paired over Bluetooth, including the built-in printer of Sunmi tills, which shows up
 * as a paired device called "InnerPrinter", and printers plugged in by USB.
 */
@SuppressLint("MissingPermission") // Bluetooth permission is checked in withBluetooth() before any call.
class MainActivity : FlutterActivity() {
    private val worker = Executors.newSingleThreadExecutor()
    private var afterBluetoothPermission: ((Boolean) -> Unit)? = null

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, "floatly/printer").setMethodCallHandler { call, result ->
            when (call.method) {
                "bluetoothPrinters" -> withBluetooth(result) { adapter -> result.success(bluetoothPrinters(adapter)) }
                "printBluetooth" -> withBluetooth(result) { adapter -> printBluetooth(adapter, call, result) }
                "usbPrinters" -> result.success(usbPrinters())
                "printUsb" -> printUsb(call, result)
                else -> result.notImplemented()
            }
        }
    }

    // ----- Bluetooth ---------------------------------------------------------------------

    /** Runs [action] once Bluetooth may be used: asks for permission on Android 12 and later. */
    private fun withBluetooth(result: MethodChannel.Result, action: (BluetoothAdapter) -> Unit) {
        val run = {
            val adapter = (getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager?)?.adapter
            when {
                adapter == null -> result.error("no_bluetooth", "This device has no Bluetooth.", null)
                !adapter.isEnabled -> result.error("bluetooth_off", "Bluetooth is off. Turn it on, then try again.", null)
                else -> action(adapter)
            }
        }
        if (Build.VERSION.SDK_INT < 31 || checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED) {
            run()
            return
        }
        afterBluetoothPermission = { granted ->
            if (granted) run() else result.error("permission", "Allow Floatly Till to use nearby devices (Bluetooth) to print receipts.", null)
        }
        requestPermissions(arrayOf(Manifest.permission.BLUETOOTH_CONNECT), BLUETOOTH_REQUEST)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == BLUETOOTH_REQUEST) {
            val callback = afterBluetoothPermission
            afterBluetoothPermission = null
            callback?.invoke(grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED)
        }
    }

    private fun bluetoothPrinters(adapter: BluetoothAdapter): List<Map<String, String>> =
        adapter.bondedDevices
            .map { mapOf("name" to (it.name ?: it.address), "address" to it.address) }
            .sortedBy { it["name"] }

    private fun printBluetooth(adapter: BluetoothAdapter, call: MethodCall, result: MethodChannel.Result) {
        val address = call.argument<String>("address")
        val bytes = call.argument<ByteArray>("bytes")
        if (address == null || bytes == null) {
            result.error("bad_request", "No printer or nothing to print.", null)
            return
        }
        worker.execute {
            try {
                val device = adapter.getRemoteDevice(address)
                // Some cheap printers only accept the "insecure" kind of connection.
                val socket = connect { device.createRfcommSocketToServiceRecord(SERIAL_PORT) }
                    ?: connect { device.createInsecureRfcommSocketToServiceRecord(SERIAL_PORT) }
                    ?: throw IOException("Can't connect to the printer. Check it is switched on and paired.")
                socket.use {
                    val out = it.outputStream
                    // Small pieces, so printers with little memory keep up.
                    var offset = 0
                    while (offset < bytes.size) {
                        val n = minOf(512, bytes.size - offset)
                        out.write(bytes, offset, n)
                        out.flush()
                        offset += n
                    }
                    // Let the printer take the last bytes before the connection closes.
                    Thread.sleep(400)
                }
                runOnUiThread { result.success(null) }
            } catch (e: Exception) {
                runOnUiThread { result.error("print_failed", e.message ?: "Couldn't print over Bluetooth.", null) }
            }
        }
    }

    private fun connect(open: () -> BluetoothSocket): BluetoothSocket? {
        var socket: BluetoothSocket? = null
        return try {
            socket = open()
            socket.connect()
            socket
        } catch (e: IOException) {
            try { socket?.close() } catch (ignored: IOException) {}
            null
        }
    }

    // ----- USB -----------------------------------------------------------------------------

    private val usb: UsbManager by lazy { getSystemService(Context.USB_SERVICE) as UsbManager }

    /** A device's printer interface and the endpoint data is sent to. */
    private fun printerEndpoint(device: UsbDevice): Pair<UsbInterface, UsbEndpoint>? {
        var fallback: Pair<UsbInterface, UsbEndpoint>? = null
        for (i in 0 until device.interfaceCount) {
            val intf = device.getInterface(i)
            for (e in 0 until intf.endpointCount) {
                val ep = intf.getEndpoint(e)
                if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.direction == UsbConstants.USB_DIR_OUT) {
                    if (intf.interfaceClass == UsbConstants.USB_CLASS_PRINTER) return Pair(intf, ep)
                    if (fallback == null) fallback = Pair(intf, ep)
                }
            }
        }
        return fallback
    }

    private fun usbId(device: UsbDevice) = "${device.vendorId}:${device.productId}"

    private fun usbPrinters(): List<Map<String, String>> =
        usb.deviceList.values
            .filter { printerEndpoint(it) != null }
            .map { mapOf("name" to (it.productName ?: "USB printer ${usbId(it)}"), "address" to usbId(it)) }

    private fun printUsb(call: MethodCall, result: MethodChannel.Result) {
        val address = call.argument<String>("address")
        val bytes = call.argument<ByteArray>("bytes")
        val device = usb.deviceList.values.firstOrNull { usbId(it) == address }
        if (device == null || bytes == null) {
            result.error("not_found", "The USB printer isn't plugged in.", null)
            return
        }
        if (usb.hasPermission(device)) {
            writeUsb(device, bytes, result)
            return
        }
        // Android asks the person once whether this app may use the printer.
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                unregisterReceiver(this)
                if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                    writeUsb(device, bytes, result)
                } else {
                    result.error("permission", "Allow Floatly Till to use the USB printer to print receipts.", null)
                }
            }
        }
        val filter = IntentFilter(USB_PERMISSION)
        if (Build.VERSION.SDK_INT >= 33) registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED) else registerReceiver(receiver, filter)
        val flags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        val intent = PendingIntent.getBroadcast(this, 0, Intent(USB_PERMISSION).setPackage(packageName), flags)
        usb.requestPermission(device, intent)
    }

    private fun writeUsb(device: UsbDevice, bytes: ByteArray, result: MethodChannel.Result) {
        worker.execute {
            try {
                val (intf, endpoint) = printerEndpoint(device) ?: throw IOException("This USB device isn't a printer.")
                val connection = usb.openDevice(device) ?: throw IOException("Couldn't open the USB printer.")
                try {
                    if (!connection.claimInterface(intf, true)) throw IOException("The USB printer is busy.")
                    var offset = 0
                    while (offset < bytes.size) {
                        val sent = connection.bulkTransfer(endpoint, bytes, offset, minOf(16384, bytes.size - offset), 5000)
                        if (sent < 0) throw IOException("The USB printer stopped taking the receipt.")
                        offset += sent
                    }
                    connection.releaseInterface(intf)
                } finally {
                    connection.close()
                }
                runOnUiThread { result.success(null) }
            } catch (e: Exception) {
                runOnUiThread { result.error("print_failed", e.message ?: "Couldn't print over USB.", null) }
            }
        }
    }

    companion object {
        private const val BLUETOOTH_REQUEST = 4101
        private const val USB_PERMISSION = "co.floatly.floatly_till.USB_PERMISSION"

        /** The serial port profile receipt printers use over Bluetooth. */
        private val SERIAL_PORT: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
    }
}
