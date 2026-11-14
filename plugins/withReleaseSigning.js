/**
 * Config plugin: signs release builds with the keystore described by environment
 * variables (ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS,
 * ANDROID_KEY_PASSWORD). Without them, release builds fall back to the debug key
 * so that local builds keep working.
 */
const { withAppBuildGradle } = require('expo/config-plugins');

const RELEASE_SIGNING_CONFIG = `
        release {
            if (System.getenv("ANDROID_KEYSTORE_PATH")) {
                storeFile file(System.getenv("ANDROID_KEYSTORE_PATH"))
                storePassword System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias System.getenv("ANDROID_KEY_ALIAS")
                keyPassword System.getenv("ANDROID_KEY_PASSWORD")
            }
        }`;

const SIGNING_CONFIGS = /signingConfigs\s*\{/;
const RELEASE_BUILD_TYPE =
  /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/;

/** Returns the content of app/build.gradle with the release signing config added. */
function applyReleaseSigning(gradle) {
  if (gradle.includes('System.getenv("ANDROID_KEYSTORE_PATH")')) {
    return gradle;
  }
  if (!SIGNING_CONFIGS.test(gradle)) {
    throw new Error('withReleaseSigning: signingConfigs block not found in app/build.gradle');
  }
  if (!RELEASE_BUILD_TYPE.test(gradle.replace(SIGNING_CONFIGS, ''))) {
    throw new Error('withReleaseSigning: release build type not found in app/build.gradle');
  }
  return gradle
    .replace(SIGNING_CONFIGS, (match) => `${match}${RELEASE_SIGNING_CONFIG}`)
    .replace(
      RELEASE_BUILD_TYPE,
      '$1signingConfig System.getenv("ANDROID_KEYSTORE_PATH") ? signingConfigs.release : signingConfigs.debug',
    );
}

function withReleaseSigning(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = applyReleaseSigning(mod.modResults.contents);
    return mod;
  });
}

module.exports = withReleaseSigning;
module.exports.applyReleaseSigning = applyReleaseSigning;
