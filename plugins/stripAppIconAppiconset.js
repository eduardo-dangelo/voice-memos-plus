const fs = require('fs');
const path = require('path');

const { withDangerousMod, IOSConfig } = require('expo/config-plugins');

/**
 * When ios.icon points at an Icon Composer `.icon` bundle, Expo still leaves a
 * legacy Images.xcassets/AppIcon.appiconset (single light PNG) from earlier
 * prebuilds. That catalog can win over the `.icon` liquid-glass appearances on
 * the home screen. Strip it after icon generation.
 */
function withStripAppIconAppiconset(config) {
  return withDangerousMod(config, [
    'ios',
    async (mod) => {
      const iosIcon = mod.ios?.icon;
      if (typeof iosIcon !== 'string' || path.extname(iosIcon) !== '.icon') {
        return mod;
      }

      const projectName = IOSConfig.XcodeUtils.getProjectName(mod.modRequest.projectRoot);
      const appiconset = path.join(
        mod.modRequest.platformProjectRoot,
        projectName,
        'Images.xcassets',
        'AppIcon.appiconset'
      );

      if (fs.existsSync(appiconset)) {
        fs.rmSync(appiconset, { recursive: true, force: true });
      }

      return mod;
    },
  ]);
}

module.exports = withStripAppIconAppiconset;
