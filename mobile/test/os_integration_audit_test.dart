import 'dart:io';

import 'package:flutter_test/flutter_test.dart';

void main() {
  test('M4.1 OS Integration, Zero-AGPL, K9 Min SDKs & Permission Audit', () {
    final manifest = File('android/app/src/main/AndroidManifest.xml').readAsStringSync();
    expect(manifest, contains('android.intent.action.VIEW'));
    expect(manifest, contains('android.intent.action.SEND'));
    expect(manifest, contains('android.intent.action.SEND_MULTIPLE'));
    expect(manifest, contains('application/pdf'));
    expect(manifest, contains('android:launchMode="singleTask"'));
    expect(manifest, contains('androidx.core.content.FileProvider'));
    // Zero external storage permissions & offline-first zero INTERNET permission
    expect(manifest, isNot(contains('READ_EXTERNAL_STORAGE')));
    expect(manifest, isNot(contains('WRITE_EXTERNAL_STORAGE')));
    expect(manifest, isNot(contains('MANAGE_EXTERNAL_STORAGE')));
    expect(manifest, isNot(contains('android.permission.INTERNET')));

    final gradle = File('android/app/build.gradle').readAsStringSync();
    expect(gradle, contains('minSdk = 26'));
    expect(gradle, contains('arm64-v8a'));

    final plist = File('ios/Runner/Info.plist').readAsStringSync();
    expect(plist, contains('com.adobe.pdf'));
    expect(plist, contains('<string>Alternate</string>'));
    expect(plist, contains('<key>LSSupportsOpeningDocumentsInPlace</key>'));
    expect(plist, contains('<key>UIFileSharingEnabled</key>'));
    expect(plist, contains('<key>UIApplicationSupportsMultipleScenes</key>'));
    // Must not re-declare system-defined com.adobe.pdf as UTImportedTypeDeclarations
    expect(plist, isNot(contains('UTImportedTypeDeclarations')));

    final pbx = File('ios/Runner.xcodeproj/project.pbxproj').readAsStringSync();
    expect(pbx, contains('IPHONEOS_DEPLOYMENT_TARGET = 16.0'));

    final sceneDelegate = File('ios/Runner/SceneDelegate.swift').readAsStringSync();
    expect(sceneDelegate, contains('openURLContexts'));
    expect(sceneDelegate, contains('checkPendingShareExtensionImports'));

    final fileBridgeSwift = File('ios/Runner/FileBridge.swift').readAsStringSync();
    expect(fileBridgeSwift, contains('startAccessingSecurityScopedResource'));
    expect(fileBridgeSwift, contains('NSFileCoordinator'));
    expect(fileBridgeSwift, contains('replaceItemAt'));
    expect(fileBridgeSwift, contains('bookmarkData'));

    // Non-Flutter native Share Extension check (must NOT import Flutter!)
    final shareExtSwift = File('ios/ShareExtension/ShareViewController.swift').readAsStringSync();
    expect(shareExtSwift, isNot(contains('import Flutter')));
    expect(shareExtSwift, contains('UTType.pdf.identifier'));

    // Zero AGPL MuPDF audit across mobile/ and core/
    final pubspec = File('pubspec.yaml').readAsStringSync().toLowerCase();
    final cargoWorkspace = File('../core/Cargo.toml').readAsStringSync().toLowerCase();
    expect(pubspec, isNot(contains('mupdf')));
    expect(cargoWorkspace, isNot(contains('mupdf')));
  });
}
