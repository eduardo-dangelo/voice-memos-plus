import ExpoModulesCore
import AVFoundation

public class AudioEncodeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioEncode")

    Function("isAvailable") {
      return true
    }

    AsyncFunction("encodeWavToM4a") { (inputUri: String, outputUri: String) in
      let inputURL = Self.fileURL(from: inputUri)
      let outputURL = Self.fileURL(from: outputUri)

      if FileManager.default.fileExists(atPath: outputURL.path) {
        try FileManager.default.removeItem(at: outputURL)
      }

      let asset = AVURLAsset(url: inputURL)

      guard let exportSession = AVAssetExportSession(
        asset: asset,
        presetName: AVAssetExportPresetAppleM4A
      ) else {
        throw EncodeError.sessionCreationFailed
      }

      exportSession.outputURL = outputURL
      exportSession.outputFileType = .m4a

      try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        exportSession.exportAsynchronously {
          switch exportSession.status {
          case .completed:
            continuation.resume()
          case .failed:
            continuation.resume(throwing: exportSession.error ?? EncodeError.exportFailed)
          case .cancelled:
            continuation.resume(throwing: EncodeError.exportCancelled)
          default:
            continuation.resume(throwing: EncodeError.exportFailed)
          }
        }
      }
    }
  }

  private static func fileURL(from uri: String) -> URL {
    if uri.hasPrefix("file://") {
      return URL(string: uri) ?? URL(fileURLWithPath: uri)
    }
    return URL(fileURLWithPath: uri)
  }
}

private enum EncodeError: LocalizedError {
  case sessionCreationFailed
  case exportFailed
  case exportCancelled

  var errorDescription: String? {
    switch self {
    case .sessionCreationFailed:
      return "Could not create an AAC export session."
    case .exportFailed:
      return "Failed to encode audio to M4A."
    case .exportCancelled:
      return "M4A encoding was cancelled."
    }
  }
}
