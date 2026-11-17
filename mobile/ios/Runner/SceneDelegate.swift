import Flutter
import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene else { return }
    let engine = FlutterEngine(name: "gullacpdf_scene_engine")
    engine.run()
    GeneratedPluginRegistrant.register(with: engine)

    let flutterVC = FlutterViewController(engine: engine, nibName: nil, bundle: nil)
    FileBridgePlugin.shared.attach(to: engine, rootViewController: flutterVC)

    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = flutterVC
    window.makeKeyAndVisible()
    self.window = window

    if !connectionOptions.urlContexts.isEmpty {
      FileBridgePlugin.shared.handleOpenURLContexts(connectionOptions.urlContexts)
    } else {
      FileBridgePlugin.shared.checkPendingShareExtensionImports()
    }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    FileBridgePlugin.shared.handleOpenURLContexts(URLContexts)
  }

  func sceneDidBecomeActive(_ scene: UIScene) {
    FileBridgePlugin.shared.checkPendingShareExtensionImports()
  }
}
