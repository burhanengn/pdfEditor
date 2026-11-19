import 'dart:async';
import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/session_state.dart';
import '../../engine/session_bridge.dart';
import '../../engine/tile_cache.dart';
import '../../l10n/gp_l10n.g.dart';
import '../../theme/gp_tokens.g.dart';

/// Top Viewer AppBar & Search Strip (02 §2.1, 04 §5).
class GpViewerTopBar extends StatelessWidget {
  const GpViewerTopBar({
    super.key,
    required this.appState,
    required this.layoutSpec,
    required this.l10n,
    required this.onBackToLibrary,
    required this.onToggleNavigator,
    required this.onToggleSearch,
    required this.onOpenSaveSheet,
    required this.onShare,
    required this.onPrint,
    required this.onOpenSettings,
    required this.onSwitchToEdit,
    this.onCopyPageText,
  });

  final GpAppState appState;
  final GpLayoutSpec layoutSpec;
  final GpL10n l10n;
  final VoidCallback onBackToLibrary;
  final VoidCallback onToggleNavigator;
  final VoidCallback onToggleSearch;
  final VoidCallback onOpenSaveSheet;
  final VoidCallback onShare;
  final VoidCallback onPrint;
  final VoidCallback onOpenSettings;
  final VoidCallback onSwitchToEdit;
  final VoidCallback? onCopyPageText;

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
    final barHeight = layoutSpec.isTabletOrDesktop
        ? GpComponents.toolbarHeightDesktop
        : GpComponents.toolbarHeightMobile;

    return Container(
      height: barHeight + MediaQuery.paddingOf(context).top,
      padding: EdgeInsets.only(top: MediaQuery.paddingOf(context).top),
      decoration: BoxDecoration(
        color: palette.surfaceRaised.withValues(alpha: 0.96),
        border: Border(bottom: BorderSide(color: palette.borderSubtle)),
      ),
      child: Row(
        children: [
          IconButton(
            tooltip: l10n.t('action.close'),
            constraints: const BoxConstraints(
              minWidth: GpComponents.touchTargetMin,
              minHeight: GpComponents.touchTargetMin,
            ),
            onPressed: onBackToLibrary,
            icon: Icon(Icons.arrow_back, color: palette.textPrimary),
          ),
          IconButton(
            key: const Key('viewer-pages-btn'),
            tooltip: l10n.t('nav.pages'),
            constraints: const BoxConstraints(
              minWidth: GpComponents.touchTargetMin,
              minHeight: GpComponents.touchTargetMin,
            ),
            onPressed: onToggleNavigator,
            icon: Icon(Icons.view_sidebar_outlined, color: palette.textPrimary),
          ),
          Expanded(
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  appState.displayName.isEmpty ? l10n.t('app.name') : appState.displayName,
                  style: GpTypography.label.copyWith(color: palette.textPrimary),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
                Text(
                  '${appState.activePageIndex + 1} / ${appState.pages.length}',
                  style: GpTypography.caption.copyWith(color: palette.textSecondary),
                ),
              ],
            ),
          ),
          IconButton(
            key: const Key('viewer-search-btn'),
            tooltip: l10n.t('action.search'),
            constraints: const BoxConstraints(
              minWidth: GpComponents.touchTargetMin,
              minHeight: GpComponents.touchTargetMin,
            ),
            onPressed: onToggleSearch,
            icon: Icon(Icons.search, color: palette.textPrimary),
          ),
          if (layoutSpec.isTabletOrDesktop)
            Padding(
              padding: const EdgeInsets.only(right: GpSpacing.s2),
              child: FilledButton.icon(
                key: const Key('viewer-edit-pdf-btn'),
                onPressed: onSwitchToEdit,
                style: FilledButton.styleFrom(
                  backgroundColor: palette.accent,
                  foregroundColor: palette.accentForeground,
                  minimumSize: const Size(92, GpComponents.touchTargetMin),
                ),
                icon: const Icon(Icons.edit_outlined, size: 18),
                label: Text(l10n.t('action.editPdf')),
              ),
            ),
          if (appState.dirty)
            IconButton(
              key: const Key('viewer-save-btn'),
              tooltip: l10n.t('action.save'),
              constraints: const BoxConstraints(
                minWidth: GpComponents.touchTargetMin,
                minHeight: GpComponents.touchTargetMin,
              ),
              onPressed: onOpenSaveSheet,
              icon: Icon(Icons.save_alt, color: palette.accent),
            ),
          PopupMenuButton<String>(
            tooltip: l10n.t('settings.language'),
            constraints: const BoxConstraints(
              minWidth: GpComponents.touchTargetMin,
              minHeight: GpComponents.touchTargetMin,
            ),
            icon: Icon(Icons.more_vert, color: palette.textPrimary),
            onSelected: (action) {
              if (action == 'save') onOpenSaveSheet();
              if (action == 'share') onShare();
              if (action == 'print') onPrint();
              if (action == 'copyText') onCopyPageText?.call();
              if (action == 'settings') onOpenSettings();
            },
            itemBuilder: (_) => [
              PopupMenuItem(value: 'save', child: Text(l10n.t('action.save'))),
              PopupMenuItem(value: 'share', child: Text(l10n.t('action.share'))),
              PopupMenuItem(value: 'print', child: Text(l10n.t('action.print'))),
              if (onCopyPageText != null)
                PopupMenuItem(
                  value: 'copyText',
                  child: Text(appState.locale == GpLocale.tr ? 'Sayfa Metnini Kopyala' : 'Copy Page Text'),
                ),
              PopupMenuItem(value: 'settings', child: Text('${l10n.t('settings.language')} / Theme')),
            ],
          ),
        ],
      ),
    );
  }
}

