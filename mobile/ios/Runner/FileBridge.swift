import Flutter
import MobileCoreServices
import UIKit
import UniformTypeIdentifiers

/// Native iOS OS bridge for "Open In / Birlikte Aç", Security-Scoped Resource coordination,
/// Bookmark persistence, atomic replaceItemAt writes, Document Picker, Share Sheet & Print (04 §5.2, §6.2).
final class FileBridgePlugin: NSObject, UIDocumentPickerDelegate {
  static let shared = FileBridgePlugin()

  static let methodChannelName = "dev.gullacpdf/file_bridge"
  static let eventChannelName = "dev.gullacpdf/file_events"
  static let appGroupId = "group.dev.gullacpdf.mobile"
  static let streamBufferBytes = 64 * 1024

  private var methodChannel: FlutterMethodChannel?
  private var eventSink: FlutterEventSink?
  private weak var rootViewController: UIViewController?

  private var initialOpenRequest: [String: Any?]?
  private var activePickerResult: FlutterResult?
  private var activePickerMode: String? // "open" | "export"
  private var exportWorkTempURL: URL?

  private let bookmarkDefaultsKey = "gp_ios_security_bookmarks_v1"
  private let ioQueue = DispatchQueue(label: "dev.gullacpdf.ios.fileio", qos: .userInitiated)
  private var cancelledTasks = Set<String>()
  private let cancelLock = NSLock()

  func attach(to engine: FlutterEngine, rootViewController: UIViewController) {
    self.rootViewController = rootViewController
    let mc = FlutterMethodChannel(name: Self.methodChannelName, binaryMessenger: engine.binaryMessenger)
    mc.setMethodCallHandler(handleMethodCall)
    self.methodChannel = mc

    let ec = FlutterEventChannel(name: Self.eventChannelName, binaryMessenger: engine.binaryMessenger)
    ec.setStreamHandler(FileBridgeStreamHandler(plugin: self))
  }

  func setEventSink(_ sink: FlutterEventSink?) {
    self.eventSink = sink
  }

  private func emitEvent(_ payload: [String: Any?]) {
    DispatchQueue.main.async {
      self.eventSink?(payload)
    }
  }

