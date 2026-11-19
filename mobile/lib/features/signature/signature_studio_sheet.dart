import 'dart:async';
import 'dart:io';
import 'dart:math' as math;
import 'dart:typed_data';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';

import '../../app/session_state.dart';
import '../../l10n/gp_l10n.g.dart';
import '../../platform/file_bridge.dart';
import '../../theme/gp_tokens.g.dart';

class _TimedPt {
  const _TimedPt(this.pos, this.tMs);
  final Offset pos;
  final double tMs;
}

/// Signature & Paraf (Initials) Studio matching Web SignatureModal.tsx (Draw + Realistic Ink, Type, Upload + Bg Removal, Local Vault).
Future<GpGhostSignature?> showGpSignatureStudioSheet({
  required BuildContext context,
  required GpAppState appState,
  required GpL10n l10n,
  required GpFileBridge fileBridge,
  required void Function(GpSavedSignature sig) onSaveToVault,
  required void Function(String id) onDeleteFromVault,
}) async {
  final palette = Theme.of(context).extension<GpPalette>() ?? GpPalette.dark;
  final isTr = appState.locale == GpLocale.tr;

  var isParaf = false;
  var activeTab = 0; // 0: Draw, 1: Type, 2: Upload, 3: Vault
  var realisticInk = true;
  var inkColorValue = 0xFF0F172A;
  var saveToVault = true;
  var removeWhiteBg = true;
  var busyProcessing = false;

  final drawnStrokes = <List<_TimedPt>>[];
  var activeStroke = <_TimedPt>[];

  final typedCtrl = TextEditingController();
  var typedStyleIdx = 0;

  Uint8List? rawUploadBytes;
  Uint8List? cleanedUploadBytes;

  String toHex(int c) => '#${(c & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';

  List<GpSignatureSvgPath> buildVectorSvgPaths(
    List<List<_TimedPt>> strokes,
    double width,
    double height,
  ) {
    final hex = toHex(inkColorValue);
    if (!realisticInk) {
      return [
        for (final s in strokes)
          if (s.isNotEmpty)
            GpSignatureSvgPath(
              d: _smoothSvgPathD(s.map((e) => e.pos).toList()),
              stroke: hex,
              strokeWidth: 2.6,
            ),
      ];
    }

    // Velocity-sensitive variable-width ink contour ribbons (matching Web realisticInk.ts).
    final out = <GpSignatureSvgPath>[];
    for (final stroke in strokes) {
      if (stroke.length < 2) {
        if (stroke.length == 1) {
          final p = stroke.first.pos;
          out.add(GpSignatureSvgPath(
            d: 'M ${(p.dx - 1.5).toStringAsFixed(1)} ${p.dy.toStringAsFixed(1)} '
                'L ${(p.dx + 1.5).toStringAsFixed(1)} ${p.dy.toStringAsFixed(1)}',
            stroke: hex,
            strokeWidth: 3.0,
          ));
        }
        continue;
      }
      final leftPts = <Offset>[];
      final rightPts = <Offset>[];
      var lastRadius = 1.6;
      for (var i = 0; i < stroke.length; i++) {
        final cur = stroke[i];
        final prev = i > 0 ? stroke[i - 1] : cur;
        final next = i + 1 < stroke.length ? stroke[i + 1] : cur;
        final dist = (cur.pos - prev.pos).distance;
        final dt = math.max(4.0, cur.tMs - prev.tMs);
        final speed = dist / dt; // px / ms
        final progress = i / (stroke.length - 1);
        final taper = math.min(
          1.0,
          math.min(progress * 6.0 + 0.35, (1.0 - progress) * 5.0 + 0.3),
        );
        final rawR = (2.7 - speed * 0.85).clamp(0.85, 2.9) * taper;
        final radius = lastRadius * 0.65 + rawR * 0.35;
        lastRadius = radius;

        var tangent = next.pos - prev.pos;
        final len = tangent.distance;
        if (len < 0.001) {
          tangent = const Offset(1, 0);
        } else {
          tangent = tangent / len;
        }
        final normal = Offset(-tangent.dy, tangent.dx);
        leftPts.add(cur.pos + normal * radius);
        rightPts.add(cur.pos - normal * radius);
      }
      final contour = <Offset>[...leftPts, ...rightPts.reversed];
      if (contour.length >= 3) {
        final d = '${_smoothSvgPathD(contour)} Z';
        out.add(GpSignatureSvgPath(d: d, fill: hex, stroke: hex, strokeWidth: 0.4));
      }
    }
    return out;
  }

  Future<Uint8List?> renderTypedSignaturePng(
    String text,
    int styleIdx,
    int colorVal,
    bool paraf,
  ) async {
    final trimmed = text.trim();
    if (trimmed.isEmpty) return null;
    final w = paraf ? 360 : 540;
    const h = 180;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    final family = switch (styleIdx) {
      0 => 'serif',
      1 => 'serif',
      2 => 'sans-serif',
      _ => 'monospace',
    };
    final italic = styleIdx == 0 || styleIdx == 1;
    final bold = styleIdx == 2;
    final tp = TextPainter(
      text: TextSpan(
        text: trimmed,
        style: TextStyle(
          color: Color(colorVal),
          fontSize: paraf ? 68 : 54,
          fontFamily: family,
          fontStyle: italic ? FontStyle.italic : FontStyle.normal,
          fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
        ),
      ),
      textDirection: TextDirection.ltr,
      textAlign: TextAlign.center,
    )..layout(maxWidth: w - 24);
    tp.paint(
      canvas,
      Offset((w - tp.width) * 0.5, (h - tp.height) * 0.5),
    );
    final pic = recorder.endRecording();
    final img = await pic.toImage(w, h);
    pic.dispose();
    final data = await img.toByteData(format: ui.ImageByteFormat.png);
    img.dispose();
    return data?.buffer.asUint8List();
  }

  final res = await showModalBottomSheet<GpGhostSignature>(
    context: context,
    backgroundColor: palette.surfaceRaised,
    isScrollControlled: true,
    shape: const RoundedRectangleBorder(
      borderRadius: BorderRadius.vertical(top: Radius.circular(GpComponents.sheetRadius)),
    ),
    builder: (ctx) {
      return StatefulBuilder(
        builder: (ctx, setModalState) {
          final bottomInset = MediaQuery.viewInsetsOf(ctx).bottom;
          const padW = 300.0;
          const padH = 170.0;
          final plainStrokes = drawnStrokes
              .map((s) => s.map((e) => e.pos).toList())
              .toList();

          Future<void> submitDrawn() async {
            if (drawnStrokes.isEmpty) return;
            final svgPaths = buildVectorSvgPaths(drawnStrokes, padW, padH);
            final id = 'sig_${DateTime.now().millisecondsSinceEpoch}';
            final label = isParaf ? l10n.t('mobile.sig.parafTab') : l10n.t('mobile.sig.signatureTab');
            if (saveToVault) {
              onSaveToVault(GpSavedSignature(
                id: id,
                label: label,
                isParaf: isParaf,
                strokes: plainStrokes,
                svgPaths: svgPaths,
                realisticInk: realisticInk,
                colorValue: inkColorValue,
                viewBoxW: padW,
                viewBoxH: padH,
                createdAtMs: DateTime.now().millisecondsSinceEpoch,
              ));
            }
            if (!ctx.mounted) return;
            Navigator.pop(
              ctx,
              GpGhostSignature(
                label: label,
                strokes: plainStrokes,
                centerPdf: const Offset(297, 421),
                sizePdf: isParaf ? const Size(86, 48) : const Size(168, 76),
                isParaf: isParaf,
                realisticInk: realisticInk,
                colorValue: inkColorValue,
                svgPaths: svgPaths,
                viewBoxSize: const Size(padW, padH),
                signatureId: id,
              ),
            );
          }

          Future<void> submitTyped() async {
            final bytes = await renderTypedSignaturePng(
              typedCtrl.text,
              typedStyleIdx,
              inkColorValue,
              isParaf,
            );
            if (bytes == null) return;
            final id = 'sig_${DateTime.now().millisecondsSinceEpoch}';
            final label = typedCtrl.text.trim();
            if (saveToVault) {
              onSaveToVault(GpSavedSignature(
                id: id,
                label: label,
                isParaf: isParaf,
                imageBytes: bytes,
                realisticInk: false,
                colorValue: inkColorValue,
                viewBoxW: isParaf ? 360 : 540,
                viewBoxH: 180,
                createdAtMs: DateTime.now().millisecondsSinceEpoch,
              ));
            }
            if (!ctx.mounted) return;
            Navigator.pop(
              ctx,
              GpGhostSignature(
                label: label,
                strokes: const [],
                centerPdf: const Offset(297, 421),
                sizePdf: isParaf ? const Size(92, 46) : const Size(180, 62),
                isParaf: isParaf,
                realisticInk: false,
                colorValue: inkColorValue,
                imageBytes: bytes,
                viewBoxSize: Size(isParaf ? 360 : 540, 180),
                signatureId: id,
              ),
            );
          }

          Future<void> pickSignaturePhoto() async {
            setModalState(() => busyProcessing = true);
            try {
              final req = await fileBridge.pickImage(allowMultiple: false);
              if (req == null || req.uris.isEmpty) return;
              final work = await fileBridge.copyToWorkFile(
                sourceUri: req.uris.first,
                displayName: req.displayName,
              );
              final bytes = await File(work.workPath).readAsBytes();
              final cleaned = await _stripPaperBackgroundPng(bytes);
              rawUploadBytes = bytes;
              cleanedUploadBytes = cleaned;
            } finally {
              if (ctx.mounted) setModalState(() => busyProcessing = false);
            }
          }

          Future<void> submitUploaded() async {
            final chosen = removeWhiteBg ? (cleanedUploadBytes ?? rawUploadBytes) : rawUploadBytes;
            if (chosen == null || chosen.isEmpty) return;
            final id = 'sig_${DateTime.now().millisecondsSinceEpoch}';
            final label = isParaf ? l10n.t('mobile.sig.parafTab') : l10n.t('mobile.sig.signatureTab');
            if (saveToVault) {
              onSaveToVault(GpSavedSignature(
                id: id,
                label: label,
                isParaf: isParaf,
                imageBytes: chosen,
                realisticInk: false,
                colorValue: inkColorValue,
                viewBoxW: 300,
                viewBoxH: 140,
                createdAtMs: DateTime.now().millisecondsSinceEpoch,
              ));
            }
            if (!ctx.mounted) return;
            Navigator.pop(
              ctx,
              GpGhostSignature(
                label: label,
                strokes: const [],
                centerPdf: const Offset(297, 421),
                sizePdf: isParaf ? const Size(90, 50) : const Size(168, 78),
                isParaf: isParaf,
                realisticInk: false,
                imageBytes: chosen,
                signatureId: id,
              ),
            );
          }

          return SafeArea(
            child: Padding(
              padding: EdgeInsets.fromLTRB(
                GpSpacing.s4,
                GpSpacing.s3,
                GpSpacing.s4,
                GpSpacing.s3 + bottomInset,
              ),
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Row(
                      children: [
                        Expanded(
                          child: SegmentedButton<bool>(
                            segments: [
                              ButtonSegment(
                                value: false,
                                label: Text(l10n.t('mobile.sig.signatureTab')),
                              ),
                              ButtonSegment(
                                value: true,
                                label: Text(l10n.t('mobile.sig.parafTab')),
                              ),
                            ],
                            selected: {isParaf},
                            onSelectionChanged: (s) => setModalState(() => isParaf = s.first),
                          ),
                        ),
                        IconButton(
                          onPressed: () => Navigator.pop(ctx),
                          icon: Icon(Icons.close, color: palette.textSecondary),
                        ),
                      ],
                    ),
                    const SizedBox(height: GpSpacing.s2),
                    SegmentedButton<int>(
                      segments: [
                        ButtonSegment(value: 0, label: Text(l10n.t('mobile.sig.draw'))),
                        ButtonSegment(value: 1, label: Text(l10n.t('mobile.sig.type'))),
                        ButtonSegment(value: 2, label: Text(l10n.t('mobile.sig.upload'))),
                        ButtonSegment(
                          value: 3,
                          label: Text('${l10n.t('mobile.sig.vault')} (${appState.savedSignatures.length})'),
                        ),
                      ],
                      selected: {activeTab},
                      onSelectionChanged: (s) => setModalState(() => activeTab = s.first),
                    ),
                    const SizedBox(height: GpSpacing.s3),
                    if (activeTab == 0 || activeTab == 1)
                      Padding(
                        padding: const EdgeInsets.only(bottom: GpSpacing.s2),
                        child: Wrap(
                          spacing: 8,
                          runSpacing: 8,
                          alignment: WrapAlignment.spaceBetween,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [
                            Row(
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                for (final col in const [
                                  0xFF0F172A,
                                  0xFF1E3A8A,
                                  0xFF1D4ED8,
                                  0xFFDC2626,
                                  0xFF15803D,
                                ])
                                  Padding(
                                    padding: const EdgeInsets.only(right: 8),
                                    child: InkWell(
                                      onTap: () => setModalState(() => inkColorValue = col),
                                      borderRadius: BorderRadius.circular(16),
                                      child: Container(
                                        width: 28,
                                        height: 28,
                                        decoration: BoxDecoration(
                                          color: Color(col),
                                          shape: BoxShape.circle,
                                          border: Border.all(
                                            color: inkColorValue == col ? palette.accent : palette.border,
                                            width: inkColorValue == col ? 2.5 : 1,
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                              ],
                            ),
                            if (activeTab == 0)
                              FilterChip(
                                selected: realisticInk,
                                label: Text(
                                  l10n.t('mobile.sig.realisticInk'),
                                  style: GpTypography.caption,
                                ),
                                onSelected: (v) => setModalState(() => realisticInk = v),
                              ),
                          ],
                        ),
                      ),
                    if (activeTab == 0) ...[
                      Container(
                        height: padH,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(12),
                          border: Border.all(color: palette.border),
                        ),
                        child: LayoutBuilder(
                          builder: (_, c) {
                            return Listener(
                              behavior: HitTestBehavior.opaque,
                              onPointerDown: (e) {
                                final clamped = Offset(
                                  e.localPosition.dx.clamp(0, c.maxWidth) * (padW / c.maxWidth),
                                  e.localPosition.dy.clamp(0, c.maxHeight) * (padH / c.maxHeight),
                                );
                                setModalState(() {
                                  activeStroke = [_TimedPt(clamped, e.timeStamp.inMicroseconds / 1000.0)];
                                  drawnStrokes.add(activeStroke);
                                });
                              },
                              onPointerMove: (e) {
                                final clamped = Offset(
                                  e.localPosition.dx.clamp(0, c.maxWidth) * (padW / c.maxWidth),
                                  e.localPosition.dy.clamp(0, c.maxHeight) * (padH / c.maxHeight),
                                );
                                setModalState(() {
                                  activeStroke.add(_TimedPt(clamped, e.timeStamp.inMicroseconds / 1000.0));
                                });
                              },
                              child: CustomPaint(
                                size: Size.infinite,
                                painter: _StudioPadPainter(
                                  strokes: plainStrokes,
                                  color: Color(inkColorValue),
                                  realisticInk: realisticInk,
                                ),
                              ),
                            );
                          },
                        ),
                      ),
                      CheckboxListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        value: saveToVault,
                        onChanged: (v) => setModalState(() => saveToVault = v ?? true),
                        title: Text(
                          isTr ? 'Sonraki kullanımlar için kaydet' : 'Save for future use',
                          style: GpTypography.caption.copyWith(color: palette.textSecondary),
                        ),
                      ),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        alignment: WrapAlignment.spaceBetween,
                        crossAxisAlignment: WrapCrossAlignment.center,
                        children: [
                          Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              OutlinedButton(
                                onPressed: drawnStrokes.isEmpty
                                    ? null
                                    : () => setModalState(() => drawnStrokes.removeLast()),
                                child: Text(l10n.t('action.undo')),
                              ),
                              const SizedBox(width: 8),
                              OutlinedButton(
                                onPressed: drawnStrokes.isEmpty
                                    ? null
                                    : () => setModalState(() => drawnStrokes.clear()),
                                child: Text(l10n.t('action.discardSession')),
                              ),
                            ],
                          ),
                          FilledButton(
                            onPressed: drawnStrokes.isEmpty ? null : submitDrawn,
                            style: FilledButton.styleFrom(
                              backgroundColor: palette.accent,
                              minimumSize: const Size(124, GpComponents.primaryTouchTarget),
                            ),
                            child: Text(l10n.t('mobile.placeGhost')),
                          ),
                        ],
                      ),
                    ] else if (activeTab == 1) ...[
                      TextField(
                        controller: typedCtrl,
                        onChanged: (_) => setModalState(() {}),
                        decoration: InputDecoration(
                          hintText: isParaf ? 'B.E.' : (isTr ? 'Adınız Soyadınız' : 'Full Name'),
                          filled: true,
                          fillColor: palette.surfaceOverlay,
                          border: OutlineInputBorder(borderRadius: BorderRadius.circular(10)),
                        ),
                      ),
                      const SizedBox(height: GpSpacing.s2),
                      Wrap(
                        spacing: 8,
                        children: [
                          for (final entry in const [
                            (0, 'El Yazısı Serif'),
                            (1, 'Akademik İtalik'),
                            (2, 'Modern Kalın'),
                            (3, 'Mono'),
                          ])
                            ChoiceChip(
                              selected: typedStyleIdx == entry.$1,
                              label: Text(entry.$2),
                              onSelected: (_) => setModalState(() => typedStyleIdx = entry.$1),
                            ),
                        ],
                      ),
                      const SizedBox(height: GpSpacing.s3),
                      Container(
                        height: 86,
                        alignment: Alignment.center,
                        decoration: BoxDecoration(
                          color: Colors.white,
                          borderRadius: BorderRadius.circular(10),
                          border: Border.all(color: palette.border),
                        ),
                        child: Text(
                          typedCtrl.text.trim().isEmpty
                              ? (isParaf ? 'B.E.' : 'gullacpdf')
                              : typedCtrl.text,
                          style: TextStyle(
                            color: Color(inkColorValue),
                            fontSize: 30,
                            fontFamily: typedStyleIdx <= 1 ? 'serif' : (typedStyleIdx == 3 ? 'monospace' : 'sans-serif'),
                            fontStyle: typedStyleIdx <= 1 ? FontStyle.italic : FontStyle.normal,
                            fontWeight: typedStyleIdx == 2 ? FontWeight.w700 : FontWeight.w500,
                          ),
                        ),
                      ),
                      const SizedBox(height: GpSpacing.s3),
                      FilledButton(
                        onPressed: typedCtrl.text.trim().isEmpty ? null : submitTyped,
                        style: FilledButton.styleFrom(
                          backgroundColor: palette.accent,
                          minimumSize: const Size.fromHeight(GpComponents.primaryTouchTarget),
                        ),
                        child: Text(l10n.t('mobile.placeGhost')),
                      ),
                    ] else if (activeTab == 2) ...[
                      OutlinedButton.icon(
                        onPressed: busyProcessing ? null : pickSignaturePhoto,
                        icon: const Icon(Icons.photo_library_outlined),
                        label: Text(isTr ? 'İmza / Paraf Görseli Seç' : 'Choose Signature Image'),
                      ),
                      SwitchListTile(
                        dense: true,
                        contentPadding: EdgeInsets.zero,
                        value: removeWhiteBg,
                        onChanged: (v) => setModalState(() => removeWhiteBg = v),
                        title: Text(
                          l10n.t('mobile.sig.removeBg'),
                          style: GpTypography.body.copyWith(color: palette.textPrimary),
                        ),
                      ),
                      if (rawUploadBytes != null)
                        Container(
                          height: 110,
                          margin: const EdgeInsets.only(bottom: GpSpacing.s2),
                          padding: const EdgeInsets.all(8),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(10),
                            border: Border.all(color: palette.border),
                          ),
                          child: Image.memory(
                            removeWhiteBg ? (cleanedUploadBytes ?? rawUploadBytes!) : rawUploadBytes!,
                            fit: BoxFit.contain,
                          ),
                        ),
                      FilledButton(
                        onPressed: rawUploadBytes == null ? null : submitUploaded,
                        style: FilledButton.styleFrom(
                          backgroundColor: palette.accent,
                          minimumSize: const Size.fromHeight(GpComponents.primaryTouchTarget),
                        ),
                        child: Text(l10n.t('mobile.placeGhost')),
                      ),
                    ] else ...[
                      if (appState.savedSignatures.isEmpty)
                        Padding(
                          padding: const EdgeInsets.symmetric(vertical: 28),
                          child: Text(
                            isTr
                                ? 'Henüz kayıtlı imza veya paraf yok.'
                                : 'No saved signatures yet.',
                            textAlign: TextAlign.center,
                            style: GpTypography.body.copyWith(color: palette.textSecondary),
                          ),
                        )
                      else
                        ConstrainedBox(
                          constraints: const BoxConstraints(maxHeight: 240),
                          child: ListView.separated(
                            shrinkWrap: true,
                            itemCount: appState.savedSignatures.length,
                            separatorBuilder: (_, __) => const SizedBox(height: 8),
                            itemBuilder: (_, idx) {
                              final sig = appState.savedSignatures[idx];
                              return ListTile(
                                tileColor: palette.surfaceOverlay,
                                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                                leading: Container(
                                  width: 68,
                                  height: 40,
                                  padding: const EdgeInsets.all(4),
                                  decoration: BoxDecoration(
                                    color: Colors.white,
                                    borderRadius: BorderRadius.circular(6),
                                  ),
                                  child: sig.imageBytes != null
                                      ? Image.memory(sig.imageBytes!, fit: BoxFit.contain)
                                      : CustomPaint(
                                          painter: _StudioPadPainter(
                                            strokes: sig.strokes,
                                            color: Color(sig.colorValue),
                                            realisticInk: sig.realisticInk,
                                            viewBox: Size(sig.viewBoxW, sig.viewBoxH),
                                          ),
                                        ),
                                ),
                                title: Text(sig.label, style: GpTypography.label),
                                subtitle: Text(
                                  sig.isParaf ? l10n.t('mobile.sig.parafTab') : l10n.t('mobile.sig.signatureTab'),
                                  style: GpTypography.caption,
                                ),
                                trailing: IconButton(
                                  icon: Icon(Icons.delete_outline, color: palette.danger),
                                  onPressed: () {
                                    onDeleteFromVault(sig.id);
                                    setModalState(() {});
                                  },
                                ),
                                onTap: () {
                                  Navigator.pop(
                                    ctx,
                                    GpGhostSignature(
                                      label: sig.label,
                                      strokes: sig.strokes,
                                      centerPdf: const Offset(297, 421),
                                      sizePdf: sig.isParaf
                                          ? const Size(90, 48)
                                          : const Size(168, 76),
                                      isParaf: sig.isParaf,
                                      realisticInk: sig.realisticInk,
                                      colorValue: sig.colorValue,
                                      svgPaths: sig.svgPaths,
                                      imageBytes: sig.imageBytes,
                                      viewBoxSize: Size(sig.viewBoxW, sig.viewBoxH),
                                      signatureId: sig.id,
                                    ),
                                  );
                                },
                              );
                            },
                          ),
                        ),
                    ],
                  ],
                ),
              ),
            ),
          );
        },
      );
    },
  );
  typedCtrl.dispose();
  return res;
}