/// Streaming Turkish/Unicode-folded search bar (02 §2.3, 04 §4.3).
class GpViewerSearchBar extends StatefulWidget {
  const GpViewerSearchBar({
    super.key,
    required this.appState,
    required this.l10n,
    required this.onQuerySubmit,
    required this.onStepResult,
    required this.onClose,
  });

  final GpAppState appState;
  final GpL10n l10n;
  final void Function(String q) onQuerySubmit;
  final void Function(int delta) onStepResult;
  final VoidCallback onClose;

  @override
  State<GpViewerSearchBar> createState() => _GpViewerSearchBarState();
}

class _GpViewerSearchBarState extends State<GpViewerSearchBar> {
  late final TextEditingController _ctrl =
      TextEditingController(text: widget.appState.searchQuery);

  @override
  void dispose() {
    _ctrl.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
    final hits = widget.appState.searchHits;
    final countLabel = widget.appState.searchQuery.isEmpty
        ? ''
        : (hits.isEmpty
            ? (widget.appState.searchScanning ? '…' : widget.l10n.t('search.noResults'))
            : '${widget.appState.activeSearchIdx + 1}/${hits.length}');

    return Material(
      color: palette.surfaceOverlay,
      elevation: 4,
      child: Padding(
        padding: const EdgeInsets.symmetric(
          horizontal: GpSpacing.s3,
          vertical: GpSpacing.s2,
        ),
        child: Row(
          children: [
            Expanded(
              child: TextField(
                key: const Key('viewer-search-input'),
                controller: _ctrl,
                autofocus: true,
                textInputAction: TextInputAction.search,
                style: GpTypography.body.copyWith(color: palette.textPrimary),
                decoration: InputDecoration(
                  hintText: widget.l10n.t('search.placeholder'),
                  hintStyle: GpTypography.body.copyWith(color: palette.textSecondary),
                  isDense: true,
                  border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                  contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
                ),
                onSubmitted: widget.onQuerySubmit,
              ),
            ),
            if (countLabel.isNotEmpty)
              Padding(
                padding: const EdgeInsets.symmetric(horizontal: GpSpacing.s2),
                child: Text(
                  countLabel,
                  style: GpTypography.numeric.copyWith(color: palette.textSecondary),
                ),
              ),
            IconButton(
              constraints: const BoxConstraints(
                minWidth: GpComponents.touchTargetMin,
                minHeight: GpComponents.touchTargetMin,
              ),
              onPressed: hits.isEmpty ? null : () => widget.onStepResult(-1),
              icon: const Icon(Icons.keyboard_arrow_up),
            ),
            IconButton(
              constraints: const BoxConstraints(
                minWidth: GpComponents.touchTargetMin,
                minHeight: GpComponents.touchTargetMin,
              ),
              onPressed: hits.isEmpty ? null : () => widget.onStepResult(1),
              icon: const Icon(Icons.keyboard_arrow_down),
            ),
            IconButton(
              constraints: const BoxConstraints(
                minWidth: GpComponents.touchTargetMin,
                minHeight: GpComponents.touchTargetMin,
              ),
              onPressed: widget.onClose,
              icon: const Icon(Icons.close),
            ),
          ],
        ),
      ),
    );
  }
}

