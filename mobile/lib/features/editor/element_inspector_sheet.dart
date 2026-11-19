import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';

import 'package:flutter/material.dart';

import '../../app/session_state.dart';
import '../../l10n/gp_l10n.g.dart';
import '../../platform/file_bridge.dart';
import '../../theme/gp_tokens.g.dart';

const List<int> gpColorSwatches = [
  0xFF0F172A,
  0xFF1E3A8A,
  0xFF1D4ED8,
  0xFF0284C7,
  0xFF15803D,
  0xFFD97706,
  0xFFDC2626,
  0xFF7C3AED,
  0xFFFFFFFF,
];

/// Floating quick toolbar over active selection (preserves `editable-text-field` key for IME & tests).
class GpInlineSelectionBar extends StatefulWidget {
  const GpInlineSelectionBar({
    super.key,
    required this.element,
    required this.l10n,
    required this.onUpdate,
    required this.onOpenFullInspector,
    required this.onDuplicate,
    required this.onDelete,
    required this.onClose,
  });

  final GpOverlayElement element;
  final GpL10n l10n;
  final void Function(GpOverlayElement updated, {bool recordHistory}) onUpdate;
  final VoidCallback onOpenFullInspector;
  final VoidCallback onDuplicate;
  final VoidCallback onDelete;
  final VoidCallback onClose;

  @override
  State<GpInlineSelectionBar> createState() => _GpInlineSelectionBarState();
}

class _GpInlineSelectionBarState extends State<GpInlineSelectionBar> {
  late final TextEditingController _ctrl =
      TextEditingController(text: widget.element.text);
  final FocusNode _focusNode = FocusNode();

