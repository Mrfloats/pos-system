import 'package:flutter/material.dart';

import '../core/api.dart';
import '../core/money.dart';
import '../widgets/common.dart';

/// Choose who the sale is for: a saved customer (with their group discount),
/// a name for the receipt only, or nobody.
Future<void> pickCustomer(BuildContext context) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const _CustomerPicker()));

class _CustomerPicker extends StatefulWidget {
  const _CustomerPicker();

  @override
  State<_CustomerPicker> createState() => _CustomerPickerState();
}

class _CustomerPickerState extends State<_CustomerPicker> {
  final _search = TextEditingController();

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  Future<void> _nameOnly() async {
    final state = TillScope.read(context);
    final controller = TextEditingController(text: state.customerName ?? _search.text);
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Name on the receipt'),
        content: TextField(
          controller: controller,
          autofocus: true,
          textCapitalization: TextCapitalization.words,
          onSubmitted: (v) => Navigator.pop(context, v),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancel')),
          FilledButton(onPressed: () => Navigator.pop(context, controller.text), child: const Text('Use')),
        ],
      ),
    );
    if (name == null || !mounted) return;
    state.setCustomer(null, name: name.trim().isEmpty ? null : name.trim());
    Navigator.pop(context);
  }

  Future<void> _create() async {
    final state = TillScope.read(context);
    final name = TextEditingController(text: _search.text);
    final phone = TextEditingController();
    final tin = TextEditingController();
    final vat = TextEditingController();
    final created = await showDialog<bool>(
      context: context,
      builder: (context) {
        var busy = false;
        String? error;
        return StatefulBuilder(
          builder: (context, setDialog) {
            Future<void> save() async {
              if (name.text.trim().isEmpty) return;
              setDialog(() => busy = true);
              try {
                final c = await state.createCustomer({
                  'name': name.text.trim(),
                  if (phone.text.trim().isNotEmpty) 'phone': phone.text.trim(),
                  if (tin.text.trim().isNotEmpty) 'tin': tin.text.trim(),
                  if (vat.text.trim().isNotEmpty) 'vatNumber': vat.text.trim(),
                });
                state.setCustomer(c);
                if (context.mounted) Navigator.pop(context, true);
              } on ApiException catch (e) {
                setDialog(() {
                  busy = false;
                  error = e.message;
                });
              }
            }

            return AlertDialog(
              title: const Text('New customer'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextField(
                      controller: name,
                      autofocus: true,
                      textCapitalization: TextCapitalization.words,
                      decoration: const InputDecoration(labelText: 'Name'),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: phone,
                      keyboardType: TextInputType.phone,
                      decoration: const InputDecoration(labelText: 'Phone'),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: tin,
                      decoration: const InputDecoration(labelText: 'TIN', helperText: 'For tax invoices'),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      controller: vat,
                      decoration: const InputDecoration(labelText: 'VAT number'),
                    ),
                    if (error != null)
                      Padding(
                        padding: const EdgeInsets.only(top: 10),
                        child: Text(error!, style: TextStyle(color: Theme.of(context).colorScheme.error)),
                      ),
                  ],
                ),
              ),
              actions: [
                TextButton(onPressed: busy ? null : () => Navigator.pop(context), child: const Text('Cancel')),
                FilledButton(onPressed: busy ? null : save, child: const Text('Save')),
              ],
            );
          },
        );
      },
    );
    if (created == true && mounted) Navigator.pop(context);
  }

  @override
  Widget build(BuildContext context) {
    final state = TillScope.of(context);
    final customers = state.catalog!.findCustomers(_search.text);
    final scheme = Theme.of(context).colorScheme;
    return Scaffold(
      appBar: AppBar(title: const Text('Customer')),
      body: Narrow(
        maxWidth: 640,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.all(12),
              child: TextField(
                controller: _search,
                autofocus: true,
                decoration: const InputDecoration(hintText: 'Search by name, phone or TIN', prefixIcon: Icon(Icons.search), isDense: true),
                onChanged: (_) => setState(() {}),
              ),
            ),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 12),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  ActionChip(
                    avatar: const Icon(Icons.person_off_outlined, size: 18),
                    label: const Text('Walk-in (no customer)'),
                    onPressed: () {
                      state.setCustomer(null);
                      Navigator.pop(context);
                    },
                  ),
                  ActionChip(avatar: const Icon(Icons.edit_outlined, size: 18), label: const Text('Name on receipt only'), onPressed: _nameOnly),
                  ActionChip(
                    avatar: const Icon(Icons.person_add_alt_outlined, size: 18),
                    label: const Text('New customer'),
                    onPressed: state.online ? _create : () => showMessage(context, 'Adding a customer needs the internet', error: true),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: customers.isEmpty
                  ? Center(
                      child: Text('No customers match', style: TextStyle(color: scheme.onSurfaceVariant)),
                    )
                  : ListView.builder(
                      itemCount: customers.length,
                      itemBuilder: (context, i) {
                        final c = customers[i];
                        final selected = state.customer?.id == c.id;
                        return ListTile(
                          selected: selected,
                          leading: CircleAvatar(child: Text(c.name.characters.first.toUpperCase())),
                          title: Text(c.name),
                          subtitle: Text([c.phone, if (c.tin != null) 'TIN ${c.tin}'].whereType<String>().join(' · ')),
                          trailing: c.discountHundredths > 0
                              ? Text('${formatQty(c.discountHundredths * 10)}% off', style: TextStyle(color: scheme.primary))
                              : null,
                          onTap: () {
                            state.setCustomer(c);
                            Navigator.pop(context);
                          },
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
