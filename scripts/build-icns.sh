#!/usr/bin/env bash
set -euo pipefail

# scripts/build-icns.sh
# 1. Compiles build/icon-light-1024.png into native macOS build/icon.icns using sips and iconutil
# 2. Compiles macOS adaptive asset catalog (build/Assets.car) with Light, Dark, and Clear/Tinted renditions
#    Fails the build (set -e) if Assets.car is missing or lacks Dark / Tinted renditions.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build"
SRC_LIGHT="${BUILD_DIR}/icon-light-1024.png"
SRC_DARK="${BUILD_DIR}/icon-dark-1024.png"
SRC_CLEAR="${BUILD_DIR}/icon-clear-1024.png"
SRC_PNG="${BUILD_DIR}/icon-1024.png"

# Fallback to icon-1024.png if icon-light-1024.png is not present
if [[ ! -f "${SRC_LIGHT}" && -f "${SRC_PNG}" ]]; then
  SRC_LIGHT="${SRC_PNG}"
fi

if [[ ! -f "${SRC_LIGHT}" ]]; then
  echo "[ICNS ERROR] Source master icon ${SRC_LIGHT} does not exist. Run generate-icon.mjs first."
  exit 1
fi

ICONSET_DIR="${BUILD_DIR}/icon.iconset"
OUT_ICNS="${BUILD_DIR}/icon.icns"

echo "[ICNS] Creating iconset directory at ${ICONSET_DIR}..."
rm -rf "${ICONSET_DIR}"
mkdir -p "${ICONSET_DIR}"

# Array of icon targets: "width height filename"
SIZES=(
  "16 16 icon_16x16.png"
  "32 32 icon_16x16@2x.png"
  "32 32 icon_32x32.png"
  "64 64 icon_32x32@2x.png"
  "128 128 icon_128x128.png"
  "256 256 icon_128x128@2x.png"
  "256 256 icon_256x256.png"
  "512 512 icon_256x256@2x.png"
  "512 512 icon_512x512.png"
  "1024 1024 icon_512x512@2x.png"
)

echo "[ICNS] Generating Apple standard and Retina icon resolutions using /usr/bin/sips..."
for item in "${SIZES[@]}"; do
  read -r width height filename <<< "${item}"
  target_file="${ICONSET_DIR}/${filename}"
  sips -z "${width}" "${height}" "${SRC_LIGHT}" --out "${target_file}" >/dev/null 2>&1
done

echo "[ICNS] Compiling iconset into ${OUT_ICNS} using /usr/bin/iconutil..."
iconutil -c icns "${ICONSET_DIR}" -o "${OUT_ICNS}"

echo "[ICNS] Cleaning up temporary iconset directory..."
rm -rf "${ICONSET_DIR}"

if [[ -f "${OUT_ICNS}" ]]; then
  file_size=$(ls -lh "${OUT_ICNS}" | awk '{print $5}')
  echo "[ICNS] Successfully generated Apple ICNS icon: ${OUT_ICNS} (${file_size})"
else
  echo "[ICNS ERROR] Failed to produce ${OUT_ICNS}"
  exit 1
fi

# ==============================================================================
# Compile macOS Asset Catalog (build/Assets.car) via actool
# ==============================================================================
if ! xcrun --find actool >/dev/null 2>&1; then
  echo "[ASSETS ERROR] actool is required to build adaptive macOS icons but was not found."
  exit 1
fi

echo "[ASSETS] Found Xcode actool. Preparing asset catalogs for adaptive Light, Dark, and Tinted icons..."
XCSETS_DIR="${BUILD_DIR}/Assets.xcassets"
APPICON_SET="${XCSETS_DIR}/AppIcon.appiconset"
APPICON_IMG="${XCSETS_DIR}/AppIcon.imageset"
ICON_BUNDLE="${BUILD_DIR}/AppIcon.icon"

rm -rf "${XCSETS_DIR}" "${ICON_BUNDLE}"
mkdir -p "${APPICON_SET}" "${APPICON_IMG}" "${ICON_BUNDLE}/Assets"

