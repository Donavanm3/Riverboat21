'use strict';
// Final iOS tweaks after `cap sync ios`: AdMob app id + ad network ids, tracking text, export-compliance flag.
const fs = require('fs');
const path = require('path');
const plistPath = path.join(__dirname, '..', 'ios', 'App', 'App', 'Info.plist');

// Google's official iOS TEST app id is used until you set ADMOB_APP_ID_IOS (test ads only).
const ADMOB_APP_ID_IOS = process.env.ADMOB_APP_ID_IOS || 'ca-app-pub-3940256099942544~1458002511';
let plist = fs.readFileSync(plistPath, 'utf8');
const entries = {
  GADApplicationIdentifier: `<string>${ADMOB_APP_ID_IOS}</string>`,
  NSUserTrackingUsageDescription: '<string>Ads help keep Riverboat 21 free. This lets ads be more relevant to you.</string>',
  ITSAppUsesNonExemptEncryption: '<false/>',
  SKAdNetworkItems: '<array>\n\t\t<dict>\n\t\t\t<key>SKAdNetworkIdentifier</key>\n\t\t\t<string>cstr6suwn9.skadnetwork</string>\n\t\t</dict>\n\t</array>',
};
for (const [key, value] of Object.entries(entries)) {
  const re = new RegExp(`\\t<key>${key}</key>\\n\\t(<string>[^<]*</string>|<false/>|<true/>|<array>[\\s\\S]*?</array>)\\n`);
  const line = `\t<key>${key}</key>\n\t${value}\n`;
  if (re.test(plist)) plist = plist.replace(re, line);
  else plist = plist.replace(/<\/dict>\s*<\/plist>\s*$/, `${line}</dict>\n</plist>\n`);
}
fs.writeFileSync(plistPath, plist);
console.log(`ios patched (AdMob app ${ADMOB_APP_ID_IOS})`);