  @override
  void didUpdateWidget(covariant GpInlineSelectionBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.element.id != widget.element.id && _ctrl.text != widget.element.text) {
      _ctrl.text = widget.element.text;
    }
  }

  @override
  void dispose() {
    _ctrl.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
    final el = widget.element;

    return Container(
      margin: const EdgeInsets.all(GpSpacing.s2),
      padding: const EdgeInsets.symmetric(horizontal: GpSpacing.s3, vertical: GpSpacing.s2),
      decoration: BoxDecoration(
        color: palette.surfaceOverlay.withValues(alpha: 0.96),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: palette.accent),
        boxShadow: const [BoxShadow(blurRadius: 14, color: Color(0x44000000))],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (el.isTextKind)
            Row(
              children: [
                Expanded(
                  child: Container(
                    padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
                    decoration: BoxDecoration(
                      color: palette.surface,
                      borderRadius: BorderRadius.circular(8),
                      border: Border.all(color: palette.border),
                    ),
                    child: EditableText(
                      key: const Key('editable-text-field'),
                      controller: _ctrl,
                      focusNode: _focusNode,
                      maxLines: 3,
                      style: GpTypography.body.copyWith(color: palette.textPrimary),
                      cursorColor: palette.accent,
                      backgroundCursorColor: palette.accent,
                      onChanged: (val) => widget.onUpdate(
                        el.copyWith(text: val),
                        recordHistory: false,
                      ),
                    ),
                  ),
                ),
                IconButton(
                  constraints: const BoxConstraints(
                    minWidth: GpComponents.touchTargetMin,
                    minHeight: GpComponents.touchTargetMin,
                  ),
                  onPressed: widget.onClose,
                  icon: Icon(Icons.check, color: palette.success),
                ),
              ],
            ),
          Row(
            children: [
              if (el.isTextKind) ...[
                IconButton(
                  constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                  onPressed: () => widget.onUpdate(
                    el.copyWith(fontSize: math.max(8, el.fontSize - 2)),
                  ),
                  icon: const Icon(Icons.text_decrease, size: 19),
                ),
                Text('${el.fontSize.round()}pt',
                    style: GpTypography.numeric.copyWith(color: palette.textPrimary)),
                IconButton(
                  constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                  onPressed: () => widget.onUpdate(
                    el.copyWith(fontSize: math.min(72, el.fontSize + 2)),
                  ),
                  icon: const Icon(Icons.text_increase, size: 19),
                ),
                IconButton(
                  constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                  onPressed: () => widget.onUpdate(el.copyWith(bold: !el.bold)),
                  icon: Icon(
                    Icons.format_bold,
                    size: 19,
                    color: el.bold ? palette.accent : palette.textSecondary,
                  ),
                ),
              ] else ...[
                for (final col in const [0xFF0F172A, 0xFF2563EB, 0xFFDC2626, 0xFF15803D])
                  Padding(
                    padding: const EdgeInsets.only(right: 6),
                    child: InkWell(
                      onTap: () => widget.onUpdate(
                        el.kind == 'highlight'
                            ? el.copyWith(fillColorValue: col)
                            : el.copyWith(colorValue: col),
                      ),
                      child: Container(
                        width: 24,
                        height: 24,
                        decoration: BoxDecoration(
                          color: Color(col),
                          shape: BoxShape.circle,
                          border: Border.all(color: Colors.white, width: 1.5),
                        ),
                      ),
                    ),
                  ),
              ],
              const Spacer(),
              IconButton(
                key: const Key('open-full-inspector-btn'),
                tooltip: widget.l10n.t('mobile.tool.inspect'),
                constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                onPressed: widget.onOpenFullInspector,
                icon: Icon(Icons.tune, color: palette.accent, size: 20),
              ),
              IconButton(
                tooltip: widget.l10n.t('mobile.duplicate'),
                constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                onPressed: widget.onDuplicate,
                icon: Icon(Icons.copy_all_outlined, color: palette.textPrimary, size: 20),
              ),
              IconButton(
                tooltip: widget.l10n.t('action.delete'),
                constraints: const BoxConstraints(minWidth: 40, minHeight: 40),
                onPressed: widget.onDelete,
                icon: Icon(Icons.delete_outline, color: palette.danger, size: 20),
              ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Complete Inspector Bottom Sheet for Text, Shapes, Images, Paths & Signatures (Web RightInspector parity).
Future<void> showGpElementInspectorSheet({
  required BuildContext context,
  required GpOverlayElement initialElement,
  required GpAppState appState,
  required GpL10n l10n,
  required GpFileBridge fileBridge,
  required void Function(GpOverlayElement updated) onUpdate,
  required void Function(Uint8List ttfBytes, String label) onLoadCustomFont,
  required VoidCallback onBringForward,
  required VoidCallback onSendBackward,
  required VoidCallback onDuplicate,
  required VoidCallback onToggleLock,
  required void Function(String scope) onApplyAcrossPages,
  required VoidCallback onDelete,
}) async {
  final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
  var el = initialElement;
  final textCtrl = TextEditingController(text: initialElement.text);
  final isTr = appState.locale == GpLocale.tr;

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
          void commit(GpOverlayElement next) {
            el = next;
            onUpdate(next);
            setModalState(() {});
          }

          final bottomPad = MediaQuery.viewInsetsOf(ctx).bottom;

          return SafeArea(
            child: ConstrainedBox(
              constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(ctx).height * 0.82),
              child: Padding(
                padding: EdgeInsets.fromLTRB(
                  GpSpacing.s4,
                  GpSpacing.s3,
                  GpSpacing.s4,
                  GpSpacing.s3 + bottomPad,
                ),
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      Row(
                        children: [
                          Text(
                            l10n.t('mobile.tool.inspect'),
                            style: GpTypography.titleM.copyWith(color: palette.textPrimary),
                          ),
                          const Spacer(),
                          IconButton(
                            onPressed: () {
                              Navigator.pop(ctx);
                              onToggleLock();
                            },
                            tooltip: el.locked ? l10n.t('mobile.unlock') : l10n.t('mobile.lock'),
                            icon: Icon(
                              el.locked ? Icons.lock : Icons.lock_open,
                              color: el.locked ? palette.warning : palette.textSecondary,
                            ),
                          ),
                          IconButton(
                            onPressed: () => Navigator.pop(ctx),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                      const SizedBox(height: GpSpacing.s2),
                      if (el.isTextKind) ...[
                        TextField(
                          controller: textCtrl,
                          minLines: 2,
                          maxLines: 5,
                          onChanged: (v) => commit(el.copyWith(text: v)),
                          decoration: InputDecoration(
                            labelText: isTr ? 'Metin içeriği' : 'Text content',
                            filled: true,
                            fillColor: palette.surfaceOverlay,
                            border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                          ),
                        ),
                        const SizedBox(height: GpSpacing.s3),
                        Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          children: [
                            for (final fam in [
                              ('DejaVuSans', 'Sans'),
                              ('Serif', 'Serif'),
                              ('Mono', 'Mono'),
                              if (appState.customTtfBytes != null) ('Custom', 'Custom TTF'),
                            ])
                              ChoiceChip(
                                selected: el.fontFamily == fam.$1,
                                label: Text(fam.$2),
                                onSelected: (_) => commit(el.copyWith(fontFamily: fam.$1)),
                              ),
                            ActionChip(
                              avatar: const Icon(Icons.font_download_outlined, size: 16),
                              label: Text(l10n.t('mobile.uploadTtf')),
                              onPressed: () async {
                                final req = await fileBridge.pickFont();
                                if (req == null || req.uris.isEmpty) return;
                                final work = await fileBridge.copyToWorkFile(
                                  sourceUri: req.uris.first,
                                  displayName: req.displayName,
                                );
                                final bytes = await File(work.workPath).readAsBytes();
                                onLoadCustomFont(bytes, work.displayName);
                                commit(el.copyWith(fontFamily: 'Custom'));
                              },
                            ),
                          ],
                        ),
                        const SizedBox(height: GpSpacing.s2),
                        Row(
                          children: [
                            Text(
                              '${el.fontSize.round()} pt',
                              style: GpTypography.label.copyWith(color: palette.textPrimary),
                            ),
                            Expanded(
                              child: Slider(
                                value: el.fontSize.clamp(8.0, 72.0),
                                min: 8,
                                max: 72,
                                onChanged: (v) => commit(el.copyWith(fontSize: v)),
                              ),
                            ),
                            IconButton.filledTonal(
                              onPressed: () => commit(el.copyWith(bold: !el.bold)),
                              isSelected: el.bold,
                              icon: const Icon(Icons.format_bold),
                            ),
                            const SizedBox(width: 4),
                            IconButton.filledTonal(
                              onPressed: () => commit(el.copyWith(italic: !el.italic)),
                              isSelected: el.italic,
                              icon: const Icon(Icons.format_italic),
                            ),
                          ],
                        ),
                        SegmentedButton<String>(
                          segments: const [
                            ButtonSegment(value: 'left', icon: Icon(Icons.format_align_left, size: 18)),
                            ButtonSegment(value: 'center', icon: Icon(Icons.format_align_center, size: 18)),
                            ButtonSegment(value: 'right', icon: Icon(Icons.format_align_right, size: 18)),
                            ButtonSegment(value: 'justify', icon: Icon(Icons.format_align_justify, size: 18)),
                          ],
                          selected: {el.align},
                          onSelectionChanged: (s) => commit(el.copyWith(align: s.first)),
                        ),
                        const SizedBox(height: GpSpacing.s2),
                        _buildColorRow(
                          label: isTr ? 'Yazı Rengi' : 'Text Color',
                          selected: el.colorValue,
                          onSelect: (c) => commit(el.copyWith(colorValue: c)),
                          palette: palette,
                        ),
                        _buildColorRow(
                          label: isTr ? 'Arka Plan' : 'Highlight / Background',
                          selected: el.backgroundColorValue,
                          allowTransparent: true,
                          onSelect: (c) => commit(el.copyWith(backgroundColorValue: c)),
                          palette: palette,
                        ),
                      ],
                      if (el.kind == 'shape' || el.kind == 'path' || el.kind == 'ink') ...[
                        if (el.kind == 'shape') ...[
                          Text(
                            isTr ? 'Şekil Türü' : 'Shape Type',
                            style: GpTypography.caption.copyWith(color: palette.textSecondary),
                          ),
                          const SizedBox(height: 6),
                          Wrap(
                            spacing: 6,
                            children: [
                              for (final st in const [
                                ('rect', Icons.crop_square, 'Rect'),
                                ('ellipse', Icons.circle_outlined, 'Ellipse'),
                                ('triangle', Icons.change_history, 'Triangle'),
                                ('diamond', Icons.diamond_outlined, 'Diamond'),
                                ('arrow', Icons.arrow_forward, 'Arrow'),
                              ])
                                ChoiceChip(
                                  avatar: Icon(st.$2, size: 16),
                                  label: Text(st.$3),
                                  selected: el.shapeType == st.$1,
                                  onSelected: (_) => commit(el.copyWith(shapeType: st.$1)),
                                ),
                            ],
                          ),
                          const SizedBox(height: GpSpacing.s2),
                        ],
                        _buildColorRow(
                          label: isTr ? 'Kenarlık / Çizgi Rengi' : 'Stroke Color',
                          selected: el.colorValue,
                          allowTransparent: el.kind == 'shape',
                          onSelect: (c) => commit(el.copyWith(colorValue: c)),
                          palette: palette,
                        ),
                        if (el.kind == 'shape' || el.kind == 'path')
                          _buildColorRow(
                            label: isTr ? 'Dolgu Rengi' : 'Fill Color',
                            selected: el.fillColorValue,
                            allowTransparent: true,
                            onSelect: (c) => commit(el.copyWith(fillColorValue: c)),
                            palette: palette,
                          ),
                        Row(
                          children: [
                            Text(
                              '${isTr ? "Kalınlık" : "Stroke"}: ${el.strokeWidth.toStringAsFixed(1)}pt',
                              style: GpTypography.caption.copyWith(color: palette.textSecondary),
                            ),
                            Expanded(
                              child: Slider(
                                value: el.strokeWidth.clamp(0.5, 16.0),
                                min: 0.5,
                                max: 16,
                                onChanged: (v) => commit(el.copyWith(strokeWidth: v)),
                              ),
                            ),
                          ],
                        ),
                        if (el.kind == 'shape' || el.kind == 'path')
                          SegmentedButton<String>(
                            segments: [
                              ButtonSegment(value: 'solid', label: Text(isTr ? 'Düz' : 'Solid')),
                              ButtonSegment(value: 'dashed', label: Text(isTr ? 'Kesikli' : 'Dashed')),
                              ButtonSegment(value: 'dotted', label: Text(isTr ? 'Noktalı' : 'Dotted')),
                            ],
                            selected: {el.strokeDash},
                            onSelectionChanged: (s) => commit(el.copyWith(strokeDash: s.first)),
                          ),
                        if (el.kind == 'shape' && el.shapeType == 'rect')
                          Row(
                            children: [
                              Text(
                                '${isTr ? "Köşe" : "Radius"}: ${el.borderRadius.round()}pt',
                                style: GpTypography.caption.copyWith(color: palette.textSecondary),
                              ),
                              Expanded(
                                child: Slider(
                                  value: el.borderRadius.clamp(0.0, 48.0),
                                  min: 0,
                                  max: 48,
                                  onChanged: (v) => commit(el.copyWith(borderRadius: v)),
                                ),
                              ),
                            ],
                          ),
                      ],
                      if (el.kind == 'image' || el.kind == 'imageReplacement') ...[
                        Row(
                          children: [
                            Expanded(
                              child: FilterChip(
                                avatar: const Icon(Icons.flip, size: 16),
                                label: Text(isTr ? 'Yatay Çevir' : 'Flip H'),
                                selected: el.flipX,
                                onSelected: (v) => commit(el.copyWith(flipX: v)),
                              ),
                            ),
                            const SizedBox(width: 8),
                            Expanded(
                              child: FilterChip(
                                avatar: const Icon(Icons.flip, size: 16),
                                label: Text(isTr ? 'Dikey Çevir' : 'Flip V'),
                                selected: el.flipY,
                                onSelected: (v) => commit(el.copyWith(flipY: v)),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: GpSpacing.s2),
                        Text(
                          isTr ? 'Kırpma (Yatay / Dikey)' : 'Crop Trim',
                          style: GpTypography.caption.copyWith(color: palette.textSecondary),
                        ),
                        Row(
                          children: [
                            Expanded(
                              child: RangeSlider(
                                values: RangeValues(
                                  el.cropRect?.left ?? 0.0,
                                  el.cropRect?.right ?? 1.0,
                                ),
                                onChanged: (rv) {
                                  if (rv.end - rv.start < 0.12) return;
                                  final cur = el.cropRect ?? const Rect.fromLTRB(0, 0, 1, 1);
                                  commit(el.copyWith(
                                    cropRect: Rect.fromLTRB(rv.start, cur.top, rv.end, cur.bottom),
                                  ));
                                },
                              ),
                            ),
                            TextButton(
                              onPressed: () => commit(el.copyWith(clearCropRect: true)),
                              child: Text(isTr ? 'Sıfırla' : 'Reset'),
                            ),
                          ],
                        ),
                      ],
                      Row(
                        children: [
                          Text(
                            '${isTr ? "Opaklık" : "Opacity"}: ${(el.opacity * 100).round()}%',
                            style: GpTypography.caption.copyWith(color: palette.textSecondary),
                          ),
                          Expanded(
                            child: Slider(
                              value: el.opacity.clamp(0.1, 1.0),
                              min: 0.1,
                              max: 1.0,
                              onChanged: (v) => commit(el.copyWith(opacity: v)),
                            ),
                          ),
                        ],
                      ),
                      SwitchListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        value: el.behindContent,
                        onChanged: (v) => commit(el.copyWith(behindContent: v)),
                        title: Text(
                          isTr ? 'Sayfa içeriğinin arkasında (Filigran)' : 'Place behind page content',
                          style: GpTypography.body.copyWith(color: palette.textPrimary),
                        ),
                      ),
                      if (appState.pages.length > 1 &&
                          (el.kind == 'image' || el.kind == 'signature' || el.isTextKind))
                        Padding(
                          padding: const EdgeInsets.only(bottom: GpSpacing.s2),
                          child: OutlinedButton.icon(
                            onPressed: () {
                              Navigator.pop(ctx);
                              onApplyAcrossPages('all');
                            },
                            icon: const Icon(Icons.layers_outlined),
                            label: Text(l10n.t('mobile.applyAllPages')),
                          ),
                        ),
                      Row(
                        children: [
                          IconButton(
                            onPressed: () {
                              onBringForward();
                              setModalState(() {});
                            },
                            tooltip: l10n.t('mobile.bringForward'),
                            icon: const Icon(Icons.flip_to_front),
                          ),
                          IconButton(
                            onPressed: () {
                              onSendBackward();
                              setModalState(() {});
                            },
                            tooltip: l10n.t('mobile.sendBackward'),
                            icon: const Icon(Icons.flip_to_back),
                          ),
                          IconButton(
                            onPressed: () {
                              Navigator.pop(ctx);
                              onDuplicate();
                            },
                            tooltip: l10n.t('mobile.duplicate'),
                            icon: const Icon(Icons.copy_all),
                          ),
                          const Spacer(),
                          FilledButton.icon(
                            onPressed: () {
                              Navigator.pop(ctx);
                              onDelete();
                            },
                            style: FilledButton.styleFrom(backgroundColor: palette.danger),
                            icon: const Icon(Icons.delete_outline),
                            label: Text(l10n.t('action.delete')),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
            ),
          );
        },
      );
    },
  );
  textCtrl.dispose();
}

Widget _buildColorRow({
  required String label,
  required int selected,
  bool allowTransparent = false,
  required void Function(int colorVal) onSelect,
  required GpPalette palette,
}) {
  return Padding(
    padding: const EdgeInsets.only(bottom: GpSpacing.s2),
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: GpTypography.caption.copyWith(color: palette.textSecondary)),
        const SizedBox(height: 6),
        SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          child: Row(
            children: [
              if (allowTransparent)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: InkWell(
                    onTap: () => onSelect(0x00000000),
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: (selected >>> 24) == 0 ? palette.accent : palette.border,
                          width: (selected >>> 24) == 0 ? 2.5 : 1,
                        ),
                      ),
                      child: Icon(Icons.block, size: 16, color: palette.textSecondary),
                    ),
                  ),
                ),
              for (final c in gpColorSwatches)
                Padding(
                  padding: const EdgeInsets.only(right: 8),
                  child: InkWell(
                    onTap: () => onSelect(c),
                    borderRadius: BorderRadius.circular(16),
                    child: Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: Color(c),
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: selected == c ? palette.accent : palette.border,
                          width: selected == c ? 2.5 : 1,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    ),
  );
}
