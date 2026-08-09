import ExpoModulesCore
import UIKit

public class ShareFilesModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ShareFiles")

    Function("isAvailable") {
      return true
    }

    AsyncFunction("shareFilesAsync") { (urls: [String], promise: Promise) in
      guard !urls.isEmpty else {
        promise.reject("E_NO_URLS", "No files to share.")
        return
      }

      let fileUrls: [URL] = urls.compactMap { raw in
        if let url = URL(string: raw), url.isFileURL {
          return url
        }
        return URL(fileURLWithPath: raw)
      }

      guard fileUrls.count == urls.count else {
        promise.reject("E_INVALID_URL", "One or more share URLs were invalid.")
        return
      }

      for url in fileUrls {
        guard FileManager.default.isReadableFile(atPath: url.path) else {
          promise.reject("E_FILE_UNREADABLE", "Could not read file: \(url.lastPathComponent)")
          return
        }
      }

      guard let currentVc = self.appContext?.utilities?.currentViewController() else {
        promise.reject("E_NO_VIEW_CONTROLLER", "Could not find a view controller to present the share sheet.")
        return
      }

      let activityController = UIActivityViewController(
        activityItems: fileUrls,
        applicationActivities: nil
      )

      activityController.completionWithItemsHandler = { _, _, _, _ in
        promise.resolve(nil)
      }

      if UIDevice.current.userInterfaceIdiom == .pad {
        let viewFrame = currentVc.view.frame
        activityController.popoverPresentationController?.sourceRect = CGRect(
          x: viewFrame.midX,
          y: viewFrame.maxY,
          width: 0,
          height: 0
        )
        activityController.popoverPresentationController?.sourceView = currentVc.view
        activityController.modalPresentationStyle = .pageSheet
      }

      currentVc.present(activityController, animated: true)
    }
    .runOnQueue(.main)
  }
}
