#!/usr/bin/env bash
set -euo pipefail

# scripts/build-swift-app.sh
# Compiles client/dist/, builds the native macOS Swift WKWebView host (macos-swift/),
# and packages the standalone "dist/Audiophile Vault.app" bundle.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SWIFT_DIR="${ROOT_DIR}/macos-swift"
DIST_DIR="${ROOT_DIR}/dist"
APP_NAME="Audiophile Vault.app"
APP_BUNDLE="${DIST_DIR}/${APP_NAME}"

cd "${ROOT_DIR}"

echo "[1/4] Building React + Tailwind frontend (client/dist/)..."
if [[ -f "${ROOT_DIR}/client/package.json" ]]; then
  npm run build --prefix client
else
  npm run build:client
fi

if [[ ! -f "${ROOT_DIR}/build/icon.icns" ]]; then
  echo "[1b/4] Generating macOS app icon..."
  npm run icon:build
fi

echo "[2/4] Compiling native macOS Swift executable (Release)..."
cd "${SWIFT_DIR}"
swift build -c release
BIN_PATH="$(swift build -c release --show-bin-path)/AudiophileVault"

if [[ ! -f "${BIN_PATH}" ]]; then
  echo "[ERROR] Compiled Swift binary not found at ${BIN_PATH}"
  exit 1
fi

echo "[3/4] Packaging ${APP_BUNDLE}..."
rm -rf "${APP_BUNDLE}"
mkdir -p "${APP_BUNDLE}/Contents/MacOS"
mkdir -p "${APP_BUNDLE}/Contents/Resources/client"

cp "${BIN_PATH}" "${APP_BUNDLE}/Contents/MacOS/Audiophile Vault"
chmod +x "${APP_BUNDLE}/Contents/MacOS/Audiophile Vault"
strip -x "${APP_BUNDLE}/Contents/MacOS/Audiophile Vault" 2>/dev/null || true

cp -R "${ROOT_DIR}/client/dist" "${APP_BUNDLE}/Contents/Resources/client/dist"

if [[ -f "${ROOT_DIR}/build/icon.icns" ]]; then
  cp "${ROOT_DIR}/build/icon.icns" "${APP_BUNDLE}/Contents/Resources/icon.icns"
  cp "${ROOT_DIR}/build/icon.icns" "${APP_BUNDLE}/Contents/Resources/AppIcon.icns"
fi

if [[ -f "${ROOT_DIR}/build/Assets.car" ]]; then
  cp "${ROOT_DIR}/build/Assets.car" "${APP_BUNDLE}/Contents/Resources/Assets.car"
fi

cat > "${APP_BUNDLE}/Contents/Info.plist" << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Audiophile Vault</string>
  <key>CFBundleExecutable</key>
  <string>Audiophile Vault</string>
  <key>CFBundleIconFile</key>
  <string>icon</string>
  <key>CFBundleIconName</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.audiophilevault.app</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Audiophile Vault</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>2.1.3</string>
  <key>CFBundleVersion</key>
  <string>2.1.3</string>
  <key>NSHumanReadableCopyright</key>
  <string>© 2026 Zubair Anwar</string>
  <key>LSMinimumSystemVersion</key>
  <string>14.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSSupportsAutomaticGraphicsSwitching</key>
  <true/>
  <key>NSMusicUsageDescription</key>
  <string>Audiophile Vault needs access to your Music library to index, organize, and export your lossless audio tracks and playlists.</string>
  <key>NSRemovableVolumesUsageDescription</key>
  <string>Audiophile Vault needs access to removable SD cards and USB volumes to synchronize your music library and universal playlists.</string>
  <key>NSLocalNetworkUsageDescription</key>
  <string>Audiophile Vault uses Bonjour on your local network to automatically discover your player's Wi-Fi FTP server for wireless music syncing.</string>
  <key>NSBonjourServices</key>
  <array>
    <string>_ftp._tcp</string>
  </array>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
  </dict>
</dict>
</plist>
EOF

echo -n "APPL????" > "${APP_BUNDLE}/Contents/PkgInfo"

echo "[4/4] Signing ${APP_BUNDLE}..."
codesign --force --deep --sign - "${APP_BUNDLE}"
codesign --verify --deep --strict "${APP_BUNDLE}"

echo ""
echo "✅ Native Swift app built successfully:"
du -sh "${APP_BUNDLE}"
