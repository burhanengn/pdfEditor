import 'dart:async';
import 'dart:convert';
import 'dart:ui' show DisplayFeature, DisplayFeatureState, DisplayFeatureType;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../l10n/gp_l10n.g.dart';
import '../theme/gp_tokens.g.dart';

/// Responsive 3-tier layout classes matching Web & Plan 03 §2.2 + Foldable posture (04 §4.7).
enum GpLayoutClass { compact, medium, expanded }

enum GpPosture { flat, bookSplit, tabletop }

class GpLayoutSpec {
  const GpLayoutSpec({
    required this.layoutClass,
    required this.posture,
    required this.width,
    required this.height,
    this.hingeBounds,
  });

  final GpLayoutClass layoutClass;
  final GpPosture posture;
  final double width;
  final double height;
  final Rect? hingeBounds;

  bool get isCompact => layoutClass == GpLayoutClass.compact;
  bool get isTabletOrDesktop => layoutClass != GpLayoutClass.compact;
  bool get isFoldSplit => posture == GpPosture.bookSplit;

  static GpLayoutSpec fromMediaQuery(MediaQueryData mq) {
    final w = mq.size.width;
    final h = mq.size.height;
    final cls = w < 600
        ? GpLayoutClass.compact
        : (w < 1024 ? GpLayoutClass.medium : GpLayoutClass.expanded);

    var posture = GpPosture.flat;
    Rect? hinge;
    for (final DisplayFeature feat in mq.displayFeatures) {
      if (feat.type == DisplayFeatureType.hinge ||
          feat.type == DisplayFeatureType.fold) {
        if (feat.state == DisplayFeatureState.postureHalfOpened) {
          hinge = feat.bounds;
          posture = feat.bounds.height >= feat.bounds.width
              ? GpPosture.bookSplit
              : GpPosture.tabletop;
          break;
        }
      }
    }
    return GpLayoutSpec(
      layoutClass: cls,
      posture: posture,
      width: w,
      height: h,
      hingeBounds: hinge,
    );
  }
}

/// Session and app-level UI mirror (04 §4.2): document bytes stay in Rust + work file, never Dart UI state.
enum GpAppMode { view, edit }

enum GpEditorTool {
  select,
  text,
  draw,
  eraser,
  highlight,
  signature,
  shape,
  image,
  redact,
}

enum GpSheetKind { none, navigator, search, settings, saveWorkflow, organize }

@immutable
class GpPageMeta {
  const GpPageMeta({
    required this.id,
    required this.sourceDocId,
    required this.sourcePageIndex,
    required this.baseWidth,
    required this.baseHeight,
    required this.intrinsicRotation,
    this.userRotation = 0,
  });

  final String id;
  final String sourceDocId;
  final int sourcePageIndex;
  final double baseWidth;
  final double baseHeight;
  final int intrinsicRotation;
  final int userRotation;

  int get effectiveRotation => (intrinsicRotation + userRotation) % 360;

  double get displayWidth =>
      (effectiveRotation == 90 || effectiveRotation == 270)
          ? baseHeight
          : baseWidth;

  double get displayHeight =>
      (effectiveRotation == 90 || effectiveRotation == 270)
          ? baseWidth
          : baseHeight;

  GpPageMeta copyWith({int? userRotation}) => GpPageMeta(
        id: id,
        sourceDocId: sourceDocId,
        sourcePageIndex: sourcePageIndex,
        baseWidth: baseWidth,
        baseHeight: baseHeight,
        intrinsicRotation: intrinsicRotation,
        userRotation: userRotation ?? this.userRotation,
      );

  Map<String, dynamic> toJson() => {
        'id': id,
        'sourceDocId': sourceDocId,
        'sourcePageIndex': sourcePageIndex,
        'baseWidth': baseWidth,
        'baseHeight': baseHeight,
        'intrinsicRotation': intrinsicRotation,
        'userRotation': userRotation,
        'mediaBox': [0.0, 0.0, baseWidth, baseHeight],
        'cropBox': [0.0, 0.0, baseWidth, baseHeight],
      };
}