String _smoothSvgPathD(List<Offset> pts) {
  if (pts.isEmpty) return '';
  final sb = StringBuffer('M ${pts.first.dx.toStringAsFixed(1)} ${pts.first.dy.toStringAsFixed(1)}');
  if (pts.length == 1) {
    sb.write(' L ${(pts.first.dx + 0.5).toStringAsFixed(1)} ${(pts.first.dy + 0.5).toStringAsFixed(1)}');
    return sb.toString();
  }
  if (pts.length == 2) {
    sb.write(' L ${pts[1].dx.toStringAsFixed(1)} ${pts[1].dy.toStringAsFixed(1)}');
    return sb.toString();
  }
  for (var i = 1; i < pts.length - 1; i++) {
    final midX = (pts[i].dx + pts[i + 1].dx) * 0.5;
    final midY = (pts[i].dy + pts[i + 1].dy) * 0.5;
    sb.write(
      ' Q ${pts[i].dx.toStringAsFixed(1)} ${pts[i].dy.toStringAsFixed(1)} '
      '${midX.toStringAsFixed(1)} ${midY.toStringAsFixed(1)}',
    );
  }
  sb.write(' L ${pts.last.dx.toStringAsFixed(1)} ${pts.last.dy.toStringAsFixed(1)}');
  return sb.toString();
}