# 1. Assets.xcassets root catalog
cat << 'EOF' > "${XCSETS_DIR}/Contents.json"
{
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
EOF

# 2. AppIcon.appiconset with all standard macOS icon slots for Light, Dark, and Tinted
python3 -c '
import json, subprocess, os

sizes = [
    ("16x16", "1x", 16),
    ("16x16", "2x", 32),
    ("32x32", "1x", 32),
    ("32x32", "2x", 64),
    ("128x128", "1x", 128),
    ("128x128", "2x", 256),
    ("256x256", "1x", 256),
    ("256x256", "2x", 512),
    ("512x512", "1x", 512),
    ("512x512", "2x", 1024),
]

appicon_set = "'"${APPICON_SET}"'"
src_light = "'"${SRC_LIGHT}"'"
src_dark = "'"${SRC_DARK}"'"
src_clear = "'"${SRC_CLEAR}"'"

images = []
for size_str, scale_str, px in sizes:
    fn_l = f"icon_light_{size_str}@{scale_str}.png"
    fn_d = f"icon_dark_{size_str}@{scale_str}.png"
    fn_t = f"icon_tinted_{size_str}@{scale_str}.png"

    subprocess.run(["sips", "-z", str(px), str(px), src_light, "--out", os.path.join(appicon_set, fn_l)], capture_output=True, check=True)
    subprocess.run(["sips", "-z", str(px), str(px), src_dark, "--out", os.path.join(appicon_set, fn_d)], capture_output=True, check=True)
    subprocess.run(["sips", "-z", str(px), str(px), src_clear, "--out", os.path.join(appicon_set, fn_t)], capture_output=True, check=True)

    images.append({
        "idiom": "mac",
        "size": size_str,
        "scale": scale_str,
        "filename": fn_l
    })
    images.append({
        "idiom": "mac",
        "size": size_str,
        "scale": scale_str,
        "filename": fn_d,
        "appearances": [{"appearance": "luminosity", "value": "dark"}]
    })
    images.append({
        "idiom": "mac",
        "size": size_str,
        "scale": scale_str,
        "filename": fn_t,
        "appearances": [{"appearance": "luminosity", "value": "tinted"}]
    })

with open(os.path.join(appicon_set, "Contents.json"), "w") as f:
    json.dump({"images": images, "info": {"author": "xcode", "version": 1}}, f, indent=2)
'

# 3. AppIcon.imageset: direct appearance-based renditions for macOS CoreUI
cat << 'EOF' > "${APPICON_IMG}/Contents.json"
{
  "images" : [
    {
      "idiom" : "universal",
      "filename" : "icon-light-1024.png",
      "scale" : "1x"
    },
    {
      "idiom" : "universal",
      "filename" : "icon-dark-1024.png",
      "scale" : "1x",
      "appearances" : [
        {
          "appearance" : "luminosity",
          "value" : "dark"
        }
      ]
    },
    {
      "idiom" : "universal",
      "filename" : "icon-clear-1024.png",
      "scale" : "1x",
      "appearances" : [
        {
          "appearance" : "luminosity",
          "value" : "tinted"
        }
      ]
    }
  ],
  "info" : {
    "author" : "xcode",
    "version" : 1
  }
}
EOF
cp "${SRC_LIGHT}" "${APPICON_IMG}/icon-light-1024.png"
cp "${SRC_DARK}" "${APPICON_IMG}/icon-dark-1024.png"
cp "${SRC_CLEAR}" "${APPICON_IMG}/icon-clear-1024.png"

# 4. AppIcon.icon: modern layered Icon Composer document for macOS Sequoia/Sonoma
if [[ -f "${BUILD_DIR}/headphones-dark.svg" ]]; then
  cp "${BUILD_DIR}/headphones-dark.svg" "${ICON_BUNDLE}/Assets/headphones-light.svg"
else
  cp "${BUILD_DIR}/icon-clear.svg" "${ICON_BUNDLE}/Assets/headphones-light.svg"
fi

if [[ -f "${BUILD_DIR}/headphones-bright.svg" ]]; then
  cp "${BUILD_DIR}/headphones-bright.svg" "${ICON_BUNDLE}/Assets/headphones-dark.svg"
  cp "${BUILD_DIR}/headphones-bright.svg" "${ICON_BUNDLE}/Assets/headphones-tinted.svg"
else
  cp "${BUILD_DIR}/icon-clear.svg" "${ICON_BUNDLE}/Assets/headphones-dark.svg"
  cp "${BUILD_DIR}/icon-clear.svg" "${ICON_BUNDLE}/Assets/headphones-tinted.svg"
fi

cat << 'EOF' > "${ICON_BUNDLE}/icon.json"
{
  "fill" : {
    "automatic-gradient" : "extended-srgb:0.95000,0.95000,0.96000,1.00000"
  },
  "fill-specializations" : [
    {
      "appearance" : "dark",
      "fill" : {
        "automatic-gradient" : "extended-srgb:0.12000,0.12000,0.14000,1.00000"
      }
    }
  ],
  "groups" : [
    {
      "layers" : [
        {
          "image-name" : "headphones-light.svg",
          "image-name-specializations" : [
            {
              "appearance" : "dark",
              "image-name" : "headphones-dark.svg"
            },
            {
              "appearance" : "tinted",
              "image-name" : "headphones-tinted.svg"
            }
          ]
        }
      ]
    }
  ],
  "supported-platforms" : {
    "squares" : [
      "macOS"
    ]
  }
}
EOF

# 5. Compile into build/Assets.car with actool
echo "[ASSETS] Invoking actool to compile Assets.car..."
PARTIAL_PLIST="${BUILD_DIR}/partial-icon-info.plist"
xcrun actool "${XCSETS_DIR}" "${ICON_BUNDLE}" \
  --compile "${BUILD_DIR}" \
  --platform macosx \
  --minimum-deployment-target 14.0 \
  --app-icon AppIcon \
  --output-partial-info-plist "${PARTIAL_PLIST}"

# Clean up temporary compilation sources
rm -rf "${XCSETS_DIR}" "${ICON_BUNDLE}" "${PARTIAL_PLIST}"
if [[ -f "${BUILD_DIR}/AppIcon.icns" ]]; then
  rm -f "${BUILD_DIR}/AppIcon.icns"
fi

OUT_CAR="${BUILD_DIR}/Assets.car"
if [[ ! -f "${OUT_CAR}" ]]; then
  echo "[ASSETS ERROR] actool finished but ${OUT_CAR} was not created."
  exit 1
fi

# 6. Verify that Assets.car contains both Dark and Tinted renditions
echo "[ASSETS] Verifying Dark and Tinted appearances inside ${OUT_CAR}..."
VERIFY_OUTPUT=$(python3 -c '
import json, subprocess, sys
res = subprocess.run(["xcrun", "assetutil", "--info", "'"${OUT_CAR}"'"], capture_output=True, text=True)
if res.returncode != 0:
    print(f"FAIL: assetutil failed: {res.stderr}")
    sys.exit(1)

info = json.loads(res.stdout)
has_dark = any(
    x.get("Appearance") in ["NSAppearanceNameDarkAqua", "dark"] or
    "dark" in str(x.get("RenditionName", "")).lower()
    for x in info
)
has_tinted = any(
    x.get("Appearance") in ["ISAppearanceTintable", "tinted"] or
    "tinted" in str(x.get("RenditionName", "")).lower()
    for x in info
)

if not has_dark:
    print("FAIL: Assets.car is missing Dark appearance rendition.")
    sys.exit(1)
if not has_tinted:
    print("FAIL: Assets.car is missing Tinted appearance rendition.")
    sys.exit(1)

print("PASS")
')

if [[ "${VERIFY_OUTPUT}" != *"PASS"* ]]; then
  echo "[ASSETS ERROR] Verification failed: ${VERIFY_OUTPUT}"
  exit 1
fi

car_size=$(ls -lh "${OUT_CAR}" | awk '{print $5}')
echo "[ASSETS] Successfully compiled and verified macOS adaptive Asset Catalog: ${OUT_CAR} (${car_size})"
