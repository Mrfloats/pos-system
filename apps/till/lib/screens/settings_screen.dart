import 'package:flutter/material.dart';

import '../core/api.dart';
import '../state/till_state.dart';
import '../widgets/common.dart';

/// What this till is linked to, receipt printing, and (managers) unpairing.
class SettingsScreen extends StatelessWidget {
  const SettingsScreen({super.key});

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final device = state.device!;
    final catalog = state.catalog;
    final canManage = state.session?.canManage ?? false;
    final scheme = Theme.of(context).colorScheme;
    final synced = catalog?.syncedAt.toLocal();
    String two(int n) => n.toString().padLeft(2, '0');

    Widget section(String title, List<Widget> children) => Padding(
      padding: const EdgeInsets.fromLTRB(12, 16, 12, 0),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 6),
            child: Text(title, style: Theme.of(context).textTheme.labelLarge),
          ),
          Card(child: Column(children: children)),
        ],
      ),
    );

    return Scaffold(
      appBar: AppBar(title: const Text('Till settings')),
      body: Narrow(
        maxWidth: 640,
        child: ListView(
          padding: const EdgeInsets.only(bottom: 24),
          children: [
            section('This till', [
              ListTile(leading: const Icon(Icons.storefront_outlined), title: Text(device.businessName), subtitle: Text(device.storeName)),
              ListTile(leading: const Icon(Icons.point_of_sale), title: Text(device.deviceName), subtitle: Text('Code ${device.deviceCode}')),
              ListTile(leading: const Icon(Icons.dns_outlined), title: const Text('Server'), subtitle: Text(Api.apiBase(device.server))),
              const ListTile(leading: Icon(Icons.info_outline), title: Text('Version'), subtitle: Text(appVersion)),
            ]),
            section('Receipts', [
              ListTile(
                leading: const Icon(Icons.receipt_outlined),
                title: const Text('Paper width'),
                trailing: SegmentedButton<int>(
                  segments: const [
                    ButtonSegment(value: 58, label: Text('58 mm')),
                    ButtonSegment(value: 80, label: Text('80 mm')),
                  ],
                  selected: {state.settings.paperWidth},
                  showSelectedIcon: false,
                  onSelectionChanged: (s) {
                    state.settings.paperWidth = s.first;
                    state.saveSettings();
                  },
                ),
              ),
              SwitchListTile(
                secondary: const Icon(Icons.print_outlined),
                title: const Text('Print every receipt'),
                subtitle: const Text('Opens printing as soon as a sale is complete'),
                value: state.settings.autoPrint,
                onChanged: (v) {
                  state.settings.autoPrint = v;
                  state.saveSettings();
                },
              ),
            ]),
            section('Products and sales', [
              ListTile(
                leading: const Icon(Icons.inventory_2_outlined),
                title: Text('${catalog?.products.length ?? 0} products, ${catalog?.customers.length ?? 0} customers'),
                subtitle: Text(
                  synced == null ? 'Not downloaded yet' : 'Updated ${two(synced.day)}/${two(synced.month)} at ${two(synced.hour)}:${two(synced.minute)}',
                ),
                trailing: TextButton(
                  onPressed: () async {
                    try {
                      await state.refreshCatalog();
                      if (context.mounted) showMessage(context, 'Products and prices are up to date');
                    } on ApiException catch (e) {
                      if (context.mounted) showMessage(context, e.message, error: true);
                    }
                  },
                  child: const Text('Update now'),
                ),
              ),
              ListTile(
                leading: const Icon(Icons.cloud_upload_outlined),
                title: Text(state.outbox.isEmpty ? 'Every sale is uploaded' : '${state.outbox.length} sales not uploaded yet'),
              ),
            ]),
            if (canManage)
              section('Manager', [
                ListTile(
                  leading: Icon(Icons.link_off, color: scheme.error),
                  title: Text('Unlink this till', style: TextStyle(color: scheme.error)),
                  subtitle: const Text('Forgets the store, products and receipts on this device. It has to be set up again by an owner or admin.'),
                  onTap: () async {
                    final waiting = state.outbox.length;
                    final ok = await confirm(
                      context,
                      title: 'Unlink this till?',
                      message: waiting > 0
                          ? '$waiting ${waiting == 1 ? 'sale has' : 'sales have'} not reached Floatly and will be lost.'
                          : 'Staff will not be able to sign in here until it is set up again.',
                      yes: 'Unlink',
                      danger: true,
                    );
                    if (!ok || !context.mounted) return;
                    Navigator.of(context).popUntil((r) => r.isFirst);
                    await state.unpair();
                  },
                ),
              ]),
          ],
        ),
      ),
    );
  }
}