Future<Uint8List> _stripPaperBackgroundPng(Uint8List srcBytes) async {
  try {
    final codec = await ui.instantiateImageCodec(srcBytes, targetWidth: 640);
    final frame = await codec.getNextFrame();
    final img = frame.image;
    final raw = await img.toByteData(format: ui.ImageByteFormat.rawRgba);
    if (raw == null) {
      img.dispose();
      codec.dispose();
      return srcBytes;
    }
    final rgba = Uint8List.fromList(raw.buffer.asUint8List());
    for (var i = 0; i + 3 < rgba.length; i += 4) {
      final r = rgba[i];
      final g = rgba[i + 1];
      final b = rgba[i + 2];
      final lum = 0.299 * r + 0.587 * g + 0.114 * b;
      final maxC = math.max(r, math.max(g, b));
      final minC = math.min(r, math.min(g, b));
      final chroma = maxC - minC;
      // Clean near-white / pale grey paper backgrounds cleanly
      if (lum > 205 && chroma < 42) {
        rgba[i + 3] = 0;
      } else if (lum > 175 && chroma < 35) {
        final alphaScale = ((205 - lum) / 30.0).clamp(0.0, 1.0);
        rgba[i + 3] = (rgba[i + 3] * alphaScale).round();
      }
    }
    final completer = Completer<ui.Image>();
    ui.decodeImageFromPixels(
      rgba,
      img.width,
      img.height,
      ui.PixelFormat.rgba8888,
      completer.complete,
    );
    final outImg = await completer.future;
    final png = await outImg.toByteData(format: ui.ImageByteFormat.png);
    outImg.dispose();
    img.dispose();
    codec.dispose();
    return png?.buffer.asUint8List() ?? srcBytes;
  } catch (_) {
    return srcBytes;
  }
}

