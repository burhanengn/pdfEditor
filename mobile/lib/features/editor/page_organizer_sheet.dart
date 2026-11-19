import 'package:flutter/material.dart';

import '../../app/session_state.dart';
import '../../engine/session_bridge.dart';
import '../../engine/tile_cache.dart';
import '../../l10n/gp_l10n.g.dart';
import '../../theme/gp_tokens.g.dart';
import '../viewer/viewer_chrome.dart';

/// Full-parity Page Organizer: thumbnails grid, multi-select batch actions, rotate CCW/CW/180,
/// duplicate, blank page, merge PDF preserving edits, split/extract PDF, and dynamic page numbering.
Future<void> showGpRichPageOrganizerSheet({
  required BuildContext context,
  required GpAppState appState,
  required GpL10n l10n,
  required GpSessionBridge bridge,
  required GpTileCache tileCache,
  required void Function(int index, int deltaDeg) onRotatePageBy,
  required void Function(int from, int to) onMovePage,
  required void Function(int index) onDuplicatePage,
  required void Function(int index) onInsertBlankAfter,
  required void Function(int index) onDeletePage,
  required void Function(Set<int> indices, int deltaDeg) onBatchRotate,
  required void Function(Set<int> indices) onBatchDelete,
  required Future<void> Function(Set<int> indices) onSplitExtractPages,
  required Future<void> Function() onMergePdf,
  required void Function(GpPageNumberingConfig cfg) onSavePageNumbering,
  required void Function(int index) onJumpToPage,
}) async {
  final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
  final isTr = appState.locale == GpLocale.tr;
  final selectedIndices = <int>{};
  var selectMode = false;

  await showModalBottomSheet<void>(
    context: context,
    backgroundColor: palette.surfaceRaised,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(GpComponents.sheetRadius)),
    ),
    builder: (ctx) {
      return StatefulBuilder(
        builder: (ctx, setModalState) {
          final pages = appState.pages;
          return SafeArea(
            child: DraggableScrollableSheet(
              expand: false,
              initialChildSize: 0.72,
              minChildSize: 0.45,
              maxChildSize: 0.94,
              builder: (_, scrollCtrl) {
                return Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(
                          GpSpacing.s4, GpSpacing.s3, GpSpacing.s3, GpSpacing.s2),
                      child: Row(
                        children: [
                          Text(
                            '${l10n.t('nav.pages')} (${pages.length})',
                            style: GpTypography.titleM.copyWith(color: palette.textPrimary),
                          ),
                          const Spacer(),
                          FilterChip(
                            selected: selectMode,
                            label: Text(isTr ? 'Çoklu Seç' : 'Select'),
                            onSelected: (v) {
                              setModalState(() {
                                selectMode = v;
                                if (!v) selectedIndices.clear();
                              });
                            },
                          ),
                          IconButton(
                            onPressed: () => Navigator.pop(ctx),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                    ),
                    SingleChildScrollView(
                      scrollDirection: Axis.horizontal,
                      padding: const EdgeInsets.symmetric(horizontal: GpSpacing.s4),
                      child: Row(
                        children: [
                          FilledButton.tonalIcon(
                            onPressed: () {
                              Navigator.pop(ctx);
                              onInsertBlankAfter(appState.activePageIndex);
                            },
                            icon: const Icon(Icons.note_add_outlined, size: 18),
                            label: Text(l10n.t('mobile.addBlankPage')),
                          ),
                          const SizedBox(width: 8),
                          FilledButton.tonalIcon(
                            onPressed: () async {
                              Navigator.pop(ctx);
                              await onMergePdf();
                            },
                            icon: const Icon(Icons.merge_type, size: 18),
                            label: Text(l10n.t('mobile.mergePdf')),
                          ),
                          const SizedBox(width: 8),
                          FilledButton.tonalIcon(
                            onPressed: () async {
                              Navigator.pop(ctx);
                              await showGpPageNumberingSheet(
                                context: context,
                                initialConfig: appState.pageNumbering,
                                l10n: l10n,
                                isTr: isTr,
                                onSave: onSavePageNumbering,
                              );
                            },
                            icon: const Icon(Icons.format_list_numbered, size: 18),
                            label: Text(l10n.t('mobile.pageNumbers')),
                          ),
                        ],
                      ),
                    ),
                    if (selectMode && selectedIndices.isNotEmpty)
                      Container(
                        margin: const EdgeInsets.symmetric(
                            horizontal: GpSpacing.s4, vertical: GpSpacing.s2),
                        padding: const EdgeInsets.symmetric(horizontal: GpSpacing.s3, vertical: 6),
                        decoration: BoxDecoration(
                          color: palette.accent.withValues(alpha: 0.14),
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: palette.accent),
                        ),
                        child: Row(
                          children: [
                            Text(
                              '${selectedIndices.length} ${isTr ? "seçildi" : "selected"}',
                              style: GpTypography.label.copyWith(color: palette.accent),
                            ),
                            const Spacer(),
                            IconButton(
                              onPressed: () {
                                Navigator.pop(ctx);
                                onBatchRotate(Set.of(selectedIndices), 90);
                              },
                              icon: const Icon(Icons.rotate_90_degrees_cw, size: 20),
                            ),
                            IconButton(
                              onPressed: () async {
                                final copy = Set.of(selectedIndices);
                                Navigator.pop(ctx);
                                await onSplitExtractPages(copy);
                              },
                              tooltip: l10n.t('mobile.splitPdf'),
                              icon: const Icon(Icons.call_split, size: 20),
                            ),
                            IconButton(
                              onPressed: pages.length - selectedIndices.length >= 1
                                  ? () {
                                      Navigator.pop(ctx);
                                      onBatchDelete(Set.of(selectedIndices));
                                    }
                                  : null,
                              icon: Icon(Icons.delete_outline, color: palette.danger, size: 20),
                            ),
                          ],
                        ),
                      ),
                    const SizedBox(height: GpSpacing.s2),
                    Expanded(
                      child: GridView.builder(
                        controller: scrollCtrl,
                        padding: const EdgeInsets.all(GpSpacing.s3),
                        gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
                          crossAxisCount: 2,
                          mainAxisSpacing: GpSpacing.s3,
                          crossAxisSpacing: GpSpacing.s3,
                          childAspectRatio: 0.68,
                        ),
                        itemCount: pages.length,
                        itemBuilder: (_, idx) {
                          final pg = pages[idx];
                          final isSelected = selectedIndices.contains(idx);
                          final isActive = idx == appState.activePageIndex;

                          return InkWell(
                            onTap: () {
                              if (selectMode) {
                                setModalState(() {
                                  if (isSelected) {
                                    selectedIndices.remove(idx);
                                  } else {
                                    selectedIndices.add(idx);
                                  }
                                });
                              } else {
                                Navigator.pop(ctx);
                                onJumpToPage(idx);
                              }
                            },
                            onLongPress: () {
                              setModalState(() {
                                selectMode = true;
                                selectedIndices.add(idx);
                              });
                            },
                            borderRadius: BorderRadius.circular(12),
                            child: Container(
                              decoration: BoxDecoration(
                                color: palette.surfaceOverlay,
                                borderRadius: BorderRadius.circular(12),
                                border: Border.all(
                                  color: isSelected || isActive ? palette.accent : palette.border,
                                  width: isSelected || isActive ? 2 : 1,
                                ),
                              ),
                              padding: const EdgeInsets.all(8),
                              child: Column(
                                children: [
                                  Expanded(
                                    child: ClipRRect(
                                      borderRadius: BorderRadius.circular(6),
                                      child: Stack(
                                        fit: StackFit.expand,
                                        children: [
                                          if (appState.docId != null && pg.sourceDocId != 'blank')
                                            GpPageThumbnailPreview(
                                              docId: pg.sourceDocId,
                                              page: pg,
                                              themeName: appState.theme.name,
                                              darkPaperInvert: appState.darkPaperInvert,
                                              bridge: bridge,
                                              tileCache: tileCache,
                                            )
                                          else
                                            Container(
                                              color: Colors.white,
                                              alignment: Alignment.center,
                                              child: Text(
                                                '${idx + 1}',
                                                style: GpTypography.titleL.copyWith(color: Colors.black54),
                                              ),
                                            ),
                                          Positioned(
                                            left: 6,
                                            top: 6,
                                            child: CircleAvatar(
                                              radius: 13,
                                              backgroundColor: isSelected
                                                  ? palette.accent
                                                  : const Color(0xCC0F172A),
                                              child: isSelected
                                                  ? const Icon(Icons.check, size: 15, color: Colors.white)
                                                  : Text(
                                                      '${idx + 1}',
                                                      style: const TextStyle(color: Colors.white, fontSize: 11),
                                                    ),
                                            ),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                  const SizedBox(height: 6),
                                  Row(
                                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                                    children: [
                                      IconButton(
                                        visualDensity: VisualDensity.compact,
                                        constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
                                        onPressed: idx > 0
                                            ? () {
                                                onMovePage(idx, idx - 1);
                                                Navigator.pop(ctx);
                                              }
                                            : null,
                                        icon: const Icon(Icons.chevron_left, size: 18),
                                      ),
                                      IconButton(
                                        visualDensity: VisualDensity.compact,
                                        constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
                                        onPressed: () {
                                          onRotatePageBy(idx, 90);
                                          Navigator.pop(ctx);
                                        },
                                        icon: const Icon(Icons.rotate_right, size: 18),
                                      ),
                                      PopupMenuButton<String>(
                                        padding: EdgeInsets.zero,
                                        icon: const Icon(Icons.more_horiz, size: 18),
                                        onSelected: (action) async {
                                          Navigator.pop(ctx);
                                          if (action == 'ccw') onRotatePageBy(idx, -90);
                                          if (action == '180') onRotatePageBy(idx, 180);
                                          if (action == 'dup') onDuplicatePage(idx);
                                          if (action == 'blank') onInsertBlankAfter(idx);
                                          if (action == 'extract') await onSplitExtractPages({idx});
                                          if (action == 'del') onDeletePage(idx);
                                        },
                                        itemBuilder: (_) => [
                                          PopupMenuItem(
                                            value: 'ccw',
                                            child: Text(isTr ? '90° Sola Döndür' : 'Rotate 90° CCW'),
                                          ),
                                          PopupMenuItem(
                                            value: '180',
                                            child: Text(isTr ? '180° Döndür' : 'Rotate 180°'),
                                          ),
                                          PopupMenuItem(
                                            value: 'dup',
                                            child: Text(l10n.t('mobile.duplicate')),
                                          ),
                                          PopupMenuItem(
                                            value: 'blank',
                                            child: Text(l10n.t('mobile.addBlankPage')),
                                          ),
                                          PopupMenuItem(
                                            value: 'extract',
                                            child: Text(l10n.t('mobile.splitPdf')),
                                          ),
                                          if (pages.length > 1)
                                            PopupMenuItem(
                                              value: 'del',
                                              child: Text(
                                                l10n.t('action.delete'),
                                                style: TextStyle(color: palette.danger),
                                              ),
                                            ),
                                        ],
                                      ),
                                      IconButton(
                                        visualDensity: VisualDensity.compact,
                                        constraints: const BoxConstraints(minWidth: 34, minHeight: 34),
                                        onPressed: idx < pages.length - 1
                                            ? () {
                                                onMovePage(idx, idx + 1);
                                                Navigator.pop(ctx);
                                              }
                                            : null,
                                        icon: const Icon(Icons.chevron_right, size: 18),
                                      ),
                                    ],
                                  ),
                                ],
                              ),
                            ),
                          );
                        },
                      ),
                    ),
                  ],
                );
              },
            ),
          );
        },
      );
    },
  );
}

Future<void> showGpPageNumberingSheet({
  required BuildContext context,
  required GpPageNumberingConfig initialConfig,
  required GpL10n l10n,
  required bool isTr,
  required void Function(GpPageNumberingConfig cfg) onSave,
}) async {
  final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
  var cfg = initialConfig;

  await showModalBottomSheet<void>(
    context: context,
    backgroundColor: palette.surfaceRaised,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(GpComponents.sheetRadius)),
    ),
    builder: (ctx) {
      return StatefulBuilder(
        builder: (ctx, setModalState) {
          return SafeArea(
            child: Padding(
              padding: const EdgeInsets.all(GpSpacing.s4),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      value: cfg.enabled,
                      onChanged: (v) => setModalState(() => cfg = cfg.copyWith(enabled: v)),
                      title: Text(
                        l10n.t('mobile.pageNumbers'),
                        style: GpTypography.titleM.copyWith(color: palette.textPrimary),
                      ),
                    ),
                    Text(
                      isTr ? 'Konum' : 'Position',
                      style: GpTypography.caption.copyWith(color: palette.textSecondary),
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final pos in const [
                          ('bottom-center', 'Alt Orta'),
                          ('bottom-right', 'Alt Sağ'),
                          ('bottom-left', 'Alt Sol'),
                          ('top-center', 'Üst Orta'),
                          ('top-right', 'Üst Sağ'),
                          ('top-left', 'Üst Sol'),
                        ])
                          ChoiceChip(
                            label: Text(pos.$2),
                            selected: cfg.position == pos.$1,
                            onSelected: (_) => setModalState(() => cfg = cfg.copyWith(position: pos.$1)),
                          ),
                      ],
                    ),
                    const SizedBox(height: GpSpacing.s3),
                    Text(
                      isTr ? 'Biçim' : 'Format',
                      style: GpTypography.caption.copyWith(color: palette.textSecondary),
                    ),
                    const SizedBox(height: 6),
                    Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final fmt in const [
                          ('number', '1'),
                          ('number-of-total', '1 / N'),
                          ('page-number', 'Sayfa 1'),
                          ('page-number-of-total', 'Sayfa 1 / N'),
                          ('roman-lower', 'i, ii'),
                          ('roman-upper', 'I, II'),
                        ])
                          ChoiceChip(
                            label: Text(fmt.$2),
                            selected: cfg.format == fmt.$1,
                            onSelected: (_) => setModalState(() => cfg = cfg.copyWith(format: fmt.$1)),
                          ),
                      ],
                    ),
                    const SizedBox(height: GpSpacing.s3),
                    Row(
                      children: [
                        Text(
                          '${isTr ? "Başlangıç Sayfası" : "Start Page"}: ${cfg.startFromPage}',
                          style: GpTypography.caption,
                        ),
                        Expanded(
                          child: Slider(
                            value: cfg.startFromPage.toDouble().clamp(1, 20),
                            min: 1,
                            max: 20,
                            divisions: 19,
                            onChanged: (v) => setModalState(
                              () => cfg = cfg.copyWith(startFromPage: v.round()),
                            ),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: GpSpacing.s2),
                    FilledButton(
                      onPressed: () {
                        onSave(cfg);
                        Navigator.pop(ctx);
                      },
                      style: FilledButton.styleFrom(
                        backgroundColor: palette.accent,
                        minimumSize: const Size.fromHeight(GpComponents.primaryTouchTarget),
                      ),
                      child: Text(l10n.t('action.apply')),
                    ),
                  ],
                ),
              ),
            ),
          );
        },
      );
    },
  );
}
