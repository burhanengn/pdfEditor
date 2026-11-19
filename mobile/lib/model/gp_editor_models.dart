import 'dart:convert';
import 'dart:ui';

import 'package:flutter/foundation.dart';

@immutable
class GpSignatureSvgPath {
  const GpSignatureSvgPath({
    required this.d,
    this.fill,
    this.stroke,
    this.strokeWidth,
  });

  final String d;
  final String? fill;
  final String? stroke;
  final double? strokeWidth;

  Map<String, dynamic> toJson() => {
        'd': d,
        if (fill != null) 'fill': fill,
        if (stroke != null) 'stroke': stroke,
        if (strokeWidth != null) 'strokeWidth': strokeWidth,
      };

  factory GpSignatureSvgPath.fromJson(Map<String, dynamic> json) =>
      GpSignatureSvgPath(
        d: json['d']?.toString() ?? '',
        fill: json['fill']?.toString(),
        stroke: json['stroke']?.toString(),
        strokeWidth: (json['strokeWidth'] as num?)?.toDouble(),
      );
}

@immutable
class GpDetectedTextBlock {
  const GpDetectedTextBlock({
    required this.id,
    required this.text,
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    required this.fontSize,
    this.fontFamily = 'DejaVuSans',
    this.bold = false,
    this.italic = false,
    this.colorValue = 0xFF0F172A,
    this.lineHeight = 1.25,
  });

  final String id;
  final String text;
  final double x;
  final double y;
  final double width;
  final double height;
  final double fontSize;
  final String fontFamily;
  final bool bold;
  final bool italic;
  final int colorValue;
  final double lineHeight;

  Rect get rect => Rect.fromLTWH(x, y, width, height);

  factory GpDetectedTextBlock.fromJson(Map<String, dynamic> m) {
    return GpDetectedTextBlock(
      id: m['id']?.toString() ?? '',
      text: m['text']?.toString() ?? '',
      x: (m['x'] as num?)?.toDouble() ?? 0,
      y: (m['y'] as num?)?.toDouble() ?? 0,
      width: (m['width'] as num?)?.toDouble() ?? 60,
      height: (m['height'] as num?)?.toDouble() ?? 16,
      fontSize: (m['fontSize'] as num?)?.toDouble() ?? 12,
      fontFamily: m['fontFamily']?.toString() ?? 'DejaVuSans',
      bold: m['bold'] == true,
      italic: m['italic'] == true,
      colorValue: _parseHexOrInt(m['color'], fallback: 0xFF0F172A),
      lineHeight: (m['lineHeight'] as num?)?.toDouble() ?? 1.25,
    );
  }
}

@immutable
class GpDetectedImageObj {
  const GpDetectedImageObj({
    required this.id,
    required this.x,
    required this.y,
    required this.width,
    required this.height,
  });

  final String id;
  final double x;
  final double y;
  final double width;
  final double height;

  Rect get rect => Rect.fromLTWH(x, y, width, height);

  factory GpDetectedImageObj.fromJson(Map<String, dynamic> m) =>
      GpDetectedImageObj(
        id: m['id']?.toString() ?? '',
        x: (m['x'] as num?)?.toDouble() ?? 0,
        y: (m['y'] as num?)?.toDouble() ?? 0,
        width: (m['width'] as num?)?.toDouble() ?? 40,
        height: (m['height'] as num?)?.toDouble() ?? 40,
      );
}

@immutable
class GpDetectedShapeObj {
  const GpDetectedShapeObj({
    required this.id,
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    this.fillColorValue = 0x00000000,
    this.strokeColorValue = 0xFF0F172A,
    this.strokeWidth = 1.0,
    this.svgPath = '',
  });

  final String id;
  final double x;
  final double y;
  final double width;
  final double height;
  final int fillColorValue;
  final int strokeColorValue;
  final double strokeWidth;
  final String svgPath;

  Rect get rect => Rect.fromLTWH(x, y, width, height);

