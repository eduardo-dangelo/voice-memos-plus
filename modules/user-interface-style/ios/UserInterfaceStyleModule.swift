import ExpoModulesCore
import UIKit

public class UserInterfaceStyleModule: Module {
  public func definition() -> ModuleDefinition {
    Name("UserInterfaceStyle")

    View(UserInterfaceStyleView.self) {
      Prop("colorScheme") { (view: UserInterfaceStyleView, colorScheme: String?) in
        view.setColorScheme(colorScheme)
      }
    }
  }
}

public final class UserInterfaceStyleView: ExpoView {
  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .clear
    isUserInteractionEnabled = true
  }

  func setColorScheme(_ colorScheme: String?) {
    switch colorScheme {
    case "dark":
      overrideUserInterfaceStyle = .dark
    case "light":
      overrideUserInterfaceStyle = .light
    default:
      overrideUserInterfaceStyle = .unspecified
    }
  }
}