@immutable
class GpOutlineNode {
  const GpOutlineNode({
    required this.id,
    required this.title,
    this.pageIndex,
    this.children = const [],
  });

  final String id;
  final String title;
  final int? pageIndex;
  final List<GpOutlineNode> children;
}

@immutable
class GpOverlayElement {
  const GpOverlayElement({
    required this.id,
    required this.pageId,
    required this.kind,
    required this.x,
    required this.y,
    required this.width,
    required this.height,
    this.rotationDeg = 0,
    this.text = '',
    this.fontSize = 14,
    this.colorValue = 0xFF0F172A,
    this.fillColorValue = 0x00000000,
    this.strokeWidth = 2.0,
    this.opacity = 1.0,
    this.points = const [],
    this.isRedact = false,
  });

  final String id;
  final String pageId;
  final String kind; // textAdd | ink | highlight | shape | signature | redact | image
  final double x;
  final double y;
  final double width;
  final double height;
  final double rotationDeg;
  final String text;
  final double fontSize;
  final int colorValue;
  final int fillColorValue;
  final double strokeWidth;
  final double opacity;
  final List<Offset> points;
  final bool isRedact;

  GpOverlayElement copyWith({
    double? x,
    double? y,
    double? width,
    double? height,
    double? rotationDeg,
    String? text,
    double? fontSize,
    int? colorValue,
    int? fillColorValue,
    double? strokeWidth,
    double? opacity,
    List<Offset>? points,
  }) {
    return GpOverlayElement(
      id: id,
      pageId: pageId,
      kind: kind,
      x: x ?? this.x,
      y: y ?? this.y,
      width: width ?? this.width,
      height: height ?? this.height,
      rotationDeg: rotationDeg ?? this.rotationDeg,
      text: text ?? this.text,
      fontSize: fontSize ?? this.fontSize,
      colorValue: colorValue ?? this.colorValue,
      fillColorValue: fillColorValue ?? this.fillColorValue,
      strokeWidth: strokeWidth ?? this.strokeWidth,
      opacity: opacity ?? this.opacity,
      points: points ?? this.points,
      isRedact: isRedact,
    );
  }

  Map<String, dynamic> toCoreJson() {
    String toHex(int argb) =>
        '#${(argb & 0xFFFFFF).toRadixString(16).padLeft(6, '0')}';

    if (kind == 'textAdd') {
      return {
        'id': id,
        'pageId': pageId,
        'kind': 'text-add',
        'x': x,
        'y': y,
        'width': width,
        'height': height,
        'rotation': rotationDeg,
        'opacity': opacity,
        'zIndex': 10,
        'text': text,
        'fontSize': fontSize,
        'fontFamily': 'Helvetica',
        'color': toHex(colorValue),
        'bold': false,
        'italic': false,
        'align': 'left',
        'lineHeight': 1.25,
      };
    }
    if (kind == 'highlight' || isRedact) {
      return {
        'id': id,
        'pageId': pageId,
        'kind': 'highlight',
        'shape': isRedact ? 'redact' : 'highlight',
        'x': x,
        'y': y,
        'width': width,
        'height': height,
        'rotation': rotationDeg,
        'opacity': isRedact ? 1.0 : opacity,
        'zIndex': 5,
        'fillColor': isRedact ? '#000000' : toHex(fillColorValue),
      };
    }
    if (kind == 'ink') {
      final safeW = width <= 0 ? 1.0 : width;
      final safeH = height <= 0 ? 1.0 : height;
      return {
        'id': id,
        'pageId': pageId,
        'kind': 'stroke',
        'x': x,
        'y': y,
        'width': width,
        'height': height,
        'rotation': rotationDeg,
        'opacity': opacity,
        'zIndex': 12,
        'color': toHex(colorValue),
        'strokeWidth': strokeWidth,
        'points': points
            .map((p) => {
                  'x': ((p.dx - x) / safeW).clamp(0.0, 1.0),
                  'y': ((p.dy - y) / safeH).clamp(0.0, 1.0),
                })
            .toList(),
      };
    }
    return {
      'id': id,
      'pageId': pageId,
      'kind': 'shape',
      'shapeType': 'rect',
      'x': x,
      'y': y,
      'width': width,
      'height': height,
      'rotation': rotationDeg,
      'opacity': opacity,
      'zIndex': 8,
      'strokeColor': toHex(colorValue),
      'strokeWidth': strokeWidth,
      'fillColor': fillColorValue == 0 ? 'transparent' : toHex(fillColorValue),
    };
  }
}

