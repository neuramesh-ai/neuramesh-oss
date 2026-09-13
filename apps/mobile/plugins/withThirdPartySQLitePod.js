// op-sqlite (via @powersync/op-sqlite) bundles its own SQLite. On the iOS 18 SDK that
// EAS builds against, expo-updates' system-SQLite import collides with op-sqlite's
// public sqlite3.h ("redefinition of sqlite3_file" → "could not build module SQLite3").
// The documented fix is to tell expo-updates to use the third-party (op-sqlite) SQLite
// pod instead of the system one — set as a Podfile property so it survives EAS prebuild.
// (Local Xcode 26 / iOS 26 SDK doesn't hit this, which is why the sim build works.)
const { withPodfileProperties } = require('expo/config-plugins');

module.exports = (config) =>
  withPodfileProperties(config, (cfg) => {
    cfg.modResults['expo.updates.useThirdPartySQLitePod'] = 'true';
    return cfg;
  });