  factory GpDetectedShapeObj.fromJson(Map<String, dynamic> m) =>
      GpDetectedShapeObj(
        id: m['id']?.toString() ?? '',
        x: (m['x'] as num?)?.toDouble() ?? 0,
        y: (m['y'] as num?)?.toDouble() ?? 0,
        width: (m['width'] as num?)?.toDouble() ?? 40,
        height: (m['height'] as num?)?.toDouble() ?? 40,
        fillColorValue: _parseHexOrInt(m['fillColor'], fallback: 0x00000000),
        strokeColorValue: _parseHexOrInt(m['strokeColor'], fallback: 0xFF0F172A),
        strokeWidth: (m['strokeWidth'] as num?)?.toDouble() ?? 1.0,
        svgPath: m['svgPath']?.toString() ?? '',
      );
}

@immutable
class GpPageAnalysis {
  const GpPageAnalysis({
    this.textBlocks = const [],
    this.images = const [],
    this.shapes = const [],
  });

  final List<GpDetectedTextBlock> textBlocks;
  final List<GpDetectedImageObj> images;
  final List<GpDetectedShapeObj> shapes;

  factory GpPageAnalysis.fromJsonString(String raw) {
    if (raw.trim().isEmpty || raw.trim() == '{}') {
      return const GpPageAnalysis();
    }
    final decoded = jsonDecode(raw) as Map<String, dynamic>;
    return GpPageAnalysis(
      textBlocks: (decoded['textBlocks'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(GpDetectedTextBlock.fromJson)
          .toList(),
      images: (decoded['images'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(GpDetectedImageObj.fromJson)
          .toList(),
      shapes: (decoded['shapes'] as List<dynamic>? ?? const [])
          .whereType<Map<String, dynamic>>()
          .map(GpDetectedShapeObj.fromJson)
          .toList(),
    );
  }
}

@immutable
class GpPageLink {
  const GpPageLink({
    required this.id,
    required this.pageIndex,
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    required this.kind,
    this.uri,
    this.destPageIndex,
  });

  final String id;
  final int pageIndex;
  final double x;
  final double y;
  final double width;
  final double height;
  final String kind; // uri | goto
  final String? uri;
  final int? destPageIndex;

  Rect get rect => Rect.fromLTWH(x, y, width, height);
}

@immutable
class GpPageNumberingConfig {
  const GpPageNumberingConfig({
    this.enabled = false,
    this.position = 'bottom-center',
    this.format = 'number',
    this.fontFamily = 'DejaVuSans',
    this.fontSize = 10.5,
    this.colorValue = 0xFF334155,
    this.marginX = 36.0,
    this.marginY = 26.0,
    this.startFromPage = 1,
    this.startNumber = 1,
    this.opacity = 0.92,
  });

  final bool enabled;
  final String position; // bottom-center|bottom-left|bottom-right|top-left|top-center|top-right
  final String format; // number|number-of-total|page-number|page-number-of-total|roman-lower|roman-upper
  final String fontFamily;
  final double fontSize;
  final int colorValue;
  final double marginX;
  final double marginY;
  final int startFromPage;
  final int startNumber;
  final double opacity;

  GpPageNumberingConfig copyWith({
    bool? enabled,
    String? position,
    String? format,
    String? fontFamily,
    double? fontSize,
    int? colorValue,
    double? marginX,
    double? marginY,
    int? startFromPage,
    int? startNumber,
    double? opacity,
  }) =>
      GpPageNumberingConfig(
        enabled: enabled ?? this.enabled,
        position: position ?? this.position,
        format: format ?? this.format,
        fontFamily: fontFamily ?? this.fontFamily,
        fontSize: fontSize ?? this.fontSize,
        colorValue: colorValue ?? this.colorValue,
        marginX: marginX ?? this.marginX,
        marginY: marginY ?? this.marginY,
        startFromPage: startFromPage ?? this.startFromPage,
        startNumber: startNumber ?? this.startNumber,
        opacity: opacity ?? this.opacity,
      );

  Map<String, dynamic> toCoreJson() => {
        'enabled': enabled,
        'position': position,
        'format': format,
        'fontFamily': fontFamily,
        'fontSize': fontSize,
        'color': '#${(colorValue & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}',
        'marginX': marginX,
        'marginY': marginY,
        'startFromPage': startFromPage,
        'startNumber': startNumber,
        'opacity': opacity,
      };
}

@immutable
class GpSavedSignature {
  const GpSavedSignature({
    required this.id,
    required this.label,
    required this.isParaf,
    this.strokes = const [],
    this.svgPaths = const [],
    this.imageBytes,
    this.realisticInk = true,
    this.colorValue = 0xFF0F172A,
    this.viewBoxW = 300.0,
    this.viewBoxH = 180.0,
    required this.createdAtMs,
  });

  final String id;
  final String label;
  final bool isParaf;
  final List<List<Offset>> strokes;
  final List<GpSignatureSvgPath> svgPaths;
  final Uint8List? imageBytes;
  final bool realisticInk;
  final int colorValue;
  final double viewBoxW;
  final double viewBoxH;
  final int createdAtMs;

  Map<String, dynamic> toJson() => {
        'id': id,
        'label': label,
        'isParaf': isParaf,
        'strokes': strokes
            .map((s) => s.map((p) => [p.dx, p.dy]).toList())
            .toList(),
        'svgPaths': svgPaths.map((p) => p.toJson()).toList(),
        if (imageBytes != null) 'imageB64': base64Encode(imageBytes!),
        'realisticInk': realisticInk,
        'colorValue': colorValue,
        'viewBoxW': viewBoxW,
        'viewBoxH': viewBoxH,
        'createdAtMs': createdAtMs,
      };

  factory GpSavedSignature.fromJson(Map<String, dynamic> m) {
    final rawStrokes = (m['strokes'] as List<dynamic>? ?? const []);
    final strokes = rawStrokes.map((s) {
      return (s as List<dynamic>)
          .map((pt) {
            final pair = pt as List<dynamic>;
            return Offset((pair[0] as num).toDouble(), (pair[1] as num).toDouble());
          })
          .toList();
    }).toList();
    final svgPaths = (m['svgPaths'] as List<dynamic>? ?? const [])
        .whereType<Map<String, dynamic>>()
        .map(GpSignatureSvgPath.fromJson)
        .toList();
    final b64 = m['imageB64'] as String?;
    return GpSavedSignature(
      id: m['id']?.toString() ?? '',
      label: m['label']?.toString() ?? 'Signature',
      isParaf: m['isParaf'] == true,
      strokes: strokes,
      svgPaths: svgPaths,
      imageBytes: b64 != null && b64.isNotEmpty ? base64Decode(b64) : null,
      realisticInk: m['realisticInk'] != false,
      colorValue: (m['colorValue'] as num?)?.toInt() ?? 0xFF0F172A,
      viewBoxW: (m['viewBoxW'] as num?)?.toDouble() ?? 300.0,
      viewBoxH: (m['viewBoxH'] as num?)?.toDouble() ?? 180.0,
      createdAtMs: (m['createdAtMs'] as num?)?.toInt() ?? 0,
    );
  }
}

int _parseHexOrInt(dynamic raw, {required int fallback}) {
  if (raw == null) return fallback;
  if (raw is int) return raw;
  final s = raw.toString().trim();
  if (s.isEmpty || s.toLowerCase() == 'transparent' || s.toLowerCase() == 'none') {
    return 0x00000000;
  }
  final hex = s.startsWith('#') ? s.substring(1) : s;
  if (hex.length == 6) {
    final parsed = int.tryParse(hex, radix: 16);
    if (parsed != null) return 0xFF000000 | parsed;
  } else if (hex.length == 8) {
    final parsed = int.tryParse(hex, radix: 16);
    if (parsed != null) return parsed;
  }
  return fallback;
}
