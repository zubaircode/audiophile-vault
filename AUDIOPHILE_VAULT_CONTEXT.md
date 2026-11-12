# Audiophile Vault (AV) — System Architecture & Technical Handover

**Project Name:** `audiophile-vault`  
**Repository Working Directory:** `pepper-music`  
**Application Type:** macOS Audiophile Desktop Music Manager, Lossless Tag Curator, and RTOS/Android SD Card Sync Engine  
**Core Technologies:** React 18, Vite 5, Tailwind CSS 3 (Class-Based Dark Mode), Express 4, Node.js 20+

---

## 1. Project Directory Tree & File Map

```
pepper-music/
├── .gitignore                          # Standard git ignore (deps, build, macOS, caches, vaults)
├── AUDIOPHILE_VAULT_CONTEXT.md         # Technical architecture & handover document
├── index.html                          # Single-page app root template (light/dark inline bootstrapper)
├── package.json                        # Root package definition (audiophile-vault v1.0.0)
├── package-lock.json                   # Deterministic lockfile
├── postcss.config.js                   # PostCSS Tailwind and Autoprefixer integration
├── tailwind.config.js                  # Tailwind configuration with darkMode: 'class'
├── vite.config.js                      # Vite config with PostCSS HMR and API proxying
│
├── client/                             # Primary frontend source
│   ├── main.jsx                        # React root mount with ThemeProvider and App
│   ├── App.jsx                         # Main dashboard layout, view state, and event coordinators
│   ├── index.css                       # Global styles, scrollbar styling, and View Transitions CSS
│   │
│   ├── components/                     # Core React UI components
│   │   ├── Header.jsx                  # Top metadata bar: branding, theme switch, stats, settings trigger
│   │   ├── UnifiedControlBar.jsx       # Playback bar: Now Playing jump readout, player controls, SD actions
│   │   ├── TrackTable.jsx              # Virtualized high-capacity track table with locked art column
│   │   ├── Sidebar.jsx                 # Vault library and playlist management sidebar
│   │   ├── ArtworkModal.jsx            # High-resolution artwork inspector and manual fetch/upload dialog
│   │   ├── SettingsModal.jsx           # Global configuration modal (paths, playlist formats)
│   │   ├── ContextMenu.jsx             # Contextual right-click action menu
│   │   ├── LogViewer.jsx               # Collapsible live real-time log terminal
│   │   ├── ControlsBar.jsx             # Forwarding alias
│   │   ├── NowPlayingBar.jsx           # Forwarding alias
│   │   ├── SyncControl.jsx             # Forwarding alias
│   │   └── SyncPanel.jsx               # Forwarding alias
│   │
│   ├── context/                        # React Context providers
│   │   ├── PlayerContext.jsx           # Audio playback engine, HTML5 audio, queue source tracking
│   │   └── ThemeContext.jsx            # View Transitions-backed Light/Dark theme manager
│   │
│   ├── utils/                          # Frontend utility libraries
│   │   └── sorting.js                  # Audiophile sort collation, A-Z normalization, compilation detection
│   │
│   └── src/                            # Forwarding mirrors ensuring backward-compatible submodule imports
│       ├── App.jsx
│       ├── index.css
│       ├── main.jsx
│       ├── components/                 # Forwarding re-exports to client/components/*
│       ├── context/                    # Forwarding re-exports to client/context/*
│       └── utils/                      # Forwarding re-exports to client/utils/*
│
├── server/                             # Express backend API & audiophile pipeline
│   ├── index.js                        # Express server entry point, SSE dispatchers, and route registrations
│   ├── db.js                           # Atomic state persistence, .vault_index.json lifecycle, path healing
│   ├── config.js                       # Configuration defaults, validation, and volume resolution
│   ├── playlists.js                    # Universal RTOS + Android compliant M3U/M3U8 export engine
│   ├── artwork.js                      # Cover art discovery, MusicBrainz / iTunes fallback, image cache
│   ├── embedder.js                     # Lossless tag and cover art binary embedder (FLAC, M4A, MP3)
│   │
│   └── services/                       # Background background service workers
│       ├── metadata.js                 # music-metadata parser, DRM inspection, Full Archive Standard naming
│       ├── scanner.js                  # Vault and source folder scanner, SHA-256 deduplication
│       ├── sync.js                     # SD card delta sync engine and volume copy coordinator
│       └── volume.js                   # External volume monitor, diskutil query, safety validator
│
└── tests/                              # Node test runner suite (node --test)
    ├── playlists.test.js               # Universal M3U/M3U8 compliance, CRLF, relative path tests
    └── sorting.test.js                 # Smart release key collation and search matching tests
```

