# Audiophile Vault (AV) — System Architecture & Technical Specification

**Project Name:** `audiophile-vault`  
**Repository Working Directory:** `pepper-music`  
**Bundle Identifier:** `com.audiophilevault.app` (`v2.0.0`, targeting macOS 14.0+ Sonoma / Sequoia)  
**Application Type:** Native macOS Swift `WKWebView` Audiophile Music Manager, In-Process Lossless Tag/Artwork Curator, and RTOS/Android SD Card Sync Engine (~5.3 MB standalone `.app` bundle)  
**Core Technologies:** Swift 5.9 (AppKit, WebKit, AVFoundation, ImageIO, CryptoKit, UniformTypeIdentifiers), React 18, Vite 5, Tailwind CSS 3 (Class-Based Dark Mode), TanStack Table 8

---

## 1. Architecture Overview & Directory Map

Audiophile Vault runs as a self-contained native macOS Swift application (`macos-swift/`) hosting the compiled React + Vite + Tailwind frontend (`client/dist/`) inside a custom `WKWebView` (`DraggableWebView`). There is no embedded browser runtime or external Node.js server required in production, and zero bundled external CLI tagging/transcoding binaries.

### Native Swift Host & Bridge Architecture

1. **Custom URL Scheme (`av://localhost/` via `VaultSchemeHandler`):**
   - Serves compiled static frontend assets from `Contents/Resources/client/dist/`.
   - Serves embedded album cover art directly from audio containers (`/api/artwork/:baseName`, `/covers/:filename`).
   - Streams audio files (`/api/stream/:filename`) with full **HTTP `206 Partial Content`** byte-range support (`Range` / `Content-Range`) for instant lossless scrubbing and seeking.
2. **Typed RPC & Event Bridge (`avBridge` via `WKScriptMessageHandlerWithReply`):**
   - An injected document-start JavaScript shim intercepts `/api/*` `fetch()` calls and `EventSource` subscriptions (`/api/import/progress`, `/api/artwork/progress`, `/api/sync/progress`) and routes them over `window.webkit.messageHandlers.avBridge` to native Swift services (`LibraryService`, `ArtworkAndTagService`, `PlaylistService`, `VolumeAndSyncService`) via `SSEEventBus`.
3. **Native macOS AppKit & System Integrations:**
   - **Window Management (`MainWindowController.swift`):** Unified transparent titlebar (`fullSizeContentView`), `NSWindow` frame autosave (`AudiophileVaultMainWindow`), `isMovableByWindowBackground = true`, and synchronized `DraggableWebView` top-bar dragging (`performDrag`) & double-click zoom (`performZoom`) with interactive control exclusions (`[data-no-drag]`).
   - **File Picker (`WebViewController.swift`):** `WKUIDelegate` implements `webView(_:runOpenPanelWith:initiatedByFrame:completionHandler:)` using `NSOpenPanel` sheet modals filtered to `[.jpeg, .png, .webP, .image]` for manual artwork uploads.
   - **External Storage & Sync (`VolumeAndSyncService.swift`):** Enumerates `/Volumes/` using `URLResourceValues` (`volumeIsRemovableKey`, `volumeIsEjectableKey`, `volumeAvailableCapacityForImportantUsageKey`), protects system volumes, executes incremental differential syncs via `/usr/bin/rsync`, and safely ejects volumes via `NSWorkspace.shared.unmountAndEjectDevice(at:)`.
   - **Image Normalization (`ArtworkAndTagService.swift`):** Uses `ImageIO` / `CoreGraphics` to normalize uploaded or fetched cover images into clean baseline JPEGs.

### Repository Directory Tree

