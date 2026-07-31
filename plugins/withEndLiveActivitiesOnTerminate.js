const fs = require('fs');
const path = require('path');

const { withAppDelegate, withDangerousMod } = require('expo/config-plugins');

const CLEANUP_MARKER = 'public enum ExpoWidgetsLiveActivityCleanup';

const CLEANUP_SWIFT = `
/// Best-effort end of all Expo Live Activities from the app process (e.g. willTerminate).
@available(iOS 16.1, *)
public enum ExpoWidgetsLiveActivityCleanup {
  public static func endAllImmediately() {
    let semaphore = DispatchSemaphore(value: 0)
    Task {
      for activity in Activity<LiveActivityAttributes>.activities {
        await activity.end(nil, dismissalPolicy: .immediate)
      }
      semaphore.signal()
    }
    _ = semaphore.wait(timeout: .now() + 2.0)
  }
}
`;

const WILL_TERMINATE_MARKER = 'ExpoWidgetsLiveActivityCleanup.endAllImmediately';

function ensureCleanupInExpoWidgets(projectRoot) {
  const target = path.join(
    projectRoot,
    'node_modules',
    'expo-widgets',
    'ios',
    'Widgets',
    'WidgetLiveActivity.swift'
  );
  if (!fs.existsSync(target)) {
    return;
  }
  const contents = fs.readFileSync(target, 'utf8');
  if (contents.includes(CLEANUP_MARKER)) {
    return;
  }
  fs.writeFileSync(target, `${contents.trimEnd()}\n${CLEANUP_SWIFT}`);

  // Remove obsolete standalone file if present (CocoaPods won't see new files without pod install).
  const orphan = path.join(
    projectRoot,
    'node_modules',
    'expo-widgets',
    'ios',
    'LiveActivityCleanup.swift'
  );
  if (fs.existsSync(orphan)) {
    fs.unlinkSync(orphan);
  }
}

function injectWillTerminate(contents) {
  if (contents.includes(WILL_TERMINATE_MARKER)) {
    return contents;
  }

  let next = contents;
  if (!/import ExpoWidgets/.test(next)) {
    next = next.replace(
      'internal import Expo\n',
      'internal import Expo\ninternal import ExpoWidgets\n'
    );
  } else {
    next = next.replace(
      /^(?:public |package |private )?import ExpoWidgets$/m,
      'internal import ExpoWidgets'
    );
  }

  const method = `
  public override func applicationWillTerminate(_ application: UIApplication) {
    if #available(iOS 16.1, *) {
      ExpoWidgetsLiveActivityCleanup.endAllImmediately()
    }
    super.applicationWillTerminate(application)
  }
`;

  if (next.includes('applicationWillTerminate')) {
    return next;
  }

  if (next.includes('  // Linking API')) {
    return next.replace('  // Linking API', `${method}\n  // Linking API`);
  }

  return next.replace(
    '\nclass ReactNativeDelegate:',
    `${method}\nclass ReactNativeDelegate:`
  );
}

function withEndLiveActivitiesOnTerminate(config) {
  config = withDangerousMod(config, [
    'ios',
    async (mod) => {
      ensureCleanupInExpoWidgets(mod.modRequest.projectRoot);
      return mod;
    },
  ]);

  config = withAppDelegate(config, (mod) => {
    if (mod.modResults.language !== 'swift') {
      return mod;
    }
    mod.modResults.contents = injectWillTerminate(mod.modResults.contents);
    return mod;
  });

  return config;
}

module.exports = withEndLiveActivitiesOnTerminate;

if (require.main === module) {
  ensureCleanupInExpoWidgets(path.join(__dirname, '..'));
}
