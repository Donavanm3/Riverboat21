'use strict';
// Final Android tweaks after `cap sync`: AdMob app id, version number, and release signing (if a key is provided).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', 'android');
const manifestPath = path.join(root, 'app', 'src', 'main', 'AndroidManifest.xml');
const gradlePath = path.join(root, 'app', 'build.gradle');

// Google's official TEST app id is used until you set ADMOB_APP_ID (test ads only, never real money).
const ADMOB_APP_ID = process.env.ADMOB_APP_ID || 'ca-app-pub-3940256099942544~3347511713';
let manifest = fs.readFileSync(manifestPath, 'utf8');
const meta = `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" android:value="${ADMOB_APP_ID}"/>`;
if (manifest.includes('com.google.android.gms.ads.APPLICATION_ID')) {
  manifest = manifest.replace(/<meta-data android:name="com\.google\.android\.gms\.ads\.APPLICATION_ID"[^>]*\/>/, meta);
} else {
  manifest = manifest.replace('</application>', `    ${meta}\n    </application>`);
}
fs.writeFileSync(manifestPath, manifest);

let gradle = fs.readFileSync(gradlePath, 'utf8');
const code = Math.max(1, parseInt(process.env.VERSION_CODE || '1', 10));
gradle = gradle.replace(/versionCode \d+/, `versionCode ${code}`).replace(/versionName "[^"]*"/, `versionName "1.0.${code}"`);

if (process.env.ANDROID_KEYSTORE_BASE64) {
  fs.writeFileSync(path.join(root, 'app', 'upload.jks'), Buffer.from(process.env.ANDROID_KEYSTORE_BASE64, 'base64'));
  if (!gradle.includes('// rb21-signing')) {
    gradle += `
// rb21-signing (added by scripts/patch-android.js)
android {
    signingConfigs {
        release {
            storeFile file("upload.jks")
            storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_KEY_ALIAS") ?: "upload"
            keyPassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
        }
    }
    buildTypes { release { signingConfig signingConfigs.release } }
}
`;
  }
  console.log('release signing configured');
} else console.log('no signing key: building a debug APK for testing');
fs.writeFileSync(gradlePath, gradle);
console.log(`android patched (AdMob app ${ADMOB_APP_ID}, version 1.0.${code})`);