```
pepper-music/
├── AUDIOPHILE_VAULT_CONTEXT.md             # Canonical system architecture specification (Markdown)
├── AUDIOPHILE_VAULT_CONTEXT.pdf            # Standalone PDF export of this specification
├── index.html                              # Vite SPA entry template (inline dark/light bootstrapper)
├── package.json                            # Frontend build scripts & React/Vite/Tailwind dependencies
├── tailwind.config.js                      # Tailwind CSS config (darkMode: 'class')
├── vite.config.js                          # Vite build configuration
│
├── macos-swift/                            # Native macOS Swift Package (macOS 14.0+)
│   ├── Package.swift                       # SwiftPM manifest linking AppKit, WebKit, AVFoundation, ImageIO, CryptoKit
│   └── Sources/AudiophileVault/
│       ├── main.swift                      # Entry point & CLI diagnostics (--self-test, --test-artwork-search, --test-drm-check)
│       ├── AppDelegate.swift               # App lifecycle, native menu bar, Cmd+F search shortcut, single-window activation
│       ├── MainWindowController.swift      # NSWindow setup, transparent titlebar, frame autosave, movability
│       ├── WebViewController.swift         # DraggableWebView, avBridge RPC router, WKUIDelegate NSOpenPanel, JS shims
│       ├── VaultSchemeHandler.swift        # av://localhost static asset, cover art, and HTTP 206 byte-range audio streamer
│       ├── LibraryService.swift            # .vault_index.json atomic store, DRM-free ingestion, SHA-256 deduplication
│       ├── ArtworkAndTagService.swift      # Zero-CLI container tagger/embedder & scored multi-provider artwork engine
│       ├── PlaylistService.swift           # Universal CRLF .m3u playlist generator & CRUD manager
│       └── VolumeAndSyncService.swift      # /Volumes/ inspector, /usr/bin/rsync sync, SNOWSKY folder export, NSWorkspace eject
│
├── client/                                 # React 18 + Tailwind CSS frontend
│   ├── main.jsx                            # React root mount
│   ├── App.jsx                             # Root coordinator, SSE listeners, toast/console state, modal orchestration
│   ├── index.css                           # Global scrollbar, View Transitions CSS, and native window drag exclusions
│   ├── components/
│   │   ├── Header.jsx                      # Bar 1: Top drag bar, theme switch, stats, SNOWSKY mode toggle, settings trigger
│   │   ├── UnifiedControlBar.jsx           # Bar 2: Now Playing banner, transport controls, target SD selector, Ingest/Sync/Eject
│   │   ├── TrackTable.jsx                  # Virtualized track table with locked 56px artwork column & resizable text columns
│   │   ├── Sidebar.jsx                     # Library & playlist navigation, drag-and-drop reordering, CRUD
│   │   ├── ArtworkModal.jsx                # Artwork inspector: Save Image, online Download Artwork, Browse Image, Remove Art
│   │   ├── SettingsModal.jsx               # Source, Vault, and Target SD Card directory configuration
│   │   ├── ContextMenu.jsx                 # Track context menu (Play, Add to Playlist, Inspect Artwork)
│   │   └── LogViewer.jsx                   # Collapsible real-time Activity Console
│   ├── context/
│   │   ├── PlayerContext.jsx               # HTML5 Audio playback state & decoupled queueSource tracking
│   │   └── ThemeContext.jsx                # GPU double-buffered Light/Dark switcher via View Transitions API
│   └── utils/
│       └── sorting.js                      # Smart release key collation, A-Z normalization, compilation & album sibling helpers
│
├── scripts/
│   ├── build-swift-app.sh                  # Production build script: Vite build -> Release Swift build -> .app packaging -> codesign
│   ├── generate-icon.mjs / build-icns.sh   # App icon generation pipeline
│   └── verify-release.sh                   # Release bundle verification helper
│
└── tests/
    ├── playlists.test.js                   # Universal M3U CRLF & relative-path compliance tests
    └── sorting.test.js                     # Smart release collation & search matching tests
```

---

## 2. Native Bridge & API Contract

Frontend components communicate with the Swift host over standard `fetch('/api/...')` and `EventSource('/api/.../progress')` interfaces, transparently bridged to Swift via `avBridge` and `VaultSchemeHandler`:

| Method | Endpoint | Native Swift Handler |
| :--- | :--- | :--- |
| `GET` / `POST` | `/api/config` | Reads or updates `VaultConfig` (`sourcePath`, `vaultPath`, `sdCardPath`, `exportPlaylistFolders`, `snowskyModeUserOverride`) and vault stats. |
| `GET` | `/api/volumes` | Lists mounted removable/ejectable external volumes in `/Volumes/` with free space via `URLResourceValues`. |
| `GET` | `/api/tracks` | Returns all indexed tracks from `.vault_index.json` sorted deterministically. |
| `GET` | `/api/stream/:filename` | Streams audio via `VaultSchemeHandler` with HTTP `206 Partial Content` byte-range seeking. |
| `GET` | `/api/artwork/:baseName` | Extracts and serves embedded artwork directly from the audio container (or `/covers/:filename`). |
| `GET` | `/api/artwork/:baseName/download` | Triggers native `NSSavePanel` export of the embedded artwork. |
| `POST` / `DELETE` | `/api/artwork/:baseName` | Embeds or strips cover art in-process across a single track, disc, or album group (`saveManualArtwork` / `deleteManualArtwork`). |
| `POST` | `/api/artwork/backfill` | Runs scored online artwork lookup for library, playlist, or explicit `trackKeys`. |
| `POST` | `/api/artwork/stop` | Cancels active artwork backfill. |
| `GET` / `POST` / `PUT` / `DELETE` | `/api/playlists*` | Full playlist CRUD, duplication, track add/remove, and drag-and-drop track reordering; syncs `.m3u` files on disk. |
| `POST` | `/api/import` | Starts recursive DRM-free ingestion pipeline (`LibraryService.runIngestionPipeline`). |
| `POST` | `/api/sync` | Starts incremental `/usr/bin/rsync` sync + `.m3u` export (+ SNOWSKY folder export when enabled). |
| `POST` | `/api/eject` | Safely unmounts and ejects the target volume via `NSWorkspace.shared.unmountAndEjectDevice(at:)`. |
| `GET` (SSE) | `/api/import/progress`, `/api/artwork/progress`, `/api/sync/progress` | Real-time Activity Console event streams pushed via `SSEEventBus`. |

