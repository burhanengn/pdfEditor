import Social
import UIKit
import UniformTypeIdentifiers

/// Pure native Swift iOS Share Extension (04 §5.2):
/// Loads ZERO Flutter engine runtime to stay comfortably inside iOS's ~120 MB extension limit.
/// Streams shared PDFs into the shared App Group container and records a pending import manifest.
final class ShareViewController: UIViewController {
  private let appGroupId = "group.dev.gullacpdf.mobile"
  private let statusLabel = UILabel()

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = UIColor.systemBackground

    statusLabel.translatesAutoresizingMaskIntoConstraints = false
    statusLabel.textAlignment = .center
    statusLabel.numberOfLines = 0
    statusLabel.font = UIFont.preferredFont(forTextStyle: .headline)
    statusLabel.text = NSLocalizedString("Saving to gullacpdf…", comment: "Share Extension saving")
    view.addSubview(statusLabel)

    NSLayoutConstraint.activate([
      statusLabel.centerXAnchor.constraint(equalTo: view.centerXAnchor),
      statusLabel.centerYAnchor.constraint(equalTo: view.centerYAnchor),
      statusLabel.leadingAnchor.constraint(greaterThanOrEqualTo: view.leadingAnchor, constant: 24),
      statusLabel.trailingAnchor.constraint(lessThanOrEqualTo: view.trailingAnchor, constant: -24),
    ])

    processSharedPdfItems()
  }

  private func processSharedPdfItems() {
    guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
      finishExtension(message: "No PDF item found.")
      return
    }

    for item in items {
      for provider in item.attachments ?? [] {
        if provider.hasItemConformingToTypeIdentifier(UTType.pdf.identifier) {
          provider.loadFileRepresentation(forTypeIdentifier: UTType.pdf.identifier) { [weak self] url, error in
            DispatchQueue.main.async {
              guard let self = self else { return }
              if let srcURL = url {
                self.stagePdfToAppGroup(sourceURL: srcURL)
              } else {
                self.finishExtension(message: error?.localizedDescription ?? "Failed reading PDF.")
              }
            }
          }
          return
        }
      }
    }

    finishExtension(message: "Unsupported file type. gullacpdf accepts PDFs.")
  }

  private func stagePdfToAppGroup(sourceURL: URL) {
    guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroupId) else {
      finishExtension(message: "App Group container not configured.")
      return
    }
    let pendingDir = container.appendingPathComponent("PendingImports", isDirectory: true)
    try? FileManager.default.createDirectory(at: pendingDir, withIntermediateDirectories: true)

    let rawName = sourceURL.lastPathComponent.isEmpty ? "shared.pdf" : sourceURL.lastPathComponent
    let fileKey = "\(Int(Date().timeIntervalSince1970 * 1000))_\(rawName)"
    let destURL = pendingDir.appendingPathComponent(fileKey)

    do {
      if FileManager.default.fileExists(atPath: destURL.path) {
        try FileManager.default.removeItem(at: destURL)
      }
      try FileManager.default.copyItem(at: sourceURL, to: destURL)
      let manifest: [String: Any] = [
        "id": UUID().uuidString,
        "displayName": rawName,
        "filePath": fileKey,
        "createdAtMs": Int(Date().timeIntervalSince1970 * 1000),
      ]
      let manifestData = try JSONSerialization.data(withJSONObject: manifest, options: [])
      let manifestURL = pendingDir.appendingPathComponent("latest.json")
      try manifestData.write(to: manifestURL, options: .atomic)
      finishExtension(message: "Saved \"\(rawName)\" to gullacpdf. Open gullacpdf to view.")
    } catch {
      finishExtension(message: "Failed saving PDF: \(error.localizedDescription)")
    }
  }

  private func finishExtension(message: String) {
    statusLabel.text = message
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.9) { [weak self] in
      self?.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
    }
  }
}