---

## 2. Key Components & Responsibilities

### Frontend Modules (`client/`)

| Module / Component | Responsibilities |
| :--- | :--- |
| **`client/App.jsx`** | Root application controller. Manages navigation view (`activePlaylistId`, `searchQuery`, `filterMissingArt`), SSE event streams (`/api/import/progress`, `/api/sync/progress`, `/api/artwork/progress`), global keyboard shortcuts, and orchestrates the decoupled **Jump to Now Playing** view restoration and table row center-scroll. |
| **`client/components/Header.jsx`** | Fixed top metadata bar (`h-14` height). Houses the retro spinning vinyl indicator during active operations, the tactile **Theme Toggle Switch** (`role="switch"`), the **Vault Tracks** count card, the **Library/Playlist Cover Art** stat card with instant missing-artwork filter toggle button and batch artwork fetch trigger, and the **Settings Modal** button. |
| **`client/components/UnifiedControlBar.jsx`** | Action and playback control bar. Renders the interactive **Now Playing** track banner with origin readout (click to trigger Jump to Now Playing), standard audio controls (Previous, Play/Pause, Next), scrubber, volume slider, external **Target Volume** dropdown selector, and action buttons for **Ingest**, **Sync to SD**, and **Eject**. |
| **`client/components/TrackTable.jsx`** | High-performance virtualized audio table. Renders thousands of tracks with zero hover lag. Features a strictly **locked 56px Cover Art column** (non-reorderable, non-resizable), format badges (`FLAC`, `ALAC`, `MP3`, sample/bit rates), smart album group sorting, active row highlight rings, and context menu dispatch. |
| **`client/components/Sidebar.jsx`** | Left navigation panel. Handles navigation between the full Vault Library, Quick Filters (Missing Artwork), and User Playlists. Supports playlist creation, inline renaming, drag-and-drop reordering, duplication, and deletion. |
| **`client/components/ArtworkModal.jsx`** | High-resolution artwork inspector dialog. Displays embedded art, facilitates live search across iTunes and Cover Art Archive / MusicBrainz, allows custom image drag-and-drop, and triggers backend image embedding. |
| **`client/components/SettingsModal.jsx`** | Configuration dialog for Apple Music / Ingest Source Path, Audiophile Vault Storage Directory, Target SD Card Mount, and Universal Playlist Export formats (`m3u` vs `m3u8` and companion files). |
| **`client/components/ContextMenu.jsx`** | Native-feeling right-click context menu offering instant playback, playlist addition/removal, artwork inspection, and Finder revelation. |
| **`client/components/LogViewer.jsx`** | Collapsible real-time diagnostic console situated at the bottom of the window, displaying timestamped ingest, sync, and network events with auto-scroll and one-click log clearing. |
| **`client/context/PlayerContext.jsx`** | Global audio state provider. Enforces HTML5 audio playback, maintains the current playing track, play/pause state, volume/mute levels, and tracks `queueSource` (`{ type: 'vault' | 'playlist' | 'search' | 'filter', id, query }`) to allow decoupled browsing without losing queue context. |
| **`client/context/ThemeContext.jsx`** | Class-based Light/Dark theme coordinator. Implements GPU double-buffering via `document.startViewTransition`, wraps state updates in `flushSync`, manages the `.theme-switching` transition suppression lifecycle, and persists preferences to `localStorage['av_theme']`. |
| **`client/utils/sorting.js`** | Deterministic audiophile collation engine: `getSmartReleaseSortKey` strips leading articles ("The "), normalizes accented characters, unifies multi-disc sets, formats disc/track numbers (`D1 • T04`), and detects compilation markers (`[OST]`, `[VA]`). |

