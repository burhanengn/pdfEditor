import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart';

@immutable
class GpOpenRequest {
  const GpOpenRequest({
    required this.sourceId,
    required this.uris,
    required this.displayName,
    this.sizeBytes,
    this.writable = false,
    this.canPersist = false,
    this.origin = 'picker',
  });

  final String sourceId;
  final List<String> uris;
  final String displayName;
  final int? sizeBytes;
  final bool writable;
  final bool canPersist;
  final String origin; // view | send | sendMultiple | picker | shareExtension

  factory GpOpenRequest.fromMap(Map<dynamic, dynamic> map) {
    final rawUris = (map['uris'] as List<dynamic>? ?? const [])
        .map((e) => e.toString())
        .toList();
    return GpOpenRequest(
      sourceId: map['sourceId']?.toString() ?? (rawUris.isNotEmpty ? rawUris.first : ''),
      uris: rawUris,
      displayName: map['displayName']?.toString() ?? 'document.pdf',
      sizeBytes: (map['sizeBytes'] as num?)?.toInt(),
      writable: map['writable'] == true,
      canPersist: map['canPersist'] == true,
      origin: map['origin']?.toString() ?? 'view',
    );
  }
}

@immutable
class GpWorkCopyResult {
  const GpWorkCopyResult({
    required this.workPath,
    required this.displayName,
    required this.byteSize,
  });

  final String workPath;
  final String displayName;
  final int byteSize;
}

@immutable
class GpCopyProgressEvent {
  const GpCopyProgressEvent({
    required this.taskId,
    required this.bytesCopied,
    required this.totalBytes,
  });

  final String taskId;
  final int bytesCopied;
  final int totalBytes;
}

/// Platform-independent OS file bridge communicating with Android `FileBridgePlugin.kt`
/// and iOS `FileBridge.swift` over a single shared contract (04 §5).
class GpFileBridge {
  static const MethodChannel _method = MethodChannel('dev.gullacpdf/file_bridge');
  static const EventChannel _events = EventChannel('dev.gullacpdf/file_events');

  final StreamController<GpOpenRequest> _openReqCtrl =
      StreamController<GpOpenRequest>.broadcast();
  final StreamController<GpCopyProgressEvent> _progressCtrl =
      StreamController<GpCopyProgressEvent>.broadcast();
  StreamSubscription<dynamic>? _eventSub;

  Stream<GpOpenRequest> get onIncomingOpenRequest => _openReqCtrl.stream;
  Stream<GpCopyProgressEvent> get onCopyProgress => _progressCtrl.stream;

  void startListening() {
    _eventSub ??= _events.receiveBroadcastStream().listen((raw) {
      if (raw is! Map) return;
      final type = raw['type']?.toString();
      if (type == 'openRequest' && raw['payload'] is Map) {
        _openReqCtrl.add(GpOpenRequest.fromMap(raw['payload'] as Map));
      } else if (type == 'copyProgress') {
        _progressCtrl.add(
          GpCopyProgressEvent(
            taskId: raw['taskId']?.toString() ?? '',
            bytesCopied: (raw['bytesCopied'] as num?)?.toInt() ?? 0,
            totalBytes: (raw['totalBytes'] as num?)?.toInt() ?? -1,
          ),
        );
      }
    }, onError: (_) {});
  }

  Future<GpOpenRequest?> getInitialOpenRequest() async {
    try {
      final raw = await _method.invokeMapMethod<dynamic, dynamic>('getInitialOpenRequest');
      if (raw == null) return null;
      await _method.invokeMethod<void>('clearInitialOpenRequest');
      return GpOpenRequest.fromMap(raw);
    } on MissingPluginException {
      return null;
    }
  }

  Future<GpWorkCopyResult> copyToWorkFile({
    required String sourceUri,
    String? displayName,
    String? taskId,
  }) async {
    final res = await _method.invokeMapMethod<dynamic, dynamic>('copyToWorkFile', {
      'sourceUri': sourceUri,
      'displayName': displayName,
      'taskId': taskId,
    });
    if (res == null) {
      throw PlatformException(code: 'COPY_EMPTY', message: 'Empty working copy result');
    }
    return GpWorkCopyResult(
      workPath: res['workPath']?.toString() ?? '',
      displayName: res['displayName']?.toString() ?? (displayName ?? 'document.pdf'),
      byteSize: (res['byteSize'] as num?)?.toInt() ?? 0,
    );
  }

  Future<GpOpenRequest?> openDocumentPicker({
    bool allowMultiple = false,
    List<String> mimeTypes = const ['application/pdf'],
  }) async {
    try {
      final raw = await _method.invokeMapMethod<dynamic, dynamic>(
        'openDocumentPicker',
        {
          'allowMultiple': allowMultiple,
          'mimeTypes': mimeTypes,
        },
      );
      return raw == null ? null : GpOpenRequest.fromMap(raw);
    } on MissingPluginException {
      return null;
    }
  }

  Future<GpOpenRequest?> pickImage({bool allowMultiple = false}) {
    return openDocumentPicker(
      allowMultiple: allowMultiple,
      mimeTypes: const ['image/png', 'image/jpeg', 'image/webp'],
    );
  }

  Future<GpOpenRequest?> pickFont() {
    return openDocumentPicker(
      allowMultiple: false,
      mimeTypes: const [
        'font/ttf',
        'font/otf',
        'application/x-font-ttf',
        'application/x-font-opentype',
        'application/octet-stream',
      ],
    );
  }

  Future<String?> createDocument({
    required String suggestedName,
    required String sourceWorkPath,
  }) async {
    final res = await _method.invokeMapMethod<dynamic, dynamic>('createDocument', {
      'suggestedName': suggestedName,
      'sourceWorkPath': sourceWorkPath,
    });
    return res?['uri']?.toString();
  }

  Future<bool> saveToUri({
    required String sourceWorkPath,
    required String targetUri,
  }) async {
    final ok = await _method.invokeMethod<bool>('saveToUri', {
      'sourceWorkPath': sourceWorkPath,
      'targetUri': targetUri,
    });
    return ok == true;
  }

  Future<bool> shareFile({
    required String sourceWorkPath,
    required String displayName,
  }) async {
    final ok = await _method.invokeMethod<bool>('shareFile', {
      'sourceWorkPath': sourceWorkPath,
      'displayName': displayName,
    });
    return ok == true;
  }

  Future<bool> openInOtherApp({
    required String sourceWorkPath,
    required String displayName,
  }) async {
    try {
      final ok = await _method.invokeMethod<bool>('openInOtherApp', {
        'sourceWorkPath': sourceWorkPath,
        'displayName': displayName,
      });
      return ok == true;
    } on MissingPluginException {
      return false;
    }
  }

  Future<bool> printPdf({
    required String sourceWorkPath,
    required String displayName,
  }) async {
    try {
      final ok = await _method.invokeMethod<bool>('printPdf', {
        'sourceWorkPath': sourceWorkPath,
        'displayName': displayName,
      });
      return ok == true;
    } on MissingPluginException {
      return false;
    }
  }

  Future<void> openDefaultAppSettings() async {
    try {
      await _method.invokeMethod<void>('openDefaultAppSettings');
    } on MissingPluginException {
      // Host platform does not expose OS app-default settings.
    }
  }

  void dispose() {
    _eventSub?.cancel();
    _openReqCtrl.close();
    _progressCtrl.close();
  }
}