@immutable
class GpSearchMatch {
  const GpSearchMatch({
    required this.pageIndex,
    required this.matchIndexInPage,
    required this.snippet,
    required this.rects,
  });

  final int pageIndex;
  final int matchIndexInPage;
  final String snippet;
  final List<Rect> rects;
}

@immutable
class GpRecentDoc {
  const GpRecentDoc({
    required this.sourceId,
    required this.displayName,
    required this.lastOpenedMs,
    this.lastPageIndex = 0,
    this.lastZoom = 1.0,
    this.writable = false,
  });

  final String sourceId;
  final String displayName;
  final int lastOpenedMs;
  final int lastPageIndex;
  final double lastZoom;
  final bool writable;

  Map<String, dynamic> toJson() => {
        'sourceId': sourceId,
        'displayName': displayName,
        'lastOpenedMs': lastOpenedMs,
        'lastPageIndex': lastPageIndex,
        'lastZoom': lastZoom,
        'writable': writable,
      };

  factory GpRecentDoc.fromJson(Map<String, dynamic> m) => GpRecentDoc(
        sourceId: m['sourceId'] as String? ?? '',
        displayName: m['displayName'] as String? ?? 'document.pdf',
        lastOpenedMs: (m['lastOpenedMs'] as num?)?.toInt() ?? 0,
        lastPageIndex: (m['lastPageIndex'] as num?)?.toInt() ?? 0,
        lastZoom: (m['lastZoom'] as num?)?.toDouble() ?? 1.0,
        writable: m['writable'] as bool? ?? false,
      );
}

@immutable
class GpGhostSignature {
  const GpGhostSignature({
    required this.label,
    required this.strokes,
    required this.centerPdf,
    required this.sizePdf,
  });

  final String label;
  final List<List<Offset>> strokes;
  final Offset centerPdf;
  final Size sizePdf;

  GpGhostSignature copyWith({Offset? centerPdf, Size? sizePdf}) =>
      GpGhostSignature(
        label: label,
        strokes: strokes,
        centerPdf: centerPdf ?? this.centerPdf,
        sizePdf: sizePdf ?? this.sizePdf,
      );
}

@immutable
class GpAppState {
  const GpAppState({
    this.docId,
    this.sourceUri,
    this.workFilePath,
    this.displayName = '',
    this.writable = false,
    this.canCopyText = true,
    this.mode = GpAppMode.view,
    this.tool = GpEditorTool.select,
    this.theme = GpReadingTheme.dark,
    this.darkPaperInvert = false,
    this.locale = GpLocale.en,
    this.leftHanded = false,
    this.pages = const [],
    this.outline = const [],
    this.elements = const [],
    this.undoStack = const [],
    this.redoStack = const [],
    this.selectedElementId,
    this.activePageIndex = 0,
    this.zoom = 1.0,
    this.dirty = false,
    this.isLoading = false,
    this.errorBanner,
    this.passwordRequiredForPath,
    this.passwordInvalid = false,
    this.immersiveHidden = false,
    this.activeSheet = GpSheetKind.none,
    this.splitOutlineVisible = false,
    this.searchQuery = '',
    this.searchMatchCase = false,
    this.searchWholeWord = false,
    this.searchHits = const [],
    this.activeSearchIdx = 0,
    this.searchScanning = false,
    this.overwriteDontAskAgain = false,
    this.recentDocs = const [],
    this.ghostSignature,
    this.recoverableAutosaveJson,
    this.lastVerifiedRedactionCount = 0,
  });

