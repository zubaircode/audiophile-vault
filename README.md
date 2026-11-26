# Audiophile Vault (v2.1.3)

**Audiophile Vault** is a lightweight (~5.5 MB), native macOS desktop application built to organize, curate, and wirelessly or physically sync DRM-free music libraries to a Digital Audio Player (DAP).

Built with **Swift (`AppKit` + `WKWebView` + `Network.framework`)** hosting a **React + Vite + Tailwind CSS** interface, Audiophile Vault eliminates Electron, bundled Node.js runtimes, and external CLI binaries (`ffmpeg`, `metaflac`) in favor of native macOS frameworks (`AVFoundation`, `ImageIO`, `CryptoKit`, `WKURLSchemeHandler`) and in-process container tag/artwork embedding.

---

## Core Features (v2.1.3)

- **DRM-Free Library Curation:**
  - Recursively scans your macOS Music source directory and copies validated, DRM-free audio (`.mp3`, `.m4a`, `.flac`, `.alac`, `.wav`, `.aiff`, `.aac`) into a single flat master vault (`~/Music/AudiophileVault/`) using Full Archive Standard naming: `{Artist} - {Album} - {DiscTrack} - {Title}.{ext}`.
  - Enforces strict DRM-free filtering: rejects `.m4p`, `.wma`, `.aa`, and `.aax`; inspects MP4/M4A containers for FairPlay `drms`/`sinf` atoms; verifies `AVURLAsset.hasProtectedContent == false`; and deduplicates via SHA-256 + normalized metadata keys.
- **Scored Multi-Provider Artwork Engine & Manual Override:**
  - Artist-anchored lookup waterfall (**iTunes Search API -> Deezer -> MusicBrainz Cover Art Archive**) with canonical normalization, mandatory artist similarity gating (`>= 0.80`), tribute/karaoke penalties, and a `>= 0.75` confidence threshold.
  - Interactive Artwork Inspector modal with drag-and-drop, native `NSOpenPanel` file browsing, online re-download, and in-process per-track, per-disc, or album-wide cover embedding/stripping (no external `ffmpeg` or `metaflac` binaries).
- **Dual Sync Targets (Removable SD Card + Wireless Bonjour FTP):**
  - **Removable SD Card:** Incremental `/usr/bin/rsync` synchronization to mounted `/Volumes/` targets, optional **SNOWSKY Mode** (`Music/Library/` + `Music/<Playlist>/` subfolders without `.m3u` files), and safe native `NSWorkspace` volume ejection.
  - **Wi-Fi FTP (`Bonjour` Auto-Discovery):** Zero-config `_ftp._tcp.local.` Bonjour discovery (e.g. `WiFiFTP`), interactive remote folder browser with atomic write-permission verification (`STOR`/`DELE` probe), size-only delta sync (Android 13 SAF compatible), and safe playlist updates (`DELE` before `STOR`).
- **Universal DAP Playlist Builder:**
  - Create, rename, duplicate, and reorder playlists with drag-and-drop; exports universal `.m3u` playlists (UTF-8 without BOM, Windows CRLF `\r\n` line endings, relative forward-slash paths) compatible with Android players (Poweramp, HiBy Music) and embedded RTOS players (Snowsky Echo Nano).
- **Integrated Playback & Native macOS UI:**
  - HTTP `206 Partial Content` byte-range audio streaming via `WKURLSchemeHandler` (`av://localhost`), decoupled `queueSource` with **Jump to Now Playing**, locked cover art column with drag-resizable text columns, native transparent titlebar window dragging, and GPU cross-faded Light/Dark themes.

---

## Architecture & Context Reference

- **`macos-swift/`** — Native Swift 5.9 macOS host (`AppDelegate`, `MainWindowController`, `WebViewController`, `VaultSchemeHandler`, `BonjourFtpBrowser`, `LibraryService`, `ArtworkAndTagService`, `PlaylistService`, `VolumeAndSyncService`).
- **`client/`** — React 18, Vite 5, Tailwind CSS 3, and TanStack Table 8 frontend compiled into `client/dist/`.
- **`scripts/build-swift-app.sh`** — Production build script packaging `dist/Audiophile Vault.app`.

For full schemas, API contracts, collation rules, and system design details, see **[AUDIOPHILE_VAULT_CONTEXT.md](./AUDIOPHILE_VAULT_CONTEXT.md)**.

---

## Build, Run & Package Instructions

### Prerequisites

- **macOS 14.0+** (Sonoma or Sequoia)
- **Xcode / Swift 5.9+ Command Line Tools** (`swift --version`)
- **Node.js `>= 20.0.0`** and `npm`

### 1. Install Frontend Dependencies

```bash
npm install
```

### 2. Build the Native macOS `.app` Bundle

Compile `client/dist/`, build the Release Swift binary, and package & sign `dist/Audiophile Vault.app`:

```bash
./scripts/build-swift-app.sh
```

### 3. Install & Run

Copy the built bundle to `/Applications` and launch it:

```bash
rm -rf "/Applications/Audiophile Vault.app"
cp -R "dist/Audiophile Vault.app" "/Applications/Audiophile Vault.app"
open -a "/Applications/Audiophile Vault.app"
```

### 4. Verify Version & Self-Test

```bash
defaults read "/Applications/Audiophile Vault.app/Contents/Info.plist" CFBundleShortVersionString
"/Applications/Audiophile Vault.app/Contents/MacOS/Audiophile Vault" --self-test
```
