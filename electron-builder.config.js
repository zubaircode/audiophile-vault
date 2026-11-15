import fs from 'node:fs';

/**
 * electron-builder configuration for Audiophile Vault.
 *
 * Conditional Signing Strategy:
 * - When APPLE_KEYCHAIN_PROFILE is NOT set:
 *     Uses ad-hoc signing (`identity: "-"`) with Hardened Runtime enabled and forceCodeSigning disabled.
 *     Allows immediate local packaging of Universal (.dmg / .app) without an Apple Developer ID.
 * - When APPLE_KEYCHAIN_PROFILE IS set:
 *     Auto-discovers the Developer ID Application certificate (`identity: undefined`), enforces code signing,
 *     and triggers notarization.
 */
const isDevIdSigning = Boolean(process.env.APPLE_KEYCHAIN_PROFILE);

const extraResources = [];

// Include compiled macOS adaptive asset catalog (Assets.car) if present
if (fs.existsSync('build/Assets.car')) {
  extraResources.push({
    from: 'build/Assets.car',
    to: '.',
  });
}

const config = {
  appId: 'com.audiophilevault.app',
  productName: 'Audiophile Vault',
  directories: {
    output: 'dist',
  },
  files: [
    'electron/**/*',
    'server/**/*',
    'client/dist/**/*',
    'package.json',
  ],
  extraResources,
  mac: {
    icon: 'build/icon.icns',
    category: 'public.app-category.music',
    target: [
      {
        target: 'dmg',
        arch: ['universal'],
      },
    ],
    minimumSystemVersion: '12.0.0',
    hardenedRuntime: true,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.inherit.plist',
    identity: isDevIdSigning ? undefined : '-',
    forceCodeSigning: isDevIdSigning,
    notarize: isDevIdSigning ? true : false,
    extendInfo: {
      CFBundleName: 'Audiophile Vault',
      CFBundleDisplayName: 'Audiophile Vault',
      CFBundleIconName: 'AppIcon',
      NSMusicUsageDescription:
        'Audiophile Vault needs access to your Music library to index, organize, and export your lossless audio tracks and playlists.',
      NSRemovableVolumesUsageDescription:
        'Audiophile Vault needs access to removable SD cards and USB volumes to synchronize your music library and universal playlists.',
      NSAppleEventsUsageDescription:
        'Audiophile Vault uses AppleScript to present native macOS folder selection dialogs.',
    },
  },
  dmg: {
    icon: 'build/icon.icns',
    sign: isDevIdSigning,
  },
};

export default config;