  final String? docId;
  final String? sourceUri;
  final String? workFilePath;
  final String displayName;
  final bool writable;
  final bool canCopyText;
  final GpAppMode mode;
  final GpEditorTool tool;
  final GpReadingTheme theme;
  final bool darkPaperInvert;
  final GpLocale locale;
  final bool leftHanded;
  final List<GpPageMeta> pages;
  final List<GpOutlineNode> outline;
  final List<GpOverlayElement> elements;
  final List<List<GpOverlayElement>> undoStack;
  final List<List<GpOverlayElement>> redoStack;
  final String? selectedElementId;
  final int activePageIndex;
  final double zoom;
  final bool dirty;
  final bool isLoading;
  final String? errorBanner;
  final String? passwordRequiredForPath;
  final bool passwordInvalid;
  final bool immersiveHidden;
  final GpSheetKind activeSheet;
  final bool splitOutlineVisible;
  final String searchQuery;
  final bool searchMatchCase;
  final bool searchWholeWord;
  final List<GpSearchMatch> searchHits;
  final int activeSearchIdx;
  final bool searchScanning;
  final bool overwriteDontAskAgain;
  final List<GpRecentDoc> recentDocs;
  final GpGhostSignature? ghostSignature;
  final String? recoverableAutosaveJson;
  final int lastVerifiedRedactionCount;

  bool get hasDocument => docId != null && pages.isNotEmpty;
  bool get canUndo => undoStack.isNotEmpty;
  bool get canRedo => redoStack.isNotEmpty;