### Backend API & Pipeline (`server/`)

| File / Service | Responsibilities |
| :--- | :--- |
| **`server/index.js`** | Express application server running on port `3001` (proxied by Vite in dev). Exposes REST endpoints for configuration, volume management, playlist CRUD, audio streaming (`/api/stream/:filename`), artwork serving, and Server-Sent Events (SSE) for background tasks. |
| **`server/db.js`** | Thread-safe, atomic database engine for `.vault_index.json`. Uses temporary write files (`.tmp`) and atomic renames to prevent index corruption. Provides path expansion (`expandTilde`) to prevent cwd corruption. |
| **`server/config.js`** | Validates and stores persistent settings (`sourcePath`, `vaultPath`, `sdCardPath`, `playlistFormat`, `emitCompanionM3u8`). Enforces volume path safety. |
| **`server/playlists.js`** | Strict, universal playlist export generator complying with embedded RTOS requirements (Echo Nano) and Android audiophile players (Poweramp, HiBy). |
| **`server/artwork.js`** | Embedded artwork extractor, thumbnail cache manager (`~/.audiophile-vault/artwork/`), and external metadata fetcher (Cover Art Archive, iTunes Search API). |
| **`server/embedder.js`** | Native tag embedder writing cover art buffers directly into audio file headers (ID3v2 for MP3/AIFF, Vorbis comments for FLAC, and MP4 atoms for M4A/ALAC). |
| **`server/services/metadata.js`** | Audio header inspector using `music-metadata`. Extracts track titles, artists, album artists, compilations, disc numbers, lossless flags, sample rates, and bit depths. Formats the **Full Archive Standard** filename. |
| **`server/services/scanner.js`** | Multi-threaded filesystem scanner. Computes SHA-256 checksums, identifies new vs existing tracks, and emits live progress updates. |
| **`server/services/sync.js`** | Volume synchronization worker. Compares Vault tracks and playlists against the destination SD card, copies new files, exports M3U playlists, and cleans orphan tracks. |
| **`server/services/volume.js`** | Safety validator for external media. Queries mounted devices under `/Volumes/`, verifies removable flags, and blocks destructive writes to internal macOS system volumes (`/`, `/System`). |

---

## 3. Backend REST API Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/config` | Retrieves active paths, playlist configuration, and vault statistics. |
| `POST` | `/api/config` | Updates vault directories, target SD path, and playlist export settings. |
| `POST` | `/api/settings/target` | Validates and updates active SD card sync target. |
| `GET` | `/api/volumes` | Lists mounted removable external storage volumes in `/Volumes/`. |
| `GET` | `/api/tracks` | Returns complete list of indexed tracks in the Audiophile Vault. |
| `GET` | `/api/stream/:filename` | Streams audio file with HTTP 206 range-request support for seeking. |
| `GET` | `/covers/:filename` | Serves cached square album art thumbnail. |
| `GET` | `/api/playlists` | Retrieves all saved user playlists. |
| `POST` | `/api/playlists` | Creates a new empty playlist. |
| `PUT` | `/api/playlists/:id` | Renames a playlist or updates metadata. |
| `POST` | `/api/playlists/:id/duplicate` | Clones an existing playlist. |
| `DELETE` | `/api/playlists/:id` | Deletes a playlist. |
| `POST` | `/api/playlists/:id/tracks` | Appends tracks to a playlist. |
| `DELETE` | `/api/playlists/:id/tracks/:trackKey` | Removes a specific track from a playlist. |
| `PUT` | `/api/playlists/:id/reorder` | Updates track ordering in a playlist. |
| `GET` | `/api/artwork/progress` | SSE stream for real-time artwork backfill progress. |
| `POST` | `/api/artwork/backfill` | Launches background batch artwork search and embedder. |
| `POST` | `/api/artwork/stop` | Halts active background artwork backfill. |
| `GET` | `/api/artwork/:baseName` | Fetches metadata and cover art lookup candidates. |
| `POST` | `/api/artwork/:baseName` | Downloads and embeds selected cover image into audio file. |
| `DELETE` | `/api/artwork/:baseName` | Removes embedded artwork from audio file and clears cache. |
| `GET` | `/api/import/progress` | SSE stream for track ingest / scan progress. |
| `POST` | `/api/import` | Triggers import scan from source path into Audiophile Vault. |
| `GET` | `/api/sync/progress` | SSE stream for SD card file transfer progress. |
| `POST` | `/api/sync` | Starts differential synchronization to external SD card volume. |
| `POST` | `/api/eject` | Unmounts and ejects external SD card volume safely via `diskutil`. |