/// 3-detent Bottom Sheet / Side Drawer for Outline + Thumbnails (03 §4, 04 §5).
class GpNavigatorSheet extends StatelessWidget {
  const GpNavigatorSheet({
    super.key,
    required this.appState,
    required this.l10n,
    required this.onSelectPage,
    required this.onClose,
    this.bridge,
    this.tileCache,
  });

  final GpAppState appState;
  final GpL10n l10n;
  final void Function(int pageIndex) onSelectPage;
  final VoidCallback onClose;
  final GpSessionBridge? bridge;
  final GpTileCache? tileCache;

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;

    return DraggableScrollableSheet(
      initialChildSize: 0.45,
      minChildSize: 0.22,
      maxChildSize: 0.90,
      snap: true,
      snapSizes: const [0.22, 0.50, 0.90],
      builder: (context, scrollController) {
        return DefaultTabController(
          length: 2,
          child: Container(
            decoration: BoxDecoration(
              color: palette.surfaceRaised,
              borderRadius: const BorderRadius.vertical(
                top: Radius.circular(GpComponents.sheetRadius),
              ),
              border: Border.all(color: palette.borderSubtle),
              boxShadow: const [BoxShadow(blurRadius: 18, color: Color(0x44000000))],
            ),
            child: Column(
              children: [
                const SizedBox(height: 8),
                Container(
                  width: 36,
                  height: 4,
                  decoration: BoxDecoration(
                    color: palette.border,
                    borderRadius: BorderRadius.circular(2),
                  ),
                ),
                TabBar(
                  labelColor: palette.accent,
                  unselectedLabelColor: palette.textSecondary,
                  tabs: [
                    Tab(text: l10n.t('nav.pages')),
                    Tab(text: l10n.t('nav.outline')),
                  ],
                ),
                Expanded(
                  child: TabBarView(
                    children: [
                      GridView.builder(
                        controller: scrollController,
                        padding: const EdgeInsets.all(GpSpacing.s3),
                        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 3,
                          mainAxisSpacing: GpSpacing.s3,
                          crossAxisSpacing: GpSpacing.s3,
                          childAspectRatio: 0.75,
                        ),
                        itemCount: appState.pages.length,
                        itemBuilder: (_, idx) {
                          final active = idx == appState.activePageIndex;
                          final page = appState.pages[idx];
                          return InkWell(
                            onTap: () {
                              onSelectPage(idx);
                              onClose();
                            },
                            borderRadius: BorderRadius.circular(10),
                            child: Container(
                              decoration: BoxDecoration(
                                color: palette.surfaceOverlay,
                                borderRadius: BorderRadius.circular(10),
                                border: Border.all(
                                  color: active ? palette.accent : palette.border,
                                  width: active ? 2 : 1,
                                ),
                              ),
                              clipBehavior: Clip.antiAlias,
                              child: Stack(
                                fit: StackFit.expand,
                                children: [
                                  if (bridge != null && tileCache != null && appState.docId != null)
                                    GpPageThumbnailPreview(
                                      docId: appState.docId!,
                                      page: page,
                                      themeName: appState.theme.name,
                                      darkPaperInvert: appState.darkPaperInvert,
                                      bridge: bridge!,
                                      tileCache: tileCache!,
                                    )
                                  else
                                    Center(
                                      child: Text(
                                        '${idx + 1}',
                                        style: GpTypography.titleM.copyWith(
                                          color: active ? palette.accent : palette.textPrimary,
                                        ),
                                      ),
                                    ),
                                  Positioned(
                                    right: 6,
                                    bottom: 6,
                                    child: Container(
                                      padding: const EdgeInsets.symmetric(horizontal: 7, vertical: 2),
                                      decoration: BoxDecoration(
                                        color: active
                                            ? palette.accent
                                            : const Color(0xCC0F172A),
                                        borderRadius: BorderRadius.circular(10),
                                      ),
                                      child: Text(
                                        '${idx + 1}',
                                        style: GpTypography.caption.copyWith(
                                          color: active ? palette.accentForeground : Colors.white,
                                          fontWeight: FontWeight.w600,
                                        ),
                                      ),
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                      ListView(
                        controller: scrollController,
                        padding: const EdgeInsets.all(GpSpacing.s3),
                        children: appState.outline.isEmpty
                            ? [
                                Padding(
                                  padding: const EdgeInsets.all(GpSpacing.s4),
                                  child: Text(
                                    'No bookmarks / outline entries',
                                    style: GpTypography.body.copyWith(color: palette.textSecondary),
                                  ),
                                ),
                              ]
                            : appState.outline
                                .map(
                                  (node) => ListTile(
                                    title: Text(
                                      node.title,
                                      style: GpTypography.body.copyWith(color: palette.textPrimary),
                                    ),
                                    trailing: node.pageIndex != null
                                        ? Text(
                                            '${node.pageIndex! + 1}',
                                            style: GpTypography.numeric
                                                .copyWith(color: palette.textSecondary),
                                          )
                                        : null,
                                    onTap: node.pageIndex != null
                                        ? () {
                                            onSelectPage(node.pageIndex!);
                                            onClose();
                                          }
                                        : null,
                                  ),
                                )
                                .toList(),
                      ),
                    ],
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
}

/// K7 Save Workflow Bottom Sheet: "Save as copy" primary CTA; Overwrite secondary with confirmation (00 K7, 04 §6.2).
Future<void> showGpSaveWorkflowSheet({
  required BuildContext context,
  required GpAppState appState,
  required GpL10n l10n,
  required Future<void> Function() onSaveAsCopy,
  required Future<void> Function() onOverwriteOriginal,
  required void Function(bool dontAsk) onSetDontAsk,
  required Future<void> Function() onShare,
}) async {
  final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
  var confirmingOverwrite = false;
  var dontAskChecked = appState.overwriteDontAskAgain;

  await showModalBottomSheet<void>(
    context: context,
    backgroundColor: palette.surfaceRaised,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(GpComponents.sheetRadius)),
    ),
    builder: (ctx) {
      return StatefulBuilder(
        builder: (ctx, setModalState) {
          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(GpSpacing.s4),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.t('action.save'),
                    style: GpTypography.titleM.copyWith(color: palette.textPrimary),
                  ),
                  const SizedBox(height: GpSpacing.s3),
                  if (!appState.writable)
                    Padding(
                      padding: const EdgeInsets.only(bottom: GpSpacing.s3),
                      child: Text(
                        l10n.t('mobile.readOnlyFallbackHint'),
                        style: GpTypography.caption.copyWith(color: palette.warning),
                      ),
                    ),
                  if (!confirmingOverwrite) ...[
                    FilledButton.icon(
                      key: const Key('k7-save-copy-btn'),
                      onPressed: () {
                        Navigator.pop(ctx);
                        onSaveAsCopy();
                      },
                      style: FilledButton.styleFrom(
                        backgroundColor: palette.accent,
                        foregroundColor: palette.accentForeground,
                        minimumSize: const Size.fromHeight(GpComponents.primaryTouchTarget),
                      ),
                      icon: const Icon(Icons.file_copy_outlined),
                      label: Text(l10n.t('action.saveAsCopy')),
                    ),
                    const SizedBox(height: GpSpacing.s2),
                    if (appState.writable)
                      OutlinedButton.icon(
                        key: const Key('k7-overwrite-btn'),
                        onPressed: () {
                          if (appState.overwriteDontAskAgain) {
                            Navigator.pop(ctx);
                            onOverwriteOriginal();
                          } else {
                            setModalState(() => confirmingOverwrite = true);
                          }
                        },
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size.fromHeight(GpComponents.primaryTouchTarget),
                        ),
                        icon: const Icon(Icons.save_outlined),
                        label: Text(l10n.t('action.overwriteOriginal')),
                      ),
                    const SizedBox(height: GpSpacing.s2),
                    TextButton.icon(
                      onPressed: () {
                        Navigator.pop(ctx);
                        onShare();
                      },
                      style: TextButton.styleFrom(
                        minimumSize: const Size.fromHeight(GpComponents.touchTargetMin),
                      ),
                      icon: const Icon(Icons.share),
                      label: Text(l10n.t('action.share')),
                    ),
                  ] else ...[
                    Text(
                      l10n.t('save.overwriteConfirmTitle'),
                      style: GpTypography.titleM.copyWith(color: palette.danger),
                    ),
                    const SizedBox(height: GpSpacing.s2),
                    Text(
                      l10n.t('save.overwriteConfirmBody'),
                      style: GpTypography.body.copyWith(color: palette.textSecondary),
                    ),
                    CheckboxListTile(
                      value: dontAskChecked,
                      onChanged: (v) => setModalState(() => dontAskChecked = v ?? false),
                      title: Text(
                        l10n.t('save.dontAskAgain'),
                        style: GpTypography.body.copyWith(color: palette.textPrimary),
                      ),
                    ),
                    Row(
                      children: [
                        Expanded(
                          child: OutlinedButton(
                            onPressed: () => setModalState(() => confirmingOverwrite = false),
                            style: OutlinedButton.styleFrom(
                              minimumSize: const Size.fromHeight(GpComponents.primaryTouchTarget),
                            ),
                            child: Text(l10n.t('action.cancel')),
                          ),
                        ),
                        const SizedBox(width: GpSpacing.s3),
                        Expanded(
                          child: FilledButton(
                            onPressed: () {
                              if (dontAskChecked) onSetDontAsk(true);
                              Navigator.pop(ctx);
                              onOverwriteOriginal();
                            },
                            style: FilledButton.styleFrom(
                              backgroundColor: palette.danger,
                              minimumSize: const Size.fromHeight(GpComponents.primaryTouchTarget),
                            ),
                            child: Text(l10n.t('action.overwriteOriginal')),
                          ),
                        ),
                      ],
                    ),
                  ],
                ],
              ),
            ),
          );
        },
      );
    },
  );
}

class GpPageThumbnailPreview extends StatefulWidget {
  const GpPageThumbnailPreview({
    super.key,
    required this.docId,
    required this.page,
    required this.themeName,
    required this.darkPaperInvert,
    required this.bridge,
    required this.tileCache,
  });

  final String docId;
  final GpPageMeta page;
  final String themeName;
  final bool darkPaperInvert;
  final GpSessionBridge bridge;
  final GpTileCache tileCache;

  @override
  State<GpPageThumbnailPreview> createState() => _GpPageThumbnailPreviewState();
}

class _GpPageThumbnailPreviewState extends State<GpPageThumbnailPreview> {
  static final Set<GpTileKey> _loading = {};

  GpTileKey get _key => GpTileKey(
        docId: widget.docId,
        pageIndex: widget.page.sourcePageIndex,
        tileX: 0,
        tileY: 0,
        scaleBucket: 'preview',
        rotation: widget.page.userRotation,
        themeKey: widget.themeName,
        isPreview: true,
      );

  @override
  void initState() {
    super.initState();
    _ensureLoaded();
  }

  @override
  void didUpdateWidget(covariant GpPageThumbnailPreview oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.docId != widget.docId ||
        oldWidget.page.sourcePageIndex != widget.page.sourcePageIndex ||
        oldWidget.page.userRotation != widget.page.userRotation ||
        oldWidget.themeName != widget.themeName) {
      _ensureLoaded();
    }
  }

  Future<void> _ensureLoaded() async {
    final key = _key;
    if (widget.tileCache.contains(key) || _loading.contains(key)) return;
    _loading.add(key);
    try {
      final pw = math.max(120, (widget.page.displayWidth * 0.35).round());
      final ph = math.max(160, (widget.page.displayHeight * 0.35).round());
      final px = await widget.bridge.renderTile(
        docId: widget.docId,
        pageIndex: widget.page.sourcePageIndex,
        tileX: 0,
        tileY: 0,
        tileWidthPx: pw,
        tileHeightPx: ph,
        scale: 0.35,
        userRotation: widget.page.userRotation,
        theme: widget.themeName,
        darkPaperInvert: widget.darkPaperInvert,
        priorityTier: 2,
        scope: 'thumb:${widget.docId}',
      );
      final img = await decodePremultipliedRgbaImage(
        rgba: px.rgba,
        width: px.width,
        height: px.height,
      );
      if (!mounted) {
        img.dispose();
        return;
      }
      widget.tileCache.put(key, img, width: px.width, height: px.height);
      if (mounted) setState(() {});
    } catch (_) {
      // Ignored on close/cancel.
    } finally {
      _loading.remove(key);
    }
  }

  @override
  Widget build(BuildContext context) {
    final cached = widget.tileCache.get(_key);
    if (cached == null) {
      return Container(
        color: Colors.white,
        alignment: Alignment.center,
        child: const Icon(
          Icons.description_outlined,
          size: 18,
          color: Color(0xFF94A3B8),
        ),
      );
    }
    return Container(
      color: Colors.white,
      child: RawImage(
        image: cached.image,
        fit: BoxFit.contain,
      ),
    );
  }
}

Future<void> showGpPageTextSheet({
  required BuildContext context,
  required GpAppState appState,
  required String pageText,
}) async {
  final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
  final isTr = appState.locale == GpLocale.tr;
  await showModalBottomSheet<void>(
    context: context,
    backgroundColor: palette.surfaceRaised,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(GpComponents.sheetRadius)),
    ),
    builder: (ctx) => SafeArea(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.72),
        child: Padding(
          padding: const EdgeInsets.all(GpSpacing.s4),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      isTr
                          ? 'Sayfa ${appState.activePageIndex + 1} Metni'
                          : 'Page ${appState.activePageIndex + 1} Text',
                      style: GpTypography.titleM.copyWith(color: palette.textPrimary),
                    ),
                  ),
                  FilledButton.icon(
                    onPressed: pageText.trim().isEmpty
                        ? null
                        : () {
                            Clipboard.setData(ClipboardData(text: pageText));
                            Navigator.pop(ctx);
                            ScaffoldMessenger.of(context).showSnackBar(
                              SnackBar(
                                content: Text(isTr ? 'Metin kopyalandı' : 'Text copied to clipboard'),
                              ),
                            );
                          },
                    icon: const Icon(Icons.copy_all, size: 18),
                    label: Text(isTr ? 'Kopyala' : 'Copy All'),
                  ),
                ],
              ),
              const SizedBox(height: GpSpacing.s3),
              Expanded(
                child: Container(
                  padding: const EdgeInsets.all(GpSpacing.s3),
                  decoration: BoxDecoration(
                    color: palette.surfaceOverlay,
                    borderRadius: BorderRadius.circular(12),
                    border: Border.all(color: palette.border),
                  ),
                  child: SingleChildScrollView(
                    child: SelectableText(
                      pageText.trim().isEmpty
                          ? (isTr ? 'Bu sayfada seçilebilir metin bulunamadı.' : 'No selectable text on this page.')
                          : pageText,
                      style: GpTypography.body.copyWith(color: palette.textPrimary),
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ),
    ),
  );
}