  GpAppState copyWith({
    String? docId,
    bool clearDoc = false,
    String? sourceUri,
    String? workFilePath,
    String? displayName,
    bool? writable,
    bool? canCopyText,
    GpAppMode? mode,
    GpEditorTool? tool,
    GpReadingTheme? theme,
    bool? darkPaperInvert,
    GpLocale? locale,
    bool? leftHanded,
    List<GpPageMeta>? pages,
    List<GpOutlineNode>? outline,
    List<GpOverlayElement>? elements,
    List<List<GpOverlayElement>>? undoStack,
    List<List<GpOverlayElement>>? redoStack,
    String? selectedElementId,
    bool clearSelection = false,
    int? activePageIndex,
    double? zoom,
    bool? dirty,
    bool? isLoading,
    String? errorBanner,
    bool clearError = false,
    String? passwordRequiredForPath,
    bool clearPasswordPrompt = false,
    bool? passwordInvalid,
    bool? immersiveHidden,
    GpSheetKind? activeSheet,
    bool? splitOutlineVisible,
    String? searchQuery,
    bool? searchMatchCase,
    bool? searchWholeWord,
    List<GpSearchMatch>? searchHits,
    int? activeSearchIdx,
    bool? searchScanning,
    bool? overwriteDontAskAgain,
    List<GpRecentDoc>? recentDocs,
    GpGhostSignature? ghostSignature,
    bool clearGhostSignature = false,
    String? recoverableAutosaveJson,
    bool clearRecoverableAutosave = false,
    int? lastVerifiedRedactionCount,
  }) {
    return GpAppState(
      docId: clearDoc ? null : (docId ?? this.docId),
      sourceUri: clearDoc ? null : (sourceUri ?? this.sourceUri),
      workFilePath: clearDoc ? null : (workFilePath ?? this.workFilePath),
      displayName: clearDoc ? '' : (displayName ?? this.displayName),
      writable: clearDoc ? false : (writable ?? this.writable),
      canCopyText: canCopyText ?? this.canCopyText,
      mode: clearDoc ? GpAppMode.view : (mode ?? this.mode),
      tool: tool ?? this.tool,
      theme: theme ?? this.theme,
      darkPaperInvert: darkPaperInvert ?? this.darkPaperInvert,
      locale: locale ?? this.locale,
      leftHanded: leftHanded ?? this.leftHanded,
      pages: clearDoc ? const [] : (pages ?? this.pages),
      outline: clearDoc ? const [] : (outline ?? this.outline),
      elements: clearDoc ? const [] : (elements ?? this.elements),
      undoStack: clearDoc ? const [] : (undoStack ?? this.undoStack),
      redoStack: clearDoc ? const [] : (redoStack ?? this.redoStack),
      selectedElementId: clearDoc || clearSelection
          ? null
          : (selectedElementId ?? this.selectedElementId),
      activePageIndex: activePageIndex ?? this.activePageIndex,
      zoom: zoom ?? this.zoom,
      dirty: clearDoc ? false : (dirty ?? this.dirty),
      isLoading: isLoading ?? this.isLoading,
      errorBanner: clearError ? null : (errorBanner ?? this.errorBanner),
      passwordRequiredForPath: clearPasswordPrompt
          ? null
          : (passwordRequiredForPath ?? this.passwordRequiredForPath),
      passwordInvalid: passwordInvalid ?? this.passwordInvalid,
      immersiveHidden: immersiveHidden ?? this.immersiveHidden,
      activeSheet: activeSheet ?? this.activeSheet,
      splitOutlineVisible: splitOutlineVisible ?? this.splitOutlineVisible,
      searchQuery: searchQuery ?? this.searchQuery,
      searchMatchCase: searchMatchCase ?? this.searchMatchCase,
      searchWholeWord: searchWholeWord ?? this.searchWholeWord,
      searchHits: clearDoc ? const [] : (searchHits ?? this.searchHits),
      activeSearchIdx: activeSearchIdx ?? this.activeSearchIdx,
      searchScanning: searchScanning ?? this.searchScanning,
      overwriteDontAskAgain: overwriteDontAskAgain ?? this.overwriteDontAskAgain,
      recentDocs: recentDocs ?? this.recentDocs,
      ghostSignature: clearDoc || clearGhostSignature
          ? null
          : (ghostSignature ?? this.ghostSignature),
      recoverableAutosaveJson: clearRecoverableAutosave
          ? null
          : (recoverableAutosaveJson ?? this.recoverableAutosaveJson),
      lastVerifiedRedactionCount:
          lastVerifiedRedactionCount ?? this.lastVerifiedRedactionCount,
    );
  }
}

class GpSessionNotifier extends StateNotifier<GpAppState> {
  GpSessionNotifier({GpLocale? initialLocale})
      : super(GpAppState(locale: initialLocale ?? GpLocale.en)) {
    unawaited(_loadPreferences());
  }

  static const _kLocaleKey = 'gp_mobile_locale';
  static const _kThemeKey = 'gp_mobile_theme';
  static const _kDontAskOverwriteKey = 'gp_mobile_dont_ask_overwrite';
  static const _kRecentsKey = 'gp_mobile_recents_v1';
  static const _kAutosaveKey = 'gp_mobile_autosave_v1';

  Timer? _autosaveTimer;

  Future<void> _loadPreferences() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final savedLoc = prefs.getString(_kLocaleKey);
      final savedTheme = prefs.getString(_kThemeKey);
      final dontAsk = prefs.getBool(_kDontAskOverwriteKey) ?? false;
      final recentsRaw = prefs.getString(_kRecentsKey);
      final autosave = prefs.getString(_kAutosaveKey);

      var locale = state.locale;
      if (savedLoc == 'tr') locale = GpLocale.tr;
      if (savedLoc == 'en') locale = GpLocale.en;

      var theme = state.theme;
      if (savedTheme == 'light') theme = GpReadingTheme.light;
      if (savedTheme == 'sepia') theme = GpReadingTheme.sepia;
      if (savedTheme == 'dark') theme = GpReadingTheme.dark;

