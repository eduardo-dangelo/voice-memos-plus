#!/usr/bin/env node

const path = require('path');

const { stripPushEntitlementFile } = require('../plugins/stripWidgetsPushEntitlement');

const iosRoot = path.join(__dirname, '..', 'ios');
const changed = stripPushEntitlementFile(iosRoot);

if (changed) {
  console.log('Removed aps-environment from VoiceMemosPlus.entitlements');
}