---

## 3. Zero-CLI Tagging, Artwork Engine & DRM Enforcement

### In-Process Container Tagging & Artwork Embedding
All metadata parsing, artwork extraction, artwork embedding, and artwork stripping run natively in Swift inside `ArtworkAndTagService.swift` with zero external binary dependencies:
- **MP3 / AIFF:** Pure-Swift ID3v2 (`APIC` frame) reader, writer, and stripper.
- **FLAC:** Pure-Swift `METADATA_BLOCK_PICTURE` & `VORBIS_COMMENT` / `STREAMINFO` parser, writer, and stripper.
- **M4A / ALAC / AAC:** Pure-Swift ISO Base Media File Format (`moov`/`udta`/`meta`/`ilst`/`covr`) atom transformer that recalculates `stco` / `co64` chunk offsets so audio playback and seeking remain lossless and uncorrupted.
- **Image Normalization:** `ImageIO` (`CGImageSource` / `CGImageDestination`) validates and converts uploaded/downloaded images to clean baseline JPEG (`max 1200px`) before embedding.

### Scored Multi-Provider Artwork Lookup Engine
`ArtworkAndTagService.swift` implements a strict three-tier waterfall (**iTunes Search API -> Deezer Public API -> MusicBrainz / Cover Art Archive**) with mandatory artist verification:

1. **Artist-Anchored Query Hierarchy (`limit=10` per provider):**
   - **Standard Albums:** Uses `effectiveArtist = albumArtist ?? artist` and queries `"{cleanedArtist} {cleanedAlbum}"` (iTunes), `artist:"{artist}" album:"{album}"` / `"{artist} {album}"` (Deezer), and `release:"{album}" AND artist:"{artist}"` (MusicBrainz). Unanchored album-only or artist-only fallbacks are strictly forbidden for standard albums.
   - **Compilations & Soundtracks:** Detected via `compilation == true` or `albumArtist` matching `"Various Artists"`, `"Soundtrack"`, `"Original Soundtrack"`, or `"OST"`. Queries by `"{cleanedAlbum}"` (or `"{cleanedAlbum} soundtrack"`) and verifies against `"Various Artists"` / soundtrack credits or contributing track artists.
2. **Canonical Normalization & Similarity Scoring (`scoreCandidate`):**
   - `normalizeForComparison` folds case and diacritics, converts `&` and `+` to `and`, strips punctuation, and removes leading `"the "`.
   - **Mandatory Artist Match Gate (`>= 0.80`):** Every candidate's normalized artist must match the expected artist (exact, whole-phrase containment, or `max(levenshteinSimilarity, tokenSimilarity) >= 0.80`). Any mismatched artist is rejected immediately, even on a 100% album title match.
   - **Tribute / Karaoke / Cover Filtering:** Hard-rejects `"karaoke"`, `"tribute to"`, `"in the style of"`, `"made famous by"`, and `"ringtone"`, and penalizes `"tribute"`, `"cover"`, and `"instrumental"` (`-0.45`) unless present in the source tags.
   - **Confidence Threshold (`>= 0.75`):** Selects the highest-scoring candidate (`artistScore * 0.45 + albumScore * 0.55 - penalty`) with `combinedScore >= 0.75`; otherwise returns `NOT_FOUND`.
3. **Album-Level Cache & Invalidation:**
   - Results are cached in `albumArtCache` by canonical `(normalizeForComparison(effectiveArtist), normalizeForComparison(cleanedAlbum))`. Removing artwork via `deleteManualArtwork` immediately invalidates the album's cache entry so re-running **Download Artwork** performs a fresh online lookup.