  func handleOpenURLContexts(_ urlContexts: Set<UIOpenURLContext>) {
    let pdfContexts = urlContexts.filter { ctx in
      ctx.url.pathExtension.lowercased() == "pdf" ||
      (try? ctx.url.resourceValues(forKeys: [.contentTypeKey]).contentType?.conforms(to: .pdf)) == true
    }
    guard let first = pdfContexts.first else { return }
    let uris = pdfContexts.map { $0.url.absoluteString }
    let url = first.url
    let isInPlace = first.options.openInPlace
    let sourceId = url.absoluteString

    if isInPlace {
      saveBookmark(for: url, key: sourceId)
    }

    let size = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? NSNumber)?.int64Value
    let req: [String: Any?] = [
      "sourceId": sourceId,
      "uris": uris,
      "displayName": sanitizeFileName(url.lastPathComponent),
      "sizeBytes": size,
      "writable": isInPlace,
      "canPersist": isInPlace,
      "origin": "view",
    ]
    initialOpenRequest = req
    emitEvent(["type": "openRequest", "payload": req])
  }

  func checkPendingShareExtensionImports() {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Self.appGroupId) else {
      return
    }
    let pendingDir = container.appendingPathComponent("PendingImports", isDirectory: true)
    let manifestURL = pendingDir.appendingPathComponent("latest.json")
    guard let data = try? Data(contentsOf: manifestURL),
          let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let relFilePath = json["filePath"] as? String else {
      return
    }
    let stagedURL = pendingDir.appendingPathComponent(relFilePath)
    guard FileManager.default.fileExists(atPath: stagedURL.path) else {
      try? FileManager.default.removeItem(at: manifestURL)
      return
    }
    let displayName = sanitizeFileName((json["displayName"] as? String) ?? stagedURL.lastPathComponent)
    let size = (try? FileManager.default.attributesOfItem(atPath: stagedURL.path)[.size] as? NSNumber)?.int64Value

    let req: [String: Any?] = [
      "sourceId": stagedURL.absoluteString,
      "uris": [stagedURL.absoluteString],
      "displayName": displayName,
      "sizeBytes": size,
      "writable": false,
      "canPersist": false,
      "origin": "shareExtension",
    ]
    try? FileManager.default.removeItem(at: manifestURL)
    initialOpenRequest = req
    emitEvent(["type": "openRequest", "payload": req])
  }

  private func handleMethodCall(_ call: FlutterMethodCall, result: @escaping FlutterResult) {
    let args = call.arguments as? [String: Any] ?? [:]

    switch call.method {
    case "getInitialOpenRequest":
      result(initialOpenRequest)

    case "clearInitialOpenRequest":
      initialOpenRequest = nil
      result(nil)

    case "copyToWorkFile":
      guard let sourceUri = args["sourceUri"] as? String,
            let url = URL(string: sourceUri) else {
        result(FlutterError(code: "INVALID_ARGS", message: "sourceUri required", details: nil))
        return
      }
      let taskId = (args["taskId"] as? String) ?? UUID().uuidString
      let preferredName = args["displayName"] as? String
      copyURLToWorkFileAsync(taskId: taskId, url: url, preferredName: preferredName, result: result)

    case "cancelCopyTask":
      if let taskId = args["taskId"] as? String {
        cancelLock.lock()
        cancelledTasks.insert(taskId)
        cancelLock.unlock()
      }
      result(nil)

    case "openDocumentPicker":
      let allowMultiple = (args["allowMultiple"] as? Bool) ?? false
      DispatchQueue.main.async {
        self.presentOpenPicker(allowMultiple: allowMultiple, result: result)
      }

    case "createDocument":
      guard let srcPath = args["sourceWorkPath"] as? String else {
        result(FlutterError(code: "INVALID_ARGS", message: "sourceWorkPath required", details: nil))
        return
      }
      let suggestedName = sanitizeFileName((args["suggestedName"] as? String) ?? "document-edited.pdf")
      DispatchQueue.main.async {
        self.presentExportPicker(sourceWorkPath: srcPath, suggestedName: suggestedName, result: result)
      }

    case "saveToUri":
      guard let srcPath = args["sourceWorkPath"] as? String,
            let targetUri = args["targetUri"] as? String else {
        result(FlutterError(code: "INVALID_ARGS", message: "sourceWorkPath and targetUri required", details: nil))
        return
      }
      ioQueue.async {
        do {
          try self.atomicSaveInPlace(sourceWorkPath: srcPath, targetUri: targetUri)
          DispatchQueue.main.async { result(true) }
        } catch {
          DispatchQueue.main.async {
            result(FlutterError(code: "WRITE_FAILED", message: error.localizedDescription, details: nil))
          }
        }
      }

    case "shareFile":
      guard let srcPath = args["sourceWorkPath"] as? String else {
        result(FlutterError(code: "INVALID_ARGS", message: "sourceWorkPath required", details: nil))
        return
      }
      let displayName = sanitizeFileName((args["displayName"] as? String) ?? "document.pdf")
      DispatchQueue.main.async {
        self.presentShareSheet(sourceWorkPath: srcPath, displayName: displayName, result: result)
      }

    case "printPdf":
      guard let srcPath = args["sourceWorkPath"] as? String else {
        result(FlutterError(code: "INVALID_ARGS", message: "sourceWorkPath required", details: nil))
        return
      }
      let displayName = sanitizeFileName((args["displayName"] as? String) ?? "document.pdf")
      DispatchQueue.main.async {
        self.presentPrintController(sourceWorkPath: srcPath, jobName: displayName, result: result)
      }

    case "getWorkCacheDir":
      let workDir = Self.workCacheDirectory()
      result(workDir.path)

    default:
      result(FlutterMethodNotImplemented)
    }
  }

  private static func workCacheDirectory() -> URL {
    let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
    let dir = base.appendingPathComponent("work", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  private func copyURLToWorkFileAsync(
    taskId: String,
    url: URL,
    preferredName: String?,
    result: @escaping FlutterResult
  ) {
    ioQueue.async {
      let resolvedURL = self.resolveBookmarkIfAvailable(key: url.absoluteString) ?? url
      let didStartScope = resolvedURL.startAccessingSecurityScopedResource()
      defer {
        if didStartScope {
          resolvedURL.stopAccessingSecurityScopedResource()
        }
        self.cleanupInboxCopyIfNeeded(resolvedURL)
      }

      let safeName = self.sanitizeFileName(preferredName ?? resolvedURL.lastPathComponent)
      let destURL = Self.workCacheDirectory()
        .appendingPathComponent("\(Int(Date().timeIntervalSince1970 * 1000))_\(safeName)")

      var coordError: NSError?
      var copyError: Error?
      var totalCopied: Int64 = 0

      let coordinator = NSFileCoordinator()
      coordinator.coordinate(readingItemAt: resolvedURL, options: .withoutChanges, error: &coordError) { readURL in
        do {
          let totalBytes = (try? FileManager.default.attributesOfItem(atPath: readURL.path)[.size] as? NSNumber)?.int64Value ?? -1
          guard let input = InputStream(url: readURL), let output = OutputStream(url: destURL, append: false) else {
            throw NSError(domain: "dev.gullacpdf", code: 2, userInfo: [NSLocalizedDescriptionKey: "Failed opening file streams"])
          }
          input.open()
          output.open()
          defer {
            input.close()
            output.close()
          }
          var buffer = [UInt8](repeating: 0, count: Self.streamBufferBytes)
          while input.hasBytesAvailable {
            self.cancelLock.lock()
            let cancelled = self.cancelledTasks.contains(taskId)
            self.cancelLock.unlock()
            if cancelled {
              throw NSError(domain: "dev.gullacpdf", code: 3, userInfo: [NSLocalizedDescriptionKey: "Cancelled by user"])
            }
            let readCount = input.read(&buffer, maxLength: buffer.count)
            if readCount < 0 {
              throw input.streamError ?? NSError(domain: "dev.gullacpdf", code: 4, userInfo: [NSLocalizedDescriptionKey: "Stream read error"])
            }
            if readCount == 0 { break }
            var written = 0
            while written < readCount {
              let w = buffer.withUnsafeBytes { raw in
                let ptr = raw.bindMemory(to: UInt8.self).baseAddress!.advanced(by: written)
                return output.write(ptr, maxLength: readCount - written)
              }
              if w <= 0 {
                throw output.streamError ?? NSError(domain: "dev.gullacpdf", code: 5, userInfo: [NSLocalizedDescriptionKey: "Stream write error"])
              }
              written += w
            }
            totalCopied += Int64(readCount)
            self.emitEvent([
              "type": "copyProgress",
              "taskId": taskId,
              "bytesCopied": totalCopied,
              "totalBytes": totalBytes,
            ])
          }
        } catch {
          copyError = error
        }
      }

      self.cancelLock.lock()
      self.cancelledTasks.remove(taskId)
      self.cancelLock.unlock()

      if let finalError = copyError ?? coordError {
        try? FileManager.default.removeItem(at: destURL)
        DispatchQueue.main.async {
          result(FlutterError(code: "COPY_FAILED", message: finalError.localizedDescription, details: nil))
        }
        return
      }

      DispatchQueue.main.async {
        result([
          "workPath": destURL.path,
          "displayName": safeName,
          "byteSize": totalCopied,
        ])
      }
    }
  }

  private func atomicSaveInPlace(sourceWorkPath: String, targetUri: String) throws {
    guard let fallbackURL = URL(string: targetUri) else {
      throw NSError(domain: "dev.gullacpdf", code: 10, userInfo: [NSLocalizedDescriptionKey: "Invalid target URI"])
    }
    let destURL = resolveBookmarkIfAvailable(key: targetUri) ?? fallbackURL
    let didStartScope = destURL.startAccessingSecurityScopedResource()
    defer {
      if didStartScope {
        destURL.stopAccessingSecurityScopedResource()
      }
    }

    let sourceURL = URL(fileURLWithPath: sourceWorkPath)
    let stagingURL = Self.workCacheDirectory().appendingPathComponent(".atomic_\(UUID().uuidString).pdf")
    try FileManager.default.copyItem(at: sourceURL, to: stagingURL)

    var coordError: NSError?
    var writeError: Error?
    let coordinator = NSFileCoordinator()
    coordinator.coordinate(writingItemAt: destURL, options: .forReplacing, error: &coordError) { target in
      do {
        _ = try FileManager.default.replaceItemAt(target, withItemAt: stagingURL, backupItemName: nil, options: .usingNewMetadataOnly)
      } catch {
        writeError = error
      }
    }

    if let finalError = writeError ?? coordError {
      try? FileManager.default.removeItem(at: stagingURL)
      throw finalError
    }
    saveBookmark(for: destURL, key: targetUri)
  }

  private func cleanupInboxCopyIfNeeded(_ url: URL) {
    if url.path.contains("/Documents/Inbox/") {
      try? FileManager.default.removeItem(at: url)
    }
  }

  private func saveBookmark(for url: URL, key: String) {
    guard let data = try? url.bookmarkData(options: .minimalBookmark, includingResourceValuesForKeys: nil, relativeTo: nil) else {
      return
    }
    var dict = (UserDefaults.standard.dictionary(forKey: bookmarkDefaultsKey) as? [String: Data]) ?? [:]
    dict[key] = data
    UserDefaults.standard.set(dict, forKey: bookmarkDefaultsKey)
  }

  private func resolveBookmarkIfAvailable(key: String) -> URL? {
    guard let dict = UserDefaults.standard.dictionary(forKey: bookmarkDefaultsKey) as? [String: Data],
          let data = dict[key] else {
      return nil
    }
    var isStale = false
    guard let url = try? URL(resolvingBookmarkData: data, options: [], relativeTo: nil, bookmarkDataIsStale: &isStale) else {
      return nil
    }
    if isStale {
      saveBookmark(for: url, key: key)
    }
    return url
  }

  private func presentOpenPicker(allowMultiple: Bool, result: @escaping FlutterResult) {
    guard let vc = rootViewController else {
      result(FlutterError(code: "NO_VC", message: "Root view controller unavailable", details: nil))
      return
    }
    activePickerResult = result
    activePickerMode = "open"
    let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.pdf], asCopy: false)
    picker.allowsMultipleSelection = allowMultiple
    picker.delegate = self
    vc.present(picker, animated: true)
  }

  private func presentExportPicker(sourceWorkPath: String, suggestedName: String, result: @escaping FlutterResult) {
    guard let vc = rootViewController else {
      result(FlutterError(code: "NO_VC", message: "Root view controller unavailable", details: nil))
      return
    }
    let tmpExport = Self.workCacheDirectory().appendingPathComponent(suggestedName)
    try? FileManager.default.removeItem(at: tmpExport)
    do {
      try FileManager.default.copyItem(atPath: sourceWorkPath, toPath: tmpExport.path)
    } catch {
      result(FlutterError(code: "EXPORT_STAGE_FAILED", message: error.localizedDescription, details: nil))
      return
    }
    exportWorkTempURL = tmpExport
    activePickerResult = result
    activePickerMode = "export"
    let picker = UIDocumentPickerViewController(forExporting: [tmpExport], asCopy: true)
    picker.delegate = self
    vc.present(picker, animated: true)
  }

  private func presentShareSheet(sourceWorkPath: String, displayName: String, result: @escaping FlutterResult) {
    guard let vc = rootViewController else {
      result(FlutterError(code: "NO_VC", message: "Root view controller unavailable", details: nil))
      return
    }
    let tmpShare = Self.workCacheDirectory().appendingPathComponent(displayName)
    try? FileManager.default.removeItem(at: tmpShare)
    try? FileManager.default.copyItem(atPath: sourceWorkPath, toPath: tmpShare.path)
    let activityVC = UIActivityViewController(activityItems: [tmpShare], applicationActivities: nil)
    if let pop = activityVC.popoverPresentationController {
      pop.sourceView = vc.view
      pop.sourceRect = CGRect(x: vc.view.bounds.midX, y: vc.view.bounds.maxY - 64, width: 1, height: 1)
    }
    vc.present(activityVC, animated: true) {
      result(true)
    }
  }

  private func presentPrintController(sourceWorkPath: String, jobName: String, result: @escaping FlutterResult) {
    let url = URL(fileURLWithPath: sourceWorkPath)
    guard UIPrintInteractionController.canPrint(url) else {
      result(false)
      return
    }
    let printInfo = UIPrintInfo(dictionary: nil)
    printInfo.outputType = .general
    printInfo.jobName = jobName
    let controller = UIPrintInteractionController.shared
    controller.printInfo = printInfo
    controller.printingItem = url
    controller.present(animated: true) { _, completed, _ in
      result(completed)
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    let res = activePickerResult
    let mode = activePickerMode
    activePickerResult = nil
    activePickerMode = nil
    if let tmp = exportWorkTempURL {
      try? FileManager.default.removeItem(at: tmp)
      exportWorkTempURL = nil
    }

    guard let first = urls.first else {
      res?(nil)
      return
    }

    if mode == "export" {
      saveBookmark(for: first, key: first.absoluteString)
      res?([
        "uri": first.absoluteString,
        "displayName": sanitizeFileName(first.lastPathComponent),
      ])
      return
    }

    for url in urls {
      saveBookmark(for: url, key: url.absoluteString)
    }
    let size = (try? FileManager.default.attributesOfItem(atPath: first.path)[.size] as? NSNumber)?.int64Value
    res?([
      "sourceId": first.absoluteString,
      "uris": urls.map { $0.absoluteString },
      "displayName": sanitizeFileName(first.lastPathComponent),
      "sizeBytes": size as Any,
      "writable": true,
      "canPersist": true,
      "origin": "picker",
    ])
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    let res = activePickerResult
    activePickerResult = nil
    activePickerMode = nil
    if let tmp = exportWorkTempURL {
      try? FileManager.default.removeItem(at: tmp)
      exportWorkTempURL = nil
    }
    res?(nil)
  }

  private func sanitizeFileName(_ raw: String) -> String {
    let invalid = CharacterSet(charactersIn: "/\\:*?\"<>|\0")
    let cleaned = raw.components(separatedBy: invalid).joined(separator: "_").trimmingCharacters(in: .whitespacesAndNewlines)
    let nonEmpty = cleaned.isEmpty ? "document.pdf" : cleaned
    return nonEmpty.lowercased().hasSuffix(".pdf") ? nonEmpty : "\(nonEmpty).pdf"
  }
}

final class FileBridgeStreamHandler: NSObject, FlutterStreamHandler {
  private weak var plugin: FileBridgePlugin?
  init(plugin: FileBridgePlugin) { self.plugin = plugin }

  func onListen(withArguments arguments: Any?, eventSink events: @escaping FlutterEventSink) -> FlutterError? {
    plugin?.setEventSink(events)
    return nil
  }

  func onCancel(withArguments arguments: Any?) -> FlutterError? {
    plugin?.setEventSink(nil)
    return nil
  }
}
