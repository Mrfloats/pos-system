import 'package:flutter/material.dart';

import 'admin_widgets.dart';

/// Loads a long list from the API a page at a time (the API's `{items, total,
/// page, pageSize}` answer). Searching and filtering happen on the server:
/// change what [fetch] asks for, then call [reload].
class PagedLoader extends ChangeNotifier {
  PagedLoader(this.fetch, {this.pageSize = 30});

  /// Fetches one page (1-based).
  final Future<Map<String, dynamic>> Function(int page, int pageSize) fetch;
  final int pageSize;

  List<Map<String, dynamic>> items = [];
  int total = 0;

  /// The first page's whole answer, for extras like a total for the list.
  Map<String, dynamic>? first;
  bool loading = false;

  /// Nothing has loaded yet (show skeletons rather than "nothing here").
  bool get fresh => first == null && error == null;
  bool get done => first != null && items.length >= total;
  Object? error;

  int _page = 0;
  int _generation = 0;
  bool _disposed = false;

  /// Starts again from the first page. [keep] leaves the old rows on screen until the new ones arrive.
  Future<void> reload({bool keep = false}) async {
    final gen = ++_generation;
    if (!keep) {
      items = [];
      first = null;
      total = 0;
    }
    error = null;
    loading = true;
    _notify();
    try {
      final res = await fetch(1, pageSize);
      if (gen != _generation) return;
      first = res;
      items = [for (final i in res['items'] as List) (i as Map).cast<String, dynamic>()];
      total = (res['total'] as num).toInt();
      _page = 1;
    } catch (e) {
      if (gen != _generation) return;
      error = e;
    }
    loading = false;
    _notify();
  }

  Future<void> loadMore() async {
    if (loading || done || first == null) return;
    final gen = _generation;
    loading = true;
    error = null;
    _notify();
    try {
      final res = await fetch(_page + 1, pageSize);
      if (gen != _generation) return;
      items = [...items, for (final i in res['items'] as List) (i as Map).cast<String, dynamic>()];
      total = (res['total'] as num).toInt();
      _page++;
    } catch (e) {
      if (gen != _generation) return;
      error = e;
    }
    loading = false;
    _notify();
  }

  void _notify() {
    if (!_disposed) notifyListeners();
  }

  @override
  void dispose() {
    _disposed = true;
    _generation++;
    super.dispose();
  }
}

/// A scrolling list over a [PagedLoader]: pull down to refresh, more rows load
/// as the end comes near, with skeletons, an empty state and a way to retry.
class PagedListView extends StatelessWidget {
  const PagedListView({super.key, required this.loader, required this.itemBuilder, required this.empty, this.header, this.maxWidth = 720});

  final PagedLoader loader;
  final Widget Function(BuildContext context, Map<String, dynamic> item) itemBuilder;

  /// Shown when the list loaded and has nothing in it.
  final Widget empty;

  /// Scrolls with the list, above the first row (filters, a summary).
  final Widget? header;
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    return ListenableBuilder(
      listenable: loader,
      builder: (context, _) {
        final items = loader.items;
        final tail = <Widget>[
          if (loader.fresh)
            for (var i = 0; i < 6; i++) const _SkeletonRow()
          else if (loader.error != null)
            ErrorState(error: loader.error!, onRetry: () => items.isEmpty ? loader.reload() : loader.loadMore())
          else if (items.isEmpty && !loader.loading)
            empty
          else if (!loader.done)
            const Padding(padding: EdgeInsets.all(20), child: Center(child: SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.4)))),
        ];
        final head = header == null ? 0 : 1;
        return RefreshIndicator(
          onRefresh: () => loader.reload(keep: true),
          child: NotificationListener<ScrollNotification>(
            onNotification: (n) {
              if (n.metrics.pixels >= n.metrics.maxScrollExtent - 400) loader.loadMore();
              return false;
            },
            child: ListView.builder(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.only(bottom: 24),
              itemCount: head + items.length + tail.length,
              itemBuilder: (context, i) {
                final Widget child;
                if (i < head) {
                  child = header!;
                } else if (i - head < items.length) {
                  child = itemBuilder(context, items[i - head]);
                } else {
                  child = tail[i - head - items.length];
                  // A short list never scrolls, so the next page is asked for as its spinner appears.
                  if (!loader.fresh && loader.error == null && !loader.done) WidgetsBinding.instance.addPostFrameCallback((_) => loader.loadMore());
                }
                return Center(
                  child: ConstrainedBox(constraints: BoxConstraints(maxWidth: maxWidth), child: child),
                );
              },
            ),
          ),
        );
      },
    );
  }
}

class _SkeletonRow extends StatelessWidget {
  const _SkeletonRow();

  @override
  Widget build(BuildContext context) => const Padding(
    padding: EdgeInsets.symmetric(horizontal: 16, vertical: 12),
    child: Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [Skeleton(width: 140, height: 14), SizedBox(height: 8), Skeleton(width: 210, height: 12)],
          ),
        ),
        SizedBox(width: 16),
        Skeleton(width: 64, height: 16),
      ],
    ),
  );
}

/// A search box that asks the server a moment after typing stops.
class SearchBox extends StatefulWidget {
  const SearchBox({super.key, required this.hint, required this.onChanged, this.trailing});

  final String hint;
  final ValueChanged<String> onChanged;

  /// A button at the end of the box (scan a barcode, say).
  final Widget? trailing;

  @override
  State<SearchBox> createState() => _SearchBoxState();
}

class _SearchBoxState extends State<SearchBox> {
  final _text = TextEditingController();
  int _typed = 0;

  @override
  void dispose() {
    _typed++;
    _text.dispose();
    super.dispose();
  }

  void _changed(String value) {
    setState(() {});
    final mine = ++_typed;
    Future<void>.delayed(const Duration(milliseconds: 350), () {
      if (mine == _typed) widget.onChanged(value.trim());
    });
  }

  @override
  Widget build(BuildContext context) => TextField(
    controller: _text,
    textInputAction: TextInputAction.search,
    onChanged: _changed,
    onSubmitted: (v) {
      _typed++;
      widget.onChanged(v.trim());
    },
    decoration: InputDecoration(
      hintText: widget.hint,
      prefixIcon: const Icon(Icons.search),
      isDense: true,
      suffixIcon: _text.text.isEmpty
          ? widget.trailing
          : IconButton(
              tooltip: 'Clear',
              icon: const Icon(Icons.close),
              onPressed: () {
                _text.clear();
                _typed++;
                setState(() {});
                widget.onChanged('');
              },
            ),
    ),
  );
}