class _StudioPadPainter extends CustomPainter {
  _StudioPadPainter({
    required this.strokes,
    required this.color,
    required this.realisticInk,
    this.viewBox = const Size(300, 170),
  });

  final List<List<Offset>> strokes;
  final Color color;
  final bool realisticInk;
  final Size viewBox;

  @override
  void paint(Canvas canvas, Size size) {
    final sx = size.width / math.max(1.0, viewBox.width);
    final sy = size.height / math.max(1.0, viewBox.height);
    for (final s in strokes) {
      if (s.isEmpty) continue;
      if (!realisticInk || s.length < 3) {
        final p = Paint()
          ..color = color
          ..strokeWidth = 2.6 * math.min(sx, sy)
          ..strokeCap = StrokeCap.round
          ..strokeJoin = StrokeJoin.round
          ..style = PaintingStyle.stroke;
        final path = Path()..moveTo(s.first.dx * sx, s.first.dy * sy);
        for (var i = 1; i < s.length; i++) {
          path.lineTo(s[i].dx * sx, s[i].dy * sy);
        }
        canvas.drawPath(path, p);
      } else {
        for (var i = 1; i < s.length; i++) {
          final d = (s[i] - s[i - 1]).distance;
          final t = (3.4 - d * 0.08).clamp(1.2, 3.6);
          canvas.drawLine(
            Offset(s[i - 1].dx * sx, s[i - 1].dy * sy),
            Offset(s[i].dx * sx, s[i].dy * sy),
            Paint()
              ..color = color
              ..strokeCap = StrokeCap.round
              ..strokeWidth = t * math.min(sx, sy),
          );
        }
      }
    }
  }

  @override
  bool shouldRepaint(covariant _StudioPadPainter oldDelegate) => true;
}