### Strict DRM-Free Ingestion Gate
`LibraryService.swift` enforces a multi-layer DRM-free gate before any file is copied into `~/Music/AudiophileVault/` or indexed in `.vault_index.json`:
1. **Strict Extension Allowlist:** Only `.mp3`, `.m4a`, `.flac`, `.alac`, `.wav`, `.aiff`, and `.aac` (case-insensitive) are accepted.
2. **Explicit DRM Format Exclusion:** `.m4p`, `.wma`, `.aa`, and `.aax` are immediately rejected and logged as `[DRM SKIP] {filename}`.
3. **Container & `AVFoundation` Protection Checks:**
   - `hasMp4ProtectionAtoms(filePath:)` scans the `moov` box of `.m4a`/`.alac`/`.aac` files for `drms` or `sinf` FairPlay atoms.
   - `AVURLAsset` verifies `hasProtectedContent == false`, `isPlayable == true`, and non-empty `loadTracks(withMediaType: .audio)`.
   - Any protected or unplayable stream is logged as `[DRM SKIP] {filename}` and excluded from the vault and summary (`skippedDrm`).

---

## 4. `.vault_index.json` Schema, Filename Standard & Collation

The canonical index is stored atomically (write `.tmp` + rename) at `~/Music/AudiophileVault/.vault_index.json` (or `~/.audiophile-vault/.vault_index.json` fallback):

```json
{
  "updatedAt": "2026-11-15T19:35:00.000Z",
  "config": {
    "sourcePath": "~/Music/Music/Media.localized/Music/",
    "vaultPath": "~/Music/AudiophileVault/",
    "sdCardPath": "/Volumes/SNOWSKY/",
    "exportPlaylistFolders": true,
    "snowskyModeUserOverride": false
  },
  "tracks": {
    "queen|greatest hits|101|bohemian rhapsody": {
      "trackKey": "queen|greatest hits|101|bohemian rhapsody",
      "normalizedKey": "queen|greatest hits|101|bohemian rhapsody",
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "filename": "Queen - Greatest Hits - 101 - Bohemian Rhapsody.m4a",
      "baseName": "Queen - Greatest Hits - 101 - Bohemian Rhapsody",
      "artist": "Queen",
      "albumArtist": "Queen",
      "trackArtist": "Queen",
      "album": "Greatest Hits",
      "title": "Bohemian Rhapsody",
      "trackNo": "01",
      "discNo": 1,
      "discNumber": 1,
      "discTrack": "101",
      "extension": "m4a",
      "duration": 354.2,
      "lossless": false,
      "sampleRate": 44100,
      "bitsPerSample": 16,
      "compilation": false,
      "hasArtwork": true,
      "fileSize": 12458900,
      "dateAdded": "2026-11-10T12:00:00.000Z"
    }
  },
  "hashes": [
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
  ],
  "playlists": {
    "pl_rock_classics": {
      "id": "pl_rock_classics",
      "name": "Rock Classics",
      "trackKeys": [
        "queen|greatest hits|101|bohemian rhapsody"
      ],
      "createdAt": "2026-11-10T14:22:00.000Z",
      "updatedAt": "2026-11-11T19:00:00.000Z"
    }
  },
  "mostRecentPlaylistId": "pl_rock_classics"
}
```

- **Full Archive Standard Filename:** `{Sanitized Artist} - {Sanitized Album} - {DiscTrack} - {Sanitized Title}.{ext}` (sanitizing `/ \ : * ? " < > |` and control characters).
- **Compound Key (`buildNormalizedKey`):** `clean(Artist)|clean(Album)|pad3(DiscTrack)|clean(Title)` in lowercase with smart quotes normalized and whitespace collapsed (`Disc 1, Track 1` -> `101`).
- **Smart Release Collation (`getSmartReleaseSortKey` in `client/utils/sorting.js`):** Strips leading `"The "`, normalizes diacritics, groups multi-disc releases under a unified album sort key, formats disc/track indicators (`D1 • T04`), and detects compilations (`[OST]`, `[VA]`).

---

## 5. Universal `.m3u` Playlist Export & SNOWSKY Mode

