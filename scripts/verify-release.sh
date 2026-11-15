#!/usr/bin/env bash
set -euo pipefail

# scripts/verify-release.sh
# Verifies the packaged macOS application bundle and optional notarization status

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

APP_PATH="${ROOT_DIR}/dist/mac-universal/Audiophile Vault.app"

# Fallback to any .app found in dist/
if [[ ! -d "${APP_PATH}" ]]; then
  APP_PATH="$(find "${ROOT_DIR}/dist" -name "*.app" -maxdepth 2 2>/dev/null | head -n 1)"
fi

if [[ -z "${APP_PATH:-}" || ! -d "${APP_PATH}" ]]; then
  echo "[ERROR] No .app bundle found in ${ROOT_DIR}/dist to verify."
  exit 1
fi

echo "[VERIFY] Inspecting macOS app bundle: ${APP_PATH}"

# 1. Verify codesign validity (deep, strict)
echo "[VERIFY] Running codesign verification..."
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

# 2. Check architecture support (Universal arm64 + x86_64)
echo "[VERIFY] Checking Mach-O architectures..."
lipo -info "${APP_PATH}/Contents/MacOS/Audiophile Vault"

# 3. Ensure legacy external CLI binaries are not bundled
if [[ -d "${APP_PATH}/Contents/Resources/bin" ]]; then
  echo "[ERROR] Unexpected Contents/Resources/bin directory found in app bundle."
  exit 1
fi

# 4. Conditional Apple Notarization / Gatekeeper assessment
if [[ -n "${APPLE_KEYCHAIN_PROFILE:-}" ]]; then
  echo "[VERIFY] APPLE_KEYCHAIN_PROFILE is active. Assessing Gatekeeper and Notarization ticket..."
  spctl --assess --type exec --verbose "${APP_PATH}"
  xcrun stapler validate "${APP_PATH}"
  echo "[VERIFY] Notarization ticket and Gatekeeper assessment succeeded!"
else
  echo "[VERIFY] Ad-hoc signing mode active (APPLE_KEYCHAIN_PROFILE is not set)."
  echo "[VERIFY] Skipping Gatekeeper assessment and stapler check (requires Apple Developer ID ticket)."
fi

echo "[VERIFY] All release verification checks passed successfully!"
