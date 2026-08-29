import AVFoundation
import ExpoModulesCore

public class AudioSessionLatencyModule: Module {
  public func definition() -> ModuleDefinition {
    Name("AudioSessionLatency")

    Function("isAvailable") {
      return true
    }

    Function("getIoLatency") {
      let session = AVAudioSession.sharedInstance()
      return [
        "inputLatency": session.inputLatency,
        "outputLatency": session.outputLatency,
        "ioBufferDuration": session.ioBufferDuration,
      ]
    }
  }
}
