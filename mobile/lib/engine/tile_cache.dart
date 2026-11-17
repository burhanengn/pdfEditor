import 'dart:async';
import 'dart:collection';
import 'dart:typed_data';
import 'dart:ui' as ui;

/// Decodes a premultiplied RGBA8888 byte buffer directly into an immutable GPU [ui.Image] (04 §4.4).
Future<ui.Image> decodePremultipliedRgbaImage({
  required Uint8List rgba,
  required int width,
  required int height,
}) async {
  final buffer = await ui.ImmutableBuffer.fromUint8List(rgba);
  try {
    final descriptor = ui.ImageDescriptor.raw(
      buffer,
      width: width,
      height: height,
      pixelFormat: ui.PixelFormat.rgba8888,
    );
    try {
      final codec = await descriptor.instantiateCodec();
      try {
        final frame = await codec.getNextFrame();
        return frame.image;
      } finally {
        codec.dispose();
      }
    } finally {
      descriptor.dispose();
    }
  } finally {
    buffer.dispose();
  }
}

class GpTileKey {
  const GpTileKey({
    required this.docId,
    required this.pageIndex,
    required this.tileX,
    required this.tileY,
    required this.scaleBucket,
    required this.rotation,
    required this.themeKey,
    this.isPreview = false,
  });

  final String docId;
  final int pageIndex;
  final int tileX;
  final int tileY;
  final String scaleBucket;
  final int rotation;
  final String themeKey;
  final bool isPreview;

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is GpTileKey &&
          docId == other.docId &&
          pageIndex == other.pageIndex &&
          tileX == other.tileX &&
          tileY == other.tileY &&
          scaleBucket == other.scaleBucket &&
          rotation == other.rotation &&
          themeKey == other.themeKey &&
          isPreview == other.isPreview;

  @override
  int get hashCode => Object.hash(
        docId,
        pageIndex,
        tileX,
        tileY,
        scaleBucket,
        rotation,
        themeKey,
        isPreview,
      );
}

class GpCachedTile {
  GpCachedTile({
    required this.key,
    required this.image,
    required this.width,
    required this.height,
    required this.byteSize,
  });

  final GpTileKey key;
  final ui.Image image;
  final int width;
  final int height;
  final int byteSize;
}

/// Byte-budgeted LRU cache storing 256×256 sharp tiles + low-res page previews (04 §4.4).
/// Disposes evicted [ui.Image] GPU textures deterministically to prevent native OOM.
class GpTileCache {
  GpTileCache({
    this.budgetBytes = 128 * 1024 * 1024,
  });

  int budgetBytes;
  final LinkedHashMap<GpTileKey, GpCachedTile> _entries =
      LinkedHashMap<GpTileKey, GpCachedTile>();
  int _totalBytes = 0;
  int activePageIndex = 0;

  int get totalBytes => _totalBytes;
  int get entryCount => _entries.length;

  GpCachedTile? get(GpTileKey key) {
    final hit = _entries.remove(key);
    if (hit == null) return null;
    _entries[key] = hit;
    return hit;
  }

  bool contains(GpTileKey key) => _entries.containsKey(key);

  void put(GpTileKey key, ui.Image image, {required int width, required int height}) {
    final prev = _entries.remove(key);
    if (prev != null) {
      _totalBytes -= prev.byteSize;
      prev.image.dispose();
    }

    final byteSize = (width * height * 4).clamp(1, 64 * 1024 * 1024);
    final entry = GpCachedTile(
      key: key,
      image: image,
      width: width,
      height: height,
      byteSize: byteSize,
    );
    _entries[key] = entry;
    _totalBytes += byteSize;
    _evictOverBudget();
  }

  void invalidateDoc(String docId) {
    final keys = _entries.keys.where((k) => k.docId == docId).toList();
    for (final k in keys) {
      final removed = _entries.remove(k);
      if (removed != null) {
        _totalBytes = (_totalBytes - removed.byteSize).clamp(0, _totalBytes);
        removed.image.dispose();
      }
    }
  }

  /// Trims cached tiles under OS memory pressure (`didHaveMemoryPressure`), retaining
  /// only nearby previews unless [critical] is true.
  void trim({bool critical = false}) {
    final keys = _entries.keys.toList();
    for (final k in keys) {
      final dist = (k.pageIndex - activePageIndex).abs();
      final shouldDrop = critical
          ? (!k.isPreview || dist > 0)
          : (!k.isPreview || dist > 2);
      if (shouldDrop) {
        final removed = _entries.remove(k);
        if (removed != null) {
          _totalBytes = (_totalBytes - removed.byteSize).clamp(0, _totalBytes);
          removed.image.dispose();
        }
      }
    }
  }

  void clear() {
    for (final entry in _entries.values) {
      entry.image.dispose();
    }
    _entries.clear();
    _totalBytes = 0;
  }

  void _evictOverBudget() {
    if (_totalBytes <= budgetBytes) return;
    // Tiered eviction: distant non-previews first, then oldest LRU.
    final candidates = _entries.keys.toList()
      ..sort((a, b) {
        final distA = (a.pageIndex - activePageIndex).abs();
        final distB = (b.pageIndex - activePageIndex).abs();
        final tierA = (!a.isPreview && distA > 2) ? 0 : (a.isPreview ? 2 : 1);
        final tierB = (!b.isPreview && distB > 2) ? 0 : (b.isPreview ? 2 : 1);
        return tierA.compareTo(tierB);
      });

    for (final key in candidates) {
      if (_totalBytes <= budgetBytes) break;
      final removed = _entries.remove(key);
      if (removed != null) {
        _totalBytes = (_totalBytes - removed.byteSize).clamp(0, _totalBytes);
        removed.image.dispose();
      }
    }
  }
}
