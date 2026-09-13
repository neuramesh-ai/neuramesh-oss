// React Native 0.79 vendors an old {fmt} that uses C++20 `consteval` for compile-time
// format-string checking. Xcode 26.4's Clang (Apple clang 21) tightened consteval
// enforcement, so the fmt pod no longer compiles:
//   Pods/fmt/include/fmt/format-inl.h: error: call to consteval function
//   'fmt::basic_format_string<...>::basic_format_string<FMT_COMPILE_STRING, 0>'
//   is not a constant expression
// Apple now REQUIRES the iOS 26 SDK (Xcode 26) for App Store uploads, so we can't just
// pin an older Xcode. Fix: compile ONLY the fmt pod as C++17 — `consteval` doesn't exist
// before C++20, so fmt's own feature detection sets FMT_USE_CONSTEVAL=0 and falls back to
// runtime format-string validation, skipping the broken path. The consteval templates live
// in format-inl.h, which is included solely by fmt/src/format.cc (the fmt pod's own TU), so
// scoping the standard downgrade to the 'fmt' target is sufficient — and necessary, since
// C++17 would break other React Native pods.
//
// CRITICAL: the loop must run AFTER react_native_post_install(installer, ...) in the
// post_install block. That RN helper iterates every pod target and re-sets the C++ standard
// to c++20, so a fmt override placed *before* it gets clobbered (this is exactly why the
// first attempt failed — fmt still compiled as c++20). We inject right after the
// react_native_post_install(...) call so our setting is the last writer and wins.
//
// Injected into the prebuild-generated Podfile because apps/mobile/ios is gitignored
// (managed workflow; EAS runs `expo prebuild`), mirroring withThirdPartySQLitePod.
const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = "t.name == 'fmt'";
const INJECT = `
    # {fmt} fails under Xcode 26.4 Clang consteval strictness (RN 0.79's vendored fmt).
    # Build ONLY the fmt pod as C++17 so its C++20 consteval format-string path is skipped.
    # MUST be after react_native_post_install above, which re-sets C++20 on every pod.
    installer.pods_project.targets.each do |t|
      if t.name == 'fmt'
        t.build_configurations.each do |bc|
          bc.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
        end
      end
    end
`;

module.exports = function withFmtCxx17(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfile = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');
      if (contents.includes(MARKER)) return cfg;

      // Inject AFTER the react_native_post_install(...) call so our fmt override is the
      // last writer of CLANG_CXX_LANGUAGE_STANDARD and is not clobbered back to c++20.
      const afterRNPI = /react_native_post_install\([\s\S]*?\n\s*\)/;
      if (afterRNPI.test(contents)) {
        contents = contents.replace(afterRNPI, (m) => `${m}\n${INJECT}`);
      } else {
        // Fallback for a Podfile without the standard RN helper: inject at the top of the
        // post_install block (still applies; nothing else here re-sets the standard).
        contents = contents.replace(/(post_install do \|installer\|\n)/, `$1${INJECT}`);
      }
      fs.writeFileSync(podfile, contents, 'utf8');
      return cfg;
    },
  ]);
};