---

## 4. `.vault_index.json` Database Schema

The database is stored on disk at:  
**Primary Path:** `~/Music/AudiophileVault/.vault_index.json`  
**Fallback / App Data:** `~/.audiophile-vault/.vault_index.json`

### Top-Level Document Structure
```json
{
  "updatedAt": "2026-11-12T03:44:38.000Z",
  "config": {
    "sourcePath": "/Users/username/Music/Music/Media.localized/Music/",
    "vaultPath": "/Users/username/Music/AudiophileVault/",
    "sdCardPath": "/Volumes/WALKMAN/",
    "playlistFormat": "m3u",
    "emitCompanionM3u8": false
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

### Deterministic Deduplication Key Rule
Tracks are mapped by a canonical compound key generated via `buildNormalizedKey`:
$$\text{key} = \text{clean}(Artist) \mathbin{\Vert} \text{"|"} \mathbin{\Vert} \text{clean}(Album) \mathbin{\Vert} \text{"|"} \mathbin{\Vert} \text{pad3}(DiscTrack) \mathbin{\Vert} \text{"|"} \mathbin{\Vert} \text{clean}(Title)$$
- All values are converted to lowercase, smart curly apostrophes `[’]` normalized to straight `'`, and consecutive whitespace collapsed.
- `DiscTrack` is 3 digits minimum (e.g. Disc 1 Track 1 $\to$ `"101"`, Disc 2 Track 12 $\to$ `"212"`).

### Full Archive Standard Filename
Every track in the vault follows the strict naming standard:
`{Sanitized Artist} - {Sanitized Album} - {DiscTrack} - {Sanitized Title}.{ext}`
Illegal filesystem characters (`/ \ : * ? " < > |`) and control characters are sanitized into clean hyphens.

---

## 5. Universal Playlist Export Specifications

Playlists are generated in `server/playlists.js` during manual export or when syncing to an external SD card.

### Universal Compliance Standards (Echo Nano RTOS & Android)

1. **Line Endings:**
   - Every single line must terminate with **Windows CRLF (`\r\n`)**.
   - Unix `\n` is forbidden; embedded RTOS parsers (e.g., Echo Nano) fail to trim `\r` if mixed or Unix-only, appending an invisible `\r` character to the file path and breaking playback.
