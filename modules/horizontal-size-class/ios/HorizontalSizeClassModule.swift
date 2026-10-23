import ExpoModulesCore
import UIKit

public class HorizontalSizeClassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("HorizontalSizeClass")

    Events("onChange")

    Function("getHorizontalSizeClass") { () -> String in
      HorizontalSizeClassProbe.currentSizeClass()
    }

    OnStartObserving {
      HorizontalSizeClassProbe.shared.start { [weak self] value in
        self?.sendEvent("onChange", ["horizontalSizeClass": value])
      }
    }

    OnStopObserving {
      HorizontalSizeClassProbe.shared.stop()
    }
  }
}

/// Invisible view in the key window. Folding the Duo changes this trait.
final class HorizontalSizeClassProbe: UIView {
  static let shared = HorizontalSizeClassProbe(frame: .zero)

  private var onChange: ((String) -> Void)?
  private var windowObserver: NSObjectProtocol?
  private var traitRegistration: Any?

  override init(frame: CGRect) {
    super.init(frame: frame)
    isHidden = true
    isUserInteractionEnabled = false
    autoresizingMask = []
    if #available(iOS 17.0, *) {
      traitRegistration = registerForTraitChanges([UITraitHorizontalSizeClass.self]) {
        (view: Self, previous: UITraitCollection) in
        guard view.traitCollection.horizontalSizeClass != previous.horizontalSizeClass else {
          return
        }
        view.publish()
      }
    }
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  static func currentSizeClass() -> String {
    name(for: keyWindow()?.traitCollection.horizontalSizeClass ?? .unspecified)
  }

  func start(onChange: @escaping (String) -> Void) {
    DispatchQueue.main.async {
      self.onChange = onChange
      if self.windowObserver == nil {
        self.windowObserver = NotificationCenter.default.addObserver(
          forName: UIWindow.didBecomeKeyNotification,
          object: nil,
          queue: .main
        ) { [weak self] _ in
          self?.attachToKeyWindow()
        }
      }
      self.attachToKeyWindow()
    }
  }

  func stop() {
    DispatchQueue.main.async {
      self.onChange = nil
      if let windowObserver = self.windowObserver {
        NotificationCenter.default.removeObserver(windowObserver)
        self.windowObserver = nil
      }
      self.removeFromSuperview()
    }
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    publish()
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    if #available(iOS 17.0, *) {
      return
    }
    guard traitCollection.horizontalSizeClass != previousTraitCollection?.horizontalSizeClass else {
      return
    }
    publish()
  }

  private func attachToKeyWindow() {
    guard let window = Self.keyWindow() else {
      return
    }
    if superview !== window {
      removeFromSuperview()
      window.addSubview(self)
    }
    publish()
  }

  private func publish() {
    onChange?(Self.name(for: traitCollection.horizontalSizeClass))
  }

  private static func keyWindow() -> UIWindow? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap(\.windows)
      .first(where: \.isKeyWindow)
  }

  private static func name(for sizeClass: UIUserInterfaceSizeClass) -> String {
    switch sizeClass {
    case .compact:
      return "compact"
    case .regular:
      return "regular"
    default:
      return "unspecified"
    }
  }
}
