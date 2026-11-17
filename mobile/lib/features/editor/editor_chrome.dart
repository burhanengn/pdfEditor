import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../app/session_state.dart';
import '../../l10n/gp_l10n.g.dart';
import '../../theme/gp_tokens.g.dart';

class GpEditorTopBar extends StatelessWidget {
  const GpEditorTopBar({
    super.key,
    required this.appState,
    required this.layoutSpec,
    required this.l10n,
    required this.onDoneToViewer,
    required this.onUndo,
    required this.onRedo,
    required this.onSave,
    required this.onDeleteSelected,
  });

  final GpAppState appState;
  final GpLayoutSpec layoutSpec;
  final GpL10n l10n;
  final VoidCallback onDoneToViewer;
  final VoidCallback onUndo;
  final VoidCallback onRedo;
  final VoidCallback onSave;
  final VoidCallback onDeleteSelected;

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
    final barHeight = layoutSpec.isTabletOrDesktop
        ? GpComponents.toolbarHeightDesktop
        : GpComponents.toolbarHeightMobile;

    return Container(
      height: barHeight + MediaQuery.paddingOf(context).top,
      padding: EdgeInsets.only(
        top: MediaQuery.paddingOf(context).top,
        left: GpSpacing.s2,
        right: GpSpacing.s2,
      ),
      decoration: BoxDecoration(
        color: palette.surfaceRaised,
        border: Border(bottom: BorderSide(color: palette.borderSubtle)),
      ),
      child: Row(
        children: [
          FilledButton(
            key: const Key('editor-done-btn'),
            onPressed: onDoneToViewer,
            style: FilledButton.styleFrom(
              backgroundColor: palette.accent,
              foregroundColor: palette.accentForeground,
              minimumSize: const Size(72, GpComponents.touchTargetMin),
            ),
            child: Text(l10n.t('action.done')),
          ),
          const SizedBox(width: GpSpacing.s2),
          Expanded(
            child: Row(
              children: [
                Flexible(
                  child: Text(
                    appState.displayName,
                    style: GpTypography.label.copyWith(color: palette.textPrimary),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                if (appState.dirty) ...[
                  const SizedBox(width: 6),
                  layoutSpec.isTabletOrDesktop
                      ? Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(
                            color: palette.warning.withValues(alpha: 0.2),
                            borderRadius: BorderRadius.circular(10),
                          ),
                          child: Text(
                            l10n.t('session.unsavedBadge'),
                            style: GpTypography.caption.copyWith(color: palette.warning),
                          ),
                        )
                      : Container(
                          width: 8,
                          height: 8,
                          decoration: BoxDecoration(
                            color: palette.warning,
                            shape: BoxShape.circle,
                          ),
                        ),
                ],
              ],
            ),
          ),
          IconButton(
            key: const Key('editor-undo-btn'),
            tooltip: l10n.t('action.undo'),
            constraints: const BoxConstraints(
              minWidth: GpComponents.touchTargetMin,
              minHeight: GpComponents.touchTargetMin,
            ),
            onPressed: appState.canUndo ? onUndo : null,
            icon: const Icon(Icons.undo),
          ),
          IconButton(
            key: const Key('editor-redo-btn'),
            tooltip: l10n.t('action.redo'),
            constraints: const BoxConstraints(
              minWidth: GpComponents.touchTargetMin,
              minHeight: GpComponents.touchTargetMin,
            ),
            onPressed: appState.canRedo ? onRedo : null,
            icon: const Icon(Icons.redo),
          ),
          if (appState.selectedElementId != null)
            IconButton(
              key: const Key('editor-delete-btn'),
              tooltip: l10n.t('action.delete'),
              constraints: const BoxConstraints(
                minWidth: GpComponents.touchTargetMin,
                minHeight: GpComponents.touchTargetMin,
              ),
              onPressed: onDeleteSelected,
              icon: Icon(Icons.delete_outline, color: palette.danger),
            ),
          IconButton(
            key: const Key('editor-save-btn'),
            tooltip: l10n.t('action.save'),
            constraints: const BoxConstraints(
              minWidth: GpComponents.touchTargetMin,
              minHeight: GpComponents.touchTargetMin,
            ),
            onPressed: onSave,
            icon: Icon(Icons.save_alt, color: palette.accent),
          ),
        ],
      ),
    );
  }
}

/// Bottom thumb-zone tool dock (>= 44x44 dp targets) (02 §4.3, 03 §3.1).
class GpEditorToolDock extends StatelessWidget {
  const GpEditorToolDock({
    super.key,
    required this.activeTool,
    required this.l10n,
    required this.onSelectTool,
    required this.onOpenSignaturePad,
    required this.onOpenOrganizeSheet,
  });

