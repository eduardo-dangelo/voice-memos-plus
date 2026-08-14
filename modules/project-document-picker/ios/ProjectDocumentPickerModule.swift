import ExpoModulesCore
import UniformTypeIdentifiers
import UIKit

private let projectUtiIdentifier = "com.eduardodangelo.voicememosplus.project"
private let projectFileExtension = "vmp"

public class ProjectDocumentPickerModule: Module {
  private var activeSession: PickerSession?

  public func definition() -> ModuleDefinition {
    Name("ProjectDocumentPicker")

    Function("isAvailable") {
      return true
    }

    AsyncFunction("pickProjectAsync") { (promise: Promise) in
      if self.activeSession != nil {
        promise.reject("E_PICKING_IN_PROGRESS", "A document pick is already in progress.")
        return
      }

      guard let currentVc = self.appContext?.utilities?.currentViewController() else {
        promise.reject("E_NO_VIEW_CONTROLLER", "Could not find a view controller to present the document picker.")
        return
      }

      var contentTypes: [UTType] = [UTType(exportedAs: projectUtiIdentifier)]
      if let byExtension = UTType(filenameExtension: projectFileExtension),
        byExtension.identifier != contentTypes[0].identifier {
        contentTypes.append(byExtension)
      }

      let picker = UIDocumentPickerViewController(
        forOpeningContentTypes: contentTypes,
        asCopy: true
      )
      picker.allowsMultipleSelection = false

      let session = PickerSession(promise: promise) { [weak self] in
        self?.activeSession = nil
      }
      self.activeSession = session
      picker.delegate = session
      picker.presentationController?.delegate = session

      if UIDevice.current.userInterfaceIdiom == .pad {
        let viewFrame = currentVc.view.frame
        picker.popoverPresentationController?.sourceRect = CGRect(
          x: viewFrame.midX,
          y: viewFrame.maxY,
          width: 0,
          height: 0
        )
        picker.popoverPresentationController?.sourceView = currentVc.view
        picker.modalPresentationStyle = .pageSheet
      }

      currentVc.present(picker, animated: true)
    }.runOnQueue(.main)

    AsyncFunction("copyIncomingProjectAsync") { (uri: String) -> String in
      let source = projectFileURL(from: uri)
      let accessed = source.startAccessingSecurityScopedResource()
      defer {
        if accessed {
          source.stopAccessingSecurityScopedResource()
        }
      }

      let cached = try copyProjectToCaches(source)
      return cached.absoluteString
    }

    AsyncFunction("stampProjectTypeAsync") { (uri: String) in
      let source = projectFileURL(from: uri)
      // URLResourceValues.typeIdentifier/contentType are get-only. Best-effort stamp
      // via NSURL; iOS may still derive the type from the .vmp extension.
      try? (source as NSURL).setResourceValue(
        projectUtiIdentifier,
        forKey: .typeIdentifierKey
      )
    }
  }
}

private final class PickerSession: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private let promise: Promise
  private let onFinished: () -> Void
  private var settled = false

  init(promise: Promise, onFinished: @escaping () -> Void) {
    self.promise = promise
    self.onFinished = onFinished
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    guard let url = urls.first else {
      finishCanceled()
      return
    }

    do {
      let cached = try copyProjectToCaches(url)
      finish([
        "canceled": false,
        "uri": cached.absoluteString,
        "name": url.lastPathComponent,
      ])
    } catch {
      finishError("E_COPY_FAILED", error.localizedDescription)
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    finishCanceled()
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    finishCanceled()
  }

  private func finishCanceled() {
    finish(["canceled": true])
  }

  private func finish(_ value: [String: Any]) {
    guard !settled else {
      return
    }
    settled = true
    promise.resolve(value)
    onFinished()
  }

  private func finishError(_ code: String, _ message: String) {
    guard !settled else {
      return
    }
    settled = true
    promise.reject(code, message)
    onFinished()
  }
}

private func projectFileURL(from uri: String) -> URL {
  if let url = URL(string: uri), url.isFileURL {
    return url
  }
  return URL(fileURLWithPath: uri)
}

private func copyProjectToCaches(_ source: URL) throws -> URL {
  let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first
    ?? URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
  let directory = caches.appendingPathComponent("ProjectDocumentPicker", isDirectory: true)
  try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)

  let uniqueName = "\(UUID().uuidString)-\(source.lastPathComponent)"
  let destination = directory.appendingPathComponent(uniqueName)
  if FileManager.default.fileExists(atPath: destination.path) {
    try FileManager.default.removeItem(at: destination)
  }
  try FileManager.default.copyItem(at: source, to: destination)
  return destination
}