2. **Relative Path Resolution (`resolveRelativeTrackPath`):**
   - Track paths must be calculated relative to the destination directory where the playlist file resides.
   - **Forward Slashes Only:** Path separators must always be forward slashes (`/`), never backslashes (`\`).
   - **Zero Leading Slashes:** The path must never begin with `/` or `\` (e.g., `Queen - Greatest Hits - 101 - Bohemian Rhapsody.m4a` or `../Music/...`).
   - **No Leading `./`:** Embedded RTOS players treat leading `./` as a literal folder named `.`. It must be stripped.
3. **Encoding:**
   - Standard **UTF-8 without Byte Order Mark (BOM)**. BOM sequences cause RTOS playlist parsers to fail on line 1.
4. **File Structure:**
   ```plaintext
   #EXTM3U\r\n
   #EXTINF:-1,Artist Name - Track Title\r\n
   Relative/Path/To/Track.flac\r\n
   ```
5. **Dual Export Mode:**
   - Always writes the primary `.m3u` file for broad player compatibility.
   - When `emitCompanionM3u8: true` or `playlistFormat: 'm3u8'` is enabled, writes an identical companion `.m3u8` playlist side-by-side.

---

## 6. UI/UX Conventions & Design Standards

### 1. Two-Bar Header System
The application layout reserves the top of the interface for two distinct, fixed toolbars:
- **Bar 1 — Top Metadata Toolbar (`Header.jsx`):**
  - Left: Application branding ("Audiophile Vault") accompanied by a spinning vinyl record indicator active during imports, syncs, or artwork operations.
  - Right: Tactile Light/Dark Mode toggle switch, Vault Tracks count badge, Library Cover Art stat card (with missing art filter button and backfill trigger), and Settings button. All stat cards share a standardized height of `h-14` (56px).
- **Bar 2 — Action & Playback Bar (`UnifiedControlBar.jsx`):**
  - Left: Interactive **Now Playing** readout with cover thumbnail, artist, title, audio format badge (`FLAC`, `96kHz 24bit`), and origin queue readout (`Vault`, `Playlist: Rock`, `Search`).
  - Center: Audio controls (Previous, Play/Pause, Next), interactive seek bar with elapsed and remaining timestamps, and volume slider.
  - Right: SD Card target volume picker dropdown, Ingest button, Sync to SD button, and Volume Eject button.

### 2. Locked Cover Art Column (`TrackTable.jsx`)
- The first column in the track table is permanently locked at `56px` (`w-[56px] min-w-[56px] max-w-[56px] shrink-0`).
- It is non-draggable, non-reorderable, and non-resizable.
- Displays a `40x40` pixel rounded thumbnail with high-contrast fallback icon (`Disc`). Hovering displays an inspect eye overlay that opens `ArtworkModal.jsx`.

### 3. Decoupled "Jump to Now Playing" Queue Architecture
- The playback queue is managed in `PlayerContext.jsx` independently of the currently viewed track list.
- When playback starts, the context records the origin:
  ```javascript
  queueSource = {
    type: 'vault' | 'playlist' | 'search' | 'filter',
    id: activePlaylistId,
    query: searchQuery
  }
  ```
- Users can freely browse other playlists, filter for missing artwork, or run search queries without interrupting the active queue.
- Clicking the origin indicator under the Play button in `UnifiedControlBar.jsx` triggers `jumpToNowPlaying()` in `client/App.jsx`:
  1. Restores the originating playlist view or search term.
  2. Scrolls the virtualized `TrackTable.jsx` to center on the active track (`scrollToTrackKey`).
  3. Triggers an amber glow pulse and border highlight (`animate-pulse bg-amber-500/25 border-l-4 border-amber-400`).

### 4. GPU Double-Buffered Light/Dark Theme Switching
- Theme state is managed via `ThemeContext.jsx` with class-based Tailwind (`<html class="dark">`).
- **View Transitions API:** The DOM update is wrapped inside `document.startViewTransition()` with React 18 DOM flushing:
  ```javascript
  document.documentElement.classList.add('theme-switching');
  const transition = document.startViewTransition(() => {
    applyTheme(nextTheme);
    flushSync(() => setThemeState(nextTheme));
  });
  transition.finished.finally(() => {
    document.documentElement.classList.remove('theme-switching');
  });
  ```
- **Performance Protection:** `.theme-switching *, .theme-switching *::before, .theme-switching *::after { transition: none !important; }` prevents per-element CSS style recalculation lag across thousands of table rows.
- **Cross-Fade Animation:** Configured in `client/index.css` with a smooth 180ms opacity cross-fade:
  ```css
  ::view-transition-old(root),
  ::view-transition-new(root) {
    animation-duration: 180ms;
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    mix-blend-mode: normal;
  }
  ```
- **Table Row Optimization:** Individual `<tr>` rows in `TrackTable.jsx` omit CSS `transition-colors`, keeping hover states crisp and scrolling fluid at 60fps across large libraries.

---

## 7. Verification & Quality Assurance

- **Unit Tests:** Run via `node --test tests/*.test.js` (9/9 tests verifying relative path resolution, universal CRLF M3U formatting, UTF-8 non-BOM encoding, smart release key collation, and search collation).
- **Production Bundle:** Built via `npm run build` using Vite 5. Output bundled to `dist/`.
- **Runtime Dev Server:** Running concurrently via `npm run dev` (`node --watch server/index.js` and `vite` on port 5173).
