const fs = require('fs');
const path = require('path');

const { withEntitlementsPlist } = require('expo/config-plugins');

/**
 * expo-widgets always writes aps-environment even when enablePushNotifications is false.
 * We only use local Live Activity updates, so strip the push entitlement to avoid
 * requiring the Push Notifications capability in the provisioning profile.
 */
function withStripWidgetsPushEntitlement(config) {
  const nextConfig = withEntitlementsPlist(config, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });

  return withEntitlementsPlist(nextConfig, (mod) => {
    delete mod.modResults['aps-environment'];
    return mod;
  });
}

module.exports = withStripWidgetsPushEntitlement;

/**
 * Post-prebuild fallback when entitlements are materialized to disk.
 */
function stripPushEntitlementFile(iosProjectRoot, projectName = 'VoiceMemosPlus') {
  const entitlementsPath = path.join(iosProjectRoot, projectName, `${projectName}.entitlements`);

  if (!fs.existsSync(entitlementsPath)) {
    return false;
  }

  const contents = fs.readFileSync(entitlementsPath, 'utf8');
  const stripped = contents.replace(
    /\s*<key>aps-environment<\/key>\s*<string>[^<]*<\/string>\s*/g,
    '\n'
  );

  if (stripped === contents) {
    return false;
  }

  fs.writeFileSync(entitlementsPath, stripped);
  return true;
}

module.exports.stripPushEntitlementFile = stripPushEntitlementFile;