  final GpEditorTool activeTool;
  final GpL10n l10n;
  final void Function(GpEditorTool tool) onSelectTool;
  final VoidCallback onOpenSignaturePad;
  final VoidCallback onOpenOrganizeSheet;

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;

    Widget buildBtn({
      required Key key,
      required IconData icon,
      required String label,
      required bool selected,
      required VoidCallback onTap,
    }) {
      return Padding(
        padding: const EdgeInsets.symmetric(horizontal: 2),
        child: InkWell(
          key: key,
          onTap: onTap,
          borderRadius: BorderRadius.circular(10),
          child: Container(
            constraints: const BoxConstraints(
              minWidth: GpComponents.primaryTouchTarget,
              minHeight: GpComponents.primaryTouchTarget,
            ),
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            decoration: BoxDecoration(
              color: selected
                  ? palette.accent.withValues(alpha: 0.18)
                  : Colors.transparent,
              borderRadius: BorderRadius.circular(10),
              border: selected ? Border.all(color: palette.accent) : null,
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  icon,
                  size: 20,
                  color: selected ? palette.accent : palette.textPrimary,
                ),
                const SizedBox(height: 2),
                Text(
                  label,
                  style: GpTypography.caption.copyWith(
                    color: selected ? palette.accent : palette.textSecondary,
                  ),
                ),
              ],
            ),
          ),
        ),
      );
    }

    return Container(
      decoration: BoxDecoration(
        color: palette.surfaceRaised,
        border: Border(top: BorderSide(color: palette.borderSubtle)),
      ),
      child: SafeArea(
        top: false,
        child: SingleChildScrollView(
          scrollDirection: Axis.horizontal,
          padding: const EdgeInsets.symmetric(horizontal: GpSpacing.s2, vertical: GpSpacing.s1),
          child: Row(
            children: [
              buildBtn(
                key: const Key('tool-select'),
                icon: Icons.near_me_outlined,
                label: l10n.t('mobile.tool.select'),
                selected: activeTool == GpEditorTool.select,
                onTap: () => onSelectTool(GpEditorTool.select),
              ),
              buildBtn(
                key: const Key('tool-text'),
                icon: Icons.text_fields,
                label: l10n.t('mobile.tool.text'),
                selected: activeTool == GpEditorTool.text,
                onTap: () => onSelectTool(GpEditorTool.text),
              ),
              buildBtn(
                key: const Key('tool-draw'),
                icon: Icons.draw_outlined,
                label: l10n.t('mobile.tool.draw'),
                selected: activeTool == GpEditorTool.draw,
                onTap: () => onSelectTool(GpEditorTool.draw),
              ),
              buildBtn(
                key: const Key('tool-eraser'),
                icon: Icons.auto_fix_normal_outlined,
                label: 'Erase',
                selected: activeTool == GpEditorTool.eraser,
                onTap: () => onSelectTool(GpEditorTool.eraser),
              ),
              buildBtn(
                key: const Key('tool-highlight'),
                icon: Icons.border_color_outlined,
                label: l10n.t('mobile.tool.highlight'),
                selected: activeTool == GpEditorTool.highlight,
                onTap: () => onSelectTool(GpEditorTool.highlight),
              ),
              buildBtn(
                key: const Key('tool-sign'),
                icon: Icons.gesture_outlined,
                label: l10n.t('mobile.tool.signature'),
                selected: activeTool == GpEditorTool.signature,
                onTap: onOpenSignaturePad,
              ),
              buildBtn(
                key: const Key('tool-shape'),
                icon: Icons.crop_square_outlined,
                label: l10n.t('mobile.tool.shape'),
                selected: activeTool == GpEditorTool.shape,
                onTap: () => onSelectTool(GpEditorTool.shape),
              ),
              buildBtn(
                key: const Key('tool-redact'),
                icon: Icons.visibility_off_outlined,
                label: l10n.t('mobile.tool.redact'),
                selected: activeTool == GpEditorTool.redact,
                onTap: () => onSelectTool(GpEditorTool.redact),
              ),
              buildBtn(
                key: const Key('tool-pages'),
                icon: Icons.layers_outlined,
                label: l10n.t('nav.pages'),
                selected: false,
                onTap: onOpenOrganizeSheet,
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Real Flutter `EditableText` editor supporting IME, Turkish keyboard, hardware keyboard, font size & colors (04 §4.5).
class GpInlineTextInspectorBar extends StatefulWidget {
  const GpInlineTextInspectorBar({
    super.key,
    required this.element,
    required this.onUpdate,
    required this.onClose,
  });

  final GpOverlayElement element;
  final void Function(GpOverlayElement updated) onUpdate;
  final VoidCallback onClose;

  @override
  State<GpInlineTextInspectorBar> createState() => _GpInlineTextInspectorBarState();
}

class _GpInlineTextInspectorBarState extends State<GpInlineTextInspectorBar> {
  late final TextEditingController _controller =
      TextEditingController(text: widget.element.text);
  final FocusNode _focusNode = FocusNode();

  @override
  void didUpdateWidget(covariant GpInlineTextInspectorBar oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.element.id != widget.element.id) {
      _controller.text = widget.element.text;
    }
  }

  @override
  void dispose() {
    _controller.dispose();
    _focusNode.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;

    return Container(
      margin: const EdgeInsets.all(GpSpacing.s2),
      padding: const EdgeInsets.all(GpSpacing.s3),
      decoration: BoxDecoration(
        color: palette.surfaceOverlay,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: palette.accent),
        boxShadow: const [BoxShadow(blurRadius: 12, color: Color(0x44000000))],
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
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
                    controller: _controller,
                    focusNode: _focusNode,
                    style: GpTypography.body.copyWith(color: palette.textPrimary),
                    cursorColor: palette.accent,
                    backgroundCursorColor: palette.accent,
                    onChanged: (val) => widget.onUpdate(widget.element.copyWith(text: val)),
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
          const SizedBox(height: GpSpacing.s2),
          Row(
            children: [
              IconButton(
                constraints: const BoxConstraints(
                  minWidth: GpComponents.touchTargetMin,
                  minHeight: GpComponents.touchTargetMin,
                ),
                onPressed: () => widget.onUpdate(
                  widget.element.copyWith(fontSize: math.max(8, widget.element.fontSize - 2)),
                ),
                icon: const Icon(Icons.text_decrease),
              ),
              Text(
                '${widget.element.fontSize.round()} pt',
                style: GpTypography.numeric.copyWith(color: palette.textPrimary),
              ),
              IconButton(
                constraints: const BoxConstraints(
                  minWidth: GpComponents.touchTargetMin,
                  minHeight: GpComponents.touchTargetMin,
                ),
                onPressed: () => widget.onUpdate(
                  widget.element.copyWith(fontSize: math.min(72, widget.element.fontSize + 2)),
                ),
                icon: const Icon(Icons.text_increase),
              ),
              const Spacer(),
              for (final col in const [0xFF0F172A, 0xFF1D4ED8, 0xFFDC2626, 0xFF15803D])
                Padding(
                  padding: const EdgeInsets.only(left: 6),
                  child: InkWell(
                    onTap: () => widget.onUpdate(widget.element.copyWith(colorValue: col)),
                    child: Container(
                      width: 28,
                      height: 28,
                      decoration: BoxDecoration(
                        color: Color(col),
                        shape: BoxShape.circle,
                        border: Border.all(
                          color: widget.element.colorValue == col
                              ? Colors.white
                              : palette.border,
                          width: 2,
                        ),
                      ),
                    ),
                  ),
                ),
            ],
          ),
        ],
      ),
    );
  }
}

/// Interactive signature pad spawning a centered Ghost Signature before "Place here" confirmation (03 §5.7).
Future<List<List<Offset>>?> showGpSignaturePadSheet(
  BuildContext context,
  GpL10n l10n,
) async {
  final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
  final strokes = <List<Offset>>[];
  var activeStroke = <Offset>[];

  return showModalBottomSheet<List<List<Offset>>>(
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
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    l10n.t('mobile.tool.signature'),
                    style: GpTypography.titleM.copyWith(color: palette.textPrimary),
                  ),
                  const SizedBox(height: GpSpacing.s3),
                  Container(
                    height: 180,
                    decoration: BoxDecoration(
                      color: Colors.white,
                      borderRadius: BorderRadius.circular(12),
                      border: Border.all(color: palette.border),
                    ),
                    child: Listener(
                      behavior: HitTestBehavior.opaque,
                      onPointerDown: (e) {
                        setModalState(() {
                          activeStroke = [e.localPosition];
                          strokes.add(activeStroke);
                        });
                      },
                      onPointerMove: (e) {
                        setModalState(() => activeStroke.add(e.localPosition));
                      },
                      child: CustomPaint(
                        painter: _SignaturePadPainter(strokes: strokes),
                      ),
                    ),
                  ),
                  const SizedBox(height: GpSpacing.s3),
                  Row(
                    children: [
                      OutlinedButton(
                        onPressed: () => setModalState(() => strokes.clear()),
                        style: OutlinedButton.styleFrom(
                          minimumSize: const Size(88, GpComponents.primaryTouchTarget),
                        ),
                        child: Text(l10n.t('action.discardSession')),
                      ),
                      const Spacer(),
                      FilledButton(
                        onPressed: strokes.isEmpty
                            ? null
                            : () => Navigator.pop(
                                  ctx,
                                  strokes.map((s) => List<Offset>.from(s)).toList(),
                                ),
                        style: FilledButton.styleFrom(
                          backgroundColor: palette.accent,
                          minimumSize: const Size(128, GpComponents.primaryTouchTarget),
                        ),
                        child: Text(l10n.t('mobile.placeGhost')),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          );
        },
      );
    },
  );
}

class _SignaturePadPainter extends CustomPainter {
  _SignaturePadPainter({required this.strokes});
  final List<List<Offset>> strokes;

  @override
  void paint(Canvas canvas, Size size) {
    final p = Paint()
      ..color = const Color(0xFF1D4ED8)
      ..strokeWidth = 2.6
      ..strokeCap = StrokeCap.round
      ..strokeJoin = StrokeJoin.round
      ..style = PaintingStyle.stroke;

    for (final s in strokes) {
      if (s.isEmpty) continue;
      final path = Path()..moveTo(s.first.dx, s.first.dy);
      for (var i = 1; i < s.length; i++) {
        path.lineTo(s[i].dx, s[i].dy);
      }
      canvas.drawPath(path, p);
    }
  }

  @override
  bool shouldRepaint(covariant _SignaturePadPainter oldDelegate) => true;
}

/// Page organizer / Rotate / Reorder / Delete / Merge modal (M3.1).
Future<void> showGpPageOrganizeSheet({
  required BuildContext context,
  required GpAppState appState,
  required GpL10n l10n,
  required void Function(int index) onRotatePage,
  required void Function(int from, int to) onMovePage,
  required void Function(int index) onDeletePage,
  required VoidCallback onMergePdf,
}) async {
  final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;

  await showModalBottomSheet<void>(
    context: context,
    backgroundColor: palette.surfaceRaised,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(GpComponents.sheetRadius)),
    ),
    builder: (ctx) {
      return SafeArea(
        child: DraggableScrollableSheet(
          expand: false,
          initialChildSize: 0.55,
          minChildSize: 0.35,
          maxChildSize: 0.9,
          builder: (_, scrollCtrl) {
            return Column(
              children: [
                Padding(
                  padding: const EdgeInsets.all(GpSpacing.s4),
                  child: Row(
                    children: [
                      Text(
                        '${l10n.t('nav.pages')} (${appState.pages.length})',
                        style: GpTypography.titleM.copyWith(color: palette.textPrimary),
                      ),
                      const Spacer(),
                      FilledButton.icon(
                        onPressed: () {
                          Navigator.pop(ctx);
                          onMergePdf();
                        },
                        style: FilledButton.styleFrom(
                          backgroundColor: palette.accent,
                          minimumSize: const Size(100, GpComponents.touchTargetMin),
                        ),
                        icon: const Icon(Icons.merge_type),
                        label: const Text('Merge'),
                      ),
                    ],
                  ),
                ),
                Expanded(
                  child: ListView.builder(
                    controller: scrollCtrl,
                    itemCount: appState.pages.length,
                    itemBuilder: (_, idx) {
                      return ListTile(
                        title: Text(
                          '${l10n.t('nav.pages')} ${idx + 1}',
                          style: GpTypography.body.copyWith(color: palette.textPrimary),
                        ),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              constraints: const BoxConstraints(
                                minWidth: GpComponents.touchTargetMin,
                                minHeight: GpComponents.touchTargetMin,
                              ),
                              onPressed: idx > 0 ? () => onMovePage(idx, idx - 1) : null,
                              icon: const Icon(Icons.arrow_upward),
                            ),
                            IconButton(
                              constraints: const BoxConstraints(
                                minWidth: GpComponents.touchTargetMin,
                                minHeight: GpComponents.touchTargetMin,
                              ),
                              onPressed: idx < appState.pages.length - 1
                                  ? () => onMovePage(idx, idx + 1)
                                  : null,
                              icon: const Icon(Icons.arrow_downward),
                            ),
                            IconButton(
                              constraints: const BoxConstraints(
                                minWidth: GpComponents.touchTargetMin,
                                minHeight: GpComponents.touchTargetMin,
                              ),
                              onPressed: () => onRotatePage(idx),
                              icon: const Icon(Icons.rotate_90_degrees_cw),
                            ),
                            IconButton(
                              constraints: const BoxConstraints(
                                minWidth: GpComponents.touchTargetMin,
                                minHeight: GpComponents.touchTargetMin,
                              ),
                              onPressed: appState.pages.length > 1
                                  ? () => onDeletePage(idx)
                                  : null,
                              icon: Icon(Icons.delete_outline, color: palette.danger),
                            ),
                          ],
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
}