### Standardized `.m3u` Format (`PlaylistService.swift`)
All playlist exports are standardized strictly on `.m3u` (legacy `.m3u8` toggles removed) for maximum compatibility across Android players (HiBy, Poweramp) and embedded RTOS DAPs (Snowsky Echo Nano):
1. **Encoding:** UTF-8 **without** Byte Order Mark (BOM).
2. **Line Endings:** Strict Windows **CRLF (`\r\n`)** on every line.
3. **Relative Paths:** Forward slashes (`/`) only, with **zero leading `/` or `./`**:
   ```plaintext
   #EXTM3U\r\n
   #EXTINF:-1,Queen - Bohemian Rhapsody\r\n
   Queen - Greatest Hits - 101 - Bohemian Rhapsody.m4a\r\n
   ```

### SNOWSKY Mode (`exportPlaylistFolders`)
- **Auto-Detection:** Selecting a volume whose name contains `SNOWSKY` automatically enables `exportPlaylistFolders = true` (with manual override respected via `snowskyModeUserOverride` and the `Snowflake` toggle card in `Header.jsx`).
- **Folder Export (`syncPlaylistFolders`):** During SD card sync, each playlist is exported as a root-level folder on the SD card containing physical copies of its tracks prefixed with their 1-based playback index (`001 - {filename}`) so RTOS folder-based players play playlists in exact sequential order. When disabled, managed playlist folders are cleanly removed from the SD card.

---

## 6. UI/UX Conventions & Design Standards

1. **Two-Bar Header System:**
   - **Bar 1 (`Header.jsx`):** `pl-20` traffic-light clearance (non-fullscreen), native window drag region (`data-window-drag="true"`), and uniform `h-14` (`56px`) control/stat cards with `[data-no-drag="true"]`: Theme Switch, Vault Tracks, Library/Playlist Cover Art (with missing-art filter and batch fetch), Vault Size, Target SD, SNOWSKY Mode toggle, and Settings trigger.
   - **Bar 2 (`UnifiedControlBar.jsx`):** Interactive **Now Playing** readout (click to trigger **Jump to Now Playing**), audio transport controls, seek scrubber, volume slider, Target SD volume selector, **Ingest**, **Sync to SD**, and **Eject**.
2. **Track Table (`TrackTable.jsx`):**
   - Virtualized TanStack Table with a **permanently locked `56px` Cover Art column** (`w-[56px] min-w-[56px] max-w-[56px] shrink-0`, non-reorderable, non-resizable) and drag-resizable text columns.
3. **Artwork Modal (`ArtworkModal.jsx`):**
   - Wide `max-w-2xl` dialog displaying high-resolution embedded art, drag-and-drop viewport, scope toggle (*Apply to all tracks in album*), and a single-row footer with **Remove Art**, **Save Image**, online **Download Artwork**, and **Browse Image… / Replace / Upload Art…** (backed by native `NSOpenPanel`).
4. **Decoupled "Jump to Now Playing" (`PlayerContext.jsx` & `App.jsx`):**
   - Tracks `queueSource` (`{ type: 'vault' | 'playlist' | 'search' | 'filter', id, query }`) independently of active browsing; clicking Now Playing restores the originating view and scrolls to center the playing track.
5. **GPU Double-Buffered Theme Switching (`ThemeContext.jsx` & `client/index.css`):**
   - Uses `document.startViewTransition()` + React `flushSync` with `.theme-switching` transition suppression and a 180ms root cross-fade.

---

## 7. Build, Packaging & Verification

### Production Build (`scripts/build-swift-app.sh`)
```bash
bash scripts/build-swift-app.sh
```
1. Compiles the React + Tailwind frontend (`client/dist/`).
2. Compiles the Release Swift executable (`swift build -c release` in `macos-swift/`).
3. Packages `dist/Audiophile Vault.app` (~5.3 MB) with `Info.plist`, app icon (`icon.icns` / `Assets.car`), and embedded `client/dist/`.
4. Ad-hoc signs and verifies the bundle (`codesign --force --deep --sign -` & `codesign --verify --deep --strict`).

### Automated Diagnostics & Tests
- **Native Swift Self-Test:**
  `"/Applications/Audiophile Vault.app/Contents/MacOS/Audiophile Vault" --self-test`  
  Verifies `.vault_index.json` loading, playlist loading, `client/dist/index.html` resolution, and embedded artwork extraction.
- **Artwork Lookup Dry-Run:**
  `"/Applications/Audiophile Vault.app/Contents/MacOS/Audiophile Vault" --test-artwork-search`
- **DRM Enforcement Check:**
  `"/Applications/Audiophile Vault.app/Contents/MacOS/Audiophile Vault" --test-drm-check`
- **Frontend/Spec Unit Tests:**
  `node --test tests/*.test.js`
