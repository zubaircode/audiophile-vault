# Audiophile Vault

**Audiophile Vault** is a native macOS desktop application built to automate organizing, curating, and syncing DRM-free music libraries to a mounted SD card for use in a dedicated Digital Audio Player (DAP).

---

## Mission & Overview

Managing a lossless or DRM-free music collection for dedicated hardware DAPs (such as HiBy, Sony Walkman, or RTOS-based players like the Snowsky Echo Nano) often involves tedious manual folder cleanup, inconsistent cover art, and fragile playlist formatting. Audiophile Vault eliminates that friction by maintaining a single, clean master vault on macOS and automating differential SD card synchronization with hardware-compliant playlists.

---

## Project Scope & Key Features

- **DRM-Free Music Ingestion into a Flat Vault Structure:**
  - Recursively scans a source music directory (such as Apple Music's media folder) and copies all validated, DRM-free tracks into a single flat master directory (`~/Music/AudiophileVault/`) using a deterministic naming standard: `{Artist} - {Album} - {DiscTrack} - {Title}.{ext}`.
  - Enforces strict DRM-free checks: allows `.mp3`, `.m4a`, `.flac`, `.alac`, `.wav`, `.aiff`, and `.aac`; explicitly rejects `.m4p`, `.wma`, `.aa`, and `.aax`; scans MP4/M4A containers for FairPlay `drms`/`sinf` atoms; and verifies `AVURLAsset.hasProtectedContent == false` alongside SHA-256 deduplication.
- **Playlist Creation & Management:**
  - Create, rename, duplicate, and delete playlists, and reorder tracks via drag-and-drop in the library and playlist sidebar.
- **Built-In Audio Playback:**
  - Native HTML5 audio playback backed by HTTP `206 Partial Content` byte-range streaming for instant seeking across lossless and compressed tracks, paired with a decoupled playback queue and **Jump to Now Playing** navigation.
- **In-Process Cover Art & Tag Curation:**
  - Extracts, embeds, replaces, and removes album artwork directly inside `.mp3`, `.flac`, and `.m4a`/ALAC containers without external CLI binaries, plus an artist-verified online artwork lookup waterfall (iTunes -> Deezer -> MusicBrainz / Cover Art Archive).
- **Automated SD Card Sync & Safe Ejection:**
  - Detects mounted removable volumes under `/Volumes/`, performs incremental `/usr/bin/rsync` synchronization to the target SD card, and safely unmounts/ejects the card via native macOS `NSWorkspace`.
- **Universal `.m3u` Playlist Generation:**
  - Generates `.m3u` playlists formatted specifically for Android and embedded RTOS DAPs: UTF-8 without BOM, Windows CRLF (`\r\n`) line endings, and relative forward-slash paths with no leading `/` or `./`.
- **Optional Playlist Folder Duplication (SNOWSKY Mode):**
  - For RTOS DAPs that do not reliably parse `.m3u` files, **SNOWSKY Mode** duplicates each playlist's tracks into dedicated root-level folders on the SD card prefixed with their 1-based playback index (`001 - {filename}`), auto-enabling for `SNOWSKY` volumes with manual override support.

---

## Architecture & Context Reference

Audiophile Vault ships as a lightweight (~5.3 MB) native macOS `.app` bundle combining a Swift `WKWebView` host with a React frontend:

- **`macos-swift/`** — Native Swift 5.9 macOS host (`AppKit`, `WebKit`, `AVFoundation`, `ImageIO`, `CryptoKit`) providing custom URL scheme asset/cover/audio serving (`VaultSchemeHandler`), RPC/SSE bridging (`avBridge` / `SSEEventBus`), container tag/artwork embedding (`ArtworkAndTagService`), DRM-free ingestion (`LibraryService`), `.m3u` generation (`PlaylistService`), and `/usr/bin/rsync` SD sync (`VolumeAndSyncService`).
- **`client/`** — React 18, Vite 5, Tailwind CSS 3, and TanStack Table 8 frontend compiled into `client/dist/` and embedded inside the `.app` bundle.
- **`scripts/`** — Packaging and icon build automation (`scripts/build-swift-app.sh`).

For complete architectural details, `.vault_index.json` schemas, API contracts, collation rules, and DAP playlist specifications, see **[AUDIOPHILE_VAULT_CONTEXT.md](./AUDIOPHILE_VAULT_CONTEXT.md)** (also available as [AUDIOPHILE_VAULT_CONTEXT.pdf](./AUDIOPHILE_VAULT_CONTEXT.pdf)).

---

## Local Build & Execution

### Prerequisites

- **macOS 14.0+** (Sonoma or Sequoia)
- **Xcode / Swift 5.9+ Command Line Tools** (`swift --version`)
- **Node.js `>= 20.0.0`** and `npm`

### 1. Install Frontend Dependencies

```bash
npm install
```

### 2. Run Frontend in Development (Optional)

To iterate on the React/Tailwind UI with Vite HMR alongside the local dev server:

```bash
npm run dev
```

### 3. Build the Native macOS `.app` Bundle

Compile the React frontend (`client/dist/`), build the Release Swift binary (`macos-swift/`), and package & ad-hoc sign `dist/Audiophile Vault.app`:

```bash
npm run build:app
# or directly:
bash scripts/build-swift-app.sh
```

The standalone bundle is written to `dist/Audiophile Vault.app`. You can install it to `/Applications` or launch it directly:

```bash
open "dist/Audiophile Vault.app"
```

### 4. Run Native Self-Test Diagnostics

```bash
"dist/Audiophile Vault.app/Contents/MacOS/Audiophile Vault" --self-test
```