      var recents = const <GpRecentDoc>[];
      if (recentsRaw != null && recentsRaw.isNotEmpty) {
        final decoded = jsonDecode(recentsRaw) as List<dynamic>;
        recents = decoded
            .whereType<Map<String, dynamic>>()
            .map(GpRecentDoc.fromJson)
            .toList();
      }

      state = state.copyWith(
        locale: locale,
        theme: theme,
        overwriteDontAskAgain: dontAsk,
        recentDocs: recents,
        recoverableAutosaveJson: autosave,
      );
    } catch (_) {}
  }

  void setLocale(GpLocale locale) {
    state = state.copyWith(locale: locale);
    unawaited(SharedPreferences.getInstance()
        .then((p) => p.setString(_kLocaleKey, locale.name)));
  }

  void setTheme(GpReadingTheme theme) {
    state = state.copyWith(theme: theme);
    unawaited(SharedPreferences.getInstance()
        .then((p) => p.setString(_kThemeKey, theme.name)));
  }

  void toggleLeftHanded() => state = state.copyWith(leftHanded: !state.leftHanded);

  void toggleDarkPaperInvert() =>
      state = state.copyWith(darkPaperInvert: !state.darkPaperInvert);

  void setMode(GpAppMode next) {
    state = state.copyWith(
      mode: next,
      tool: next == GpAppMode.view ? GpEditorTool.select : state.tool,
      activeSheet: GpSheetKind.none,
    );
  }

  void setTool(GpEditorTool tool) {
    state = state.copyWith(tool: tool);
  }

  void setSheet(GpSheetKind sheet) {
    state = state.copyWith(
      activeSheet: state.activeSheet == sheet ? GpSheetKind.none : sheet,
    );
  }

  void closeSheet() => state = state.copyWith(activeSheet: GpSheetKind.none);

  void toggleImmersive() =>
      state = state.copyWith(immersiveHidden: !state.immersiveHidden);

  void toggleSplitOutline() =>
      state = state.copyWith(splitOutlineVisible: !state.splitOutlineVisible);

  void updateViewportPosition(int pageIndex, double zoom) {
    if (pageIndex == state.activePageIndex && (zoom - state.zoom).abs() < 0.001) {
      return;
    }
    state = state.copyWith(activePageIndex: pageIndex, zoom: zoom);
  }

  void setLoading(bool loading) => state = state.copyWith(isLoading: loading);

  void setError(String? msg) => state = msg == null
      ? state.copyWith(clearError: true)
      : state.copyWith(errorBanner: msg);

  void setDontAskOverwriteAgain(bool value) {
    state = state.copyWith(overwriteDontAskAgain: value);
    unawaited(SharedPreferences.getInstance()
        .then((p) => p.setBool(_kDontAskOverwriteKey, value)));
  }

  void promptForPassword({
    required String path,
    required String displayName,
    String? sourceUri,
    required bool writable,
    required bool invalidAttempt,
  }) {
    state = state.copyWith(
      isLoading: false,
      passwordRequiredForPath: path,
      displayName: displayName,
      sourceUri: sourceUri,
      writable: writable,
      passwordInvalid: invalidAttempt,
    );
  }

  void clearPasswordPrompt() {
    state = state.copyWith(clearPasswordPrompt: true, passwordInvalid: false);
  }

  void resetToLibrary() {
    state = GpAppState(
      locale: state.locale,
      theme: state.theme,
      recentDocs: state.recentDocs,
      overwriteDontAskAgain: state.overwriteDontAskAgain,
    );
  }

  void setLoadedDocument({
    required String docId,
    required String displayName,
    required List<GpPageMeta> pages,
    required List<GpOutlineNode> outline,
    required bool canCopyText,
    required bool writable,
    String? sourceUri,
    String? workFilePath,
    int initialPageIndex = 0,
    double initialZoom = 1.0,
  }) {
    final recents = [
      GpRecentDoc(
        sourceId: sourceUri ?? workFilePath ?? docId,
        displayName: displayName,
        lastOpenedMs: DateTime.now().millisecondsSinceEpoch,
        lastPageIndex: initialPageIndex,
        lastZoom: initialZoom,
        writable: writable,
      ),
      ...state.recentDocs.where((r) => r.sourceId != (sourceUri ?? docId)),
    ].take(20).toList();

    unawaited(SharedPreferences.getInstance().then((p) =>
        p.setString(_kRecentsKey, jsonEncode(recents.map((e) => e.toJson()).toList()))));

    state = state.copyWith(
      docId: docId,
      sourceUri: sourceUri,
      workFilePath: workFilePath,
      displayName: displayName,
      writable: writable,
      canCopyText: canCopyText,
      mode: GpAppMode.view, // Always opens in Viewer mode per M1.1 / 04 §5!
      tool: GpEditorTool.select,
      pages: pages,
      outline: outline,
      elements: const [],
      undoStack: const [],
      redoStack: const [],
      clearSelection: true,
      activePageIndex: initialPageIndex,
      zoom: initialZoom,
      dirty: false,
      isLoading: false,
      clearError: true,
      clearPasswordPrompt: true,
      passwordInvalid: false,
      activeSheet: GpSheetKind.none,
      recentDocs: recents,
    );
  }

  void addElement(GpOverlayElement el) {
    final nextUndo = [...state.undoStack, state.elements];
    state = state.copyWith(
      elements: [...state.elements, el],
      undoStack: nextUndo.length > 60 ? nextUndo.sublist(nextUndo.length - 60) : nextUndo,
      redoStack: const [],
      selectedElementId: el.id,
      dirty: true,
    );
    _scheduleAutosave();
  }

  void updateElement(GpOverlayElement updated, {bool recordHistory = true}) {
    final nextList = [
      for (final e in state.elements) e.id == updated.id ? updated : e,
    ];
    state = state.copyWith(
      elements: nextList,
      undoStack: recordHistory ? [...state.undoStack, state.elements] : state.undoStack,
      redoStack: recordHistory ? const [] : state.redoStack,
      dirty: true,
    );
    if (recordHistory) _scheduleAutosave();
  }

  void selectElement(String? id) {
    state = id == null
        ? state.copyWith(clearSelection: true)
        : state.copyWith(selectedElementId: id);
  }

  void deleteSelectedElement() {
    final selId = state.selectedElementId;
    if (selId == null) return;
    final nextList = state.elements.where((e) => e.id != selId).toList();
    state = state.copyWith(
      elements: nextList,
      undoStack: [...state.undoStack, state.elements],
      redoStack: const [],
      clearSelection: true,
      dirty: true,
    );
    _scheduleAutosave();
  }

  void undo() {
    if (state.undoStack.isEmpty) return;
    final prev = state.undoStack.last;
    state = state.copyWith(
      elements: prev,
      undoStack: state.undoStack.sublist(0, state.undoStack.length - 1),
      redoStack: [...state.redoStack, state.elements],
      clearSelection: true,
      dirty: true,
    );
    _scheduleAutosave();
  }

  void redo() {
    if (state.redoStack.isEmpty) return;
    final next = state.redoStack.last;
    state = state.copyWith(
      elements: next,
      undoStack: [...state.undoStack, state.elements],
      redoStack: state.redoStack.sublist(0, state.redoStack.length - 1),
      clearSelection: true,
      dirty: true,
    );
    _scheduleAutosave();
  }

  void setGhostSignature(GpGhostSignature? ghost) {
    state = ghost == null
        ? state.copyWith(clearGhostSignature: true)
        : state.copyWith(ghostSignature: ghost);
  }

  void rotatePageClockwise(int pageIndex) {
    if (pageIndex < 0 || pageIndex >= state.pages.length) return;
    final updated = [
      for (var i = 0; i < state.pages.length; i++)
        i == pageIndex
            ? state.pages[i]
                .copyWith(userRotation: (state.pages[i].userRotation + 90) % 360)
            : state.pages[i],
    ];
    state = state.copyWith(pages: updated, dirty: true);
    _scheduleAutosave();
  }

  void movePage(int fromIndex, int toIndex) {
    if (fromIndex < 0 ||
        fromIndex >= state.pages.length ||
        toIndex < 0 ||
        toIndex >= state.pages.length ||
        fromIndex == toIndex) {
      return;
    }
    final list = [...state.pages];
    final moved = list.removeAt(fromIndex);
    list.insert(toIndex, moved);
    state = state.copyWith(pages: list, activePageIndex: toIndex, dirty: true);
    _scheduleAutosave();
  }

  void deletePageAt(int index) {
    if (state.pages.length <= 1 || index < 0 || index >= state.pages.length) return;
    final removed = state.pages[index];
    final nextPages = [...state.pages]..removeAt(index);
    final nextElements =
        state.elements.where((e) => e.pageId != removed.id).toList();
    state = state.copyWith(
      pages: nextPages,
      elements: nextElements,
      activePageIndex: index.clamp(0, nextPages.length - 1),
      dirty: true,
    );
    _scheduleAutosave();
  }

  void markSaved({int verifiedRedactions = 0}) {
    state = state.copyWith(
      dirty: false,
      lastVerifiedRedactionCount: verifiedRedactions,
      clearRecoverableAutosave: true,
    );
    unawaited(SharedPreferences.getInstance().then((p) => p.remove(_kAutosaveKey)));
  }

  void startSearch(String query, {bool? matchCase, bool? wholeWord}) {
    state = state.copyWith(
      searchQuery: query,
      searchMatchCase: matchCase ?? state.searchMatchCase,
      searchWholeWord: wholeWord ?? state.searchWholeWord,
      searchHits: const [],
      activeSearchIdx: 0,
      searchScanning: query.trim().isNotEmpty,
    );
  }

  void appendSearchHits(List<GpSearchMatch> hits, {required bool done}) {
    state = state.copyWith(
      searchHits: [...state.searchHits, ...hits],
      searchScanning: !done,
    );
  }

  void stepSearchResult(int delta) {
    if (state.searchHits.isEmpty) return;
    final n = state.searchHits.length;
    final next = ((state.activeSearchIdx + delta) % n + n) % n;
    state = state.copyWith(activeSearchIdx: next);
  }

  void _scheduleAutosave() {
    _autosaveTimer?.cancel();
    _autosaveTimer = Timer(const Duration(seconds: 2), () {
      flushAutosaveNow();
    });
  }

  /// Persists serialized session recovery metadata cleanly (04 §6.1).
  void flushAutosaveNow() {
    if (!state.hasDocument || !state.dirty) return;
    final payload = jsonEncode({
      'displayName': state.displayName,
      'workFilePath': state.workFilePath,
      'sourceUri': state.sourceUri,
      'activePageIndex': state.activePageIndex,
      'zoom': state.zoom,
      'elements': state.elements.map((e) => e.toCoreJson()).toList(),
      'savedAtMs': DateTime.now().millisecondsSinceEpoch,
    });
    unawaited(
      SharedPreferences.getInstance()
          .then((p) => p.setString(_kAutosaveKey, payload)),
    );
  }

  void discardRecoverableAutosave() {
    state = state.copyWith(clearRecoverableAutosave: true);
    unawaited(SharedPreferences.getInstance().then((p) => p.remove(_kAutosaveKey)));
  }

  @override
  void dispose() {
    _autosaveTimer?.cancel();
    super.dispose();
  }
}

final gpSessionProvider =
    StateNotifierProvider<GpSessionNotifier, GpAppState>((ref) {
  final langCode = WidgetsBinding.instance.platformDispatcher.locale.languageCode;
  return GpSessionNotifier(initialLocale: GpL10n.detectFromLanguageCode(langCode));
});
