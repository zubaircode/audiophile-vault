import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { buildNormalizedKey } from './services/metadata.js';

const HOME_DIR = os.homedir();

export function expandTilde(filePath) {
  if (!filePath || typeof filePath !== 'string') return '';

  let cleaned = filePath.trim();

  // Heal previously mangled paths where cwd was prepended before a quoted absolute path,
  // e.g. "/Users/zubaircode/Develop/pepper-music/'/Users/zubaircode/Music/Music Alpha'"
  const mangledMatch = cleaned.match(
    /['"](\/(?:Users|Volumes|System|Library|private|tmp|var|opt)\/[^'"]+)['"]$/
  );
  if (mangledMatch) {
    cleaned = mangledMatch[1].trim();
  }

  // Strip surrounding single or double quotes (from Finder "Copy as Pathname" or Terminal drag-and-drop)
  while (
    (cleaned.startsWith("'") && cleaned.endsWith("'")) ||
    (cleaned.startsWith('"') && cleaned.endsWith('"'))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }

  // Unescape shell-escaped spaces (e.g. /Users/zubaircode/Music/Music\ Alpha)
  cleaned = cleaned.replace(/\\ /g, ' ');

  if (!cleaned) return '';
  if (cleaned === '~') return HOME_DIR;
  if (cleaned.startsWith('~/')) {
    return path.join(HOME_DIR, cleaned.slice(2));
  }

  // Handle missing leading slash for /Users/... or /Volumes/...
  if (cleaned.startsWith('Users/') || cleaned.startsWith('Volumes/')) {
    cleaned = `/${cleaned}`;
  }

  // Resolve any remaining relative path against the user's home directory, never the project cwd
  if (!path.isAbsolute(cleaned)) {
    return path.resolve(HOME_DIR, cleaned);
  }

  return path.normalize(cleaned);
}

const DEFAULT_APP_DIR = path.join(HOME_DIR, '.audiophile-vault');
const FALLBACK_APP_DIR = path.join(process.cwd(), '.audiophile-vault');

function resolveAppDataDir() {
  try {
    fs.mkdirSync(DEFAULT_APP_DIR, { recursive: true });
    return DEFAULT_APP_DIR;
  } catch {
    fs.mkdirSync(FALLBACK_APP_DIR, { recursive: true });
    return FALLBACK_APP_DIR;
  }
}

const APP_DATA_DIR = resolveAppDataDir();
const LEGACY_INDEX_FILE = path.join(APP_DATA_DIR, '.library_index.json');
const CONFIG_BOOTSTRAP_FILE = path.join(APP_DATA_DIR, 'config.json');

const DEFAULT_CONFIG = {
  sourcePath: path.join(HOME_DIR, 'Music/Music/Media.localized/Music/'),
  vaultPath: path.join(HOME_DIR, 'Music/AudiophileVault/'),
  sdCardPath: process.env.AV_TARGET_SD_PATH || '',
  playlistFormat: 'm3u',
  emitCompanionM3u8: false,
};

export function getTrackBaseNameFromFilename(audioFilename) {
  if (!audioFilename || typeof audioFilename !== 'string') return '';
  return audioFilename.replace(/\.[^.]+$/, '');
}

export function getCompanionJpgFilename(audioFilename) {
  if (!audioFilename || typeof audioFilename !== 'string') return '';
  const baseName = audioFilename.replace(/\.[^.]+$/, '');
  return `${baseName}.jpg`;
}

// ==================================================
// CANONICAL ALBUM GROUPING & SIBLING MATCHING ENGINE
// ==================================================

const GENERIC_ALBUM_TITLES = new Set([
  '',
  'unknown album',
  'unknown',
  'greatest hits',
  'the greatest hits',
  'best of',
  'the best of',
  'the very best of',
  'live',
  'unplugged',
  'anthology',
  'collection',
  'platinum & gold collection',
  '20th century masters',
]);

/**
 * Normalizes an artist string for album grouping:
 * - Normalizes Unicode NFC and curly quotes (`’` -> `'`)
 * - Strips featuring credits (`feat.`, `ft.`, `featuring`, `with`) in parens/brackets or trailing
 * - Collapses whitespace and lowercases
 */
export function cleanArtistForGrouping(rawArtist) {
  if (!rawArtist || typeof rawArtist !== 'string') return 'unknown artist';
  const cleaned = rawArtist
    .normalize('NFC')
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    // Strip parenthetical/bracketed feat credits: (feat. X), [ft. Y]
    .replace(/\s*[\(\[](?:feat\.?|ft\.?|featuring|with)\s+[^)\]]+[\)\]]/gi, '')
    // Strip trailing feat credits: "Artist feat. Guest", "Artist ft. Guest"
    .replace(/\s+\b(?:feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return cleaned || 'unknown artist';
}

/**
 * Normalizes an album string for album grouping:
 * - Normalizes Unicode NFC, curly quotes, and colon/dash separators (since macOS/AV sanitizes `:` to `-`)
 * - Strips disc/volume suffixes (`(Disc 1)`, `[CD 2]`, `- Disc 1`, `Vol. 1`) so multi-disc albums group cleanly
 * - Strips edition/remaster noise (`(Remastered 2011)`, `[Deluxe Edition]`, etc.)
 */
export function cleanAlbumForGrouping(rawAlbum) {
  if (!rawAlbum || typeof rawAlbum !== 'string') return 'unknown album';
  const cleaned = rawAlbum
    .normalize('NFC')
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    // Strip disc/CD suffixes in parens/brackets or trailing: "(Disc 1)", "[CD 2]", "- Disc 01"
    .replace(/\s*[\(\[](?:disc|cd|disk)\s*\d+[^)\]]*[\)\]]/gi, '')
    .replace(/\s*[-–—:]\s*(?:disc|cd|disk)\s*\d+\b.*$/i, '')
    // Strip common remaster/edition parentheticals so slight tag differences across tracks still group
    .replace(
      /\s*[\(\[][^)\]]*\b(?:remaster(?:ed)?|deluxe|expanded|anniversary|special\s+edition|bonus\s+track|reissue|explicit|mono|stereo)\b[^)\]]*[\)\]]/gi,
      ''
    )
    // Normalize colon/dash variations ("Collection: A" vs "Collection- A")
    .replace(/\s*[:\-–—]+\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–—:]+$/g, '')
    .trim()
    .toLowerCase();

  return cleaned || 'unknown album';
}

/**
 * Extracts a numeric disc number from a track record (`discNumber`, `discNo`, or `discTrack` prefix).
 */
export function getTrackDiscNumber(track) {
  if (!track || typeof track !== 'object') return 1;
  if (Number.isFinite(Number(track.discNumber)) && Number(track.discNumber) > 0) {
    return Number(track.discNumber);
  }
  if (Number.isFinite(Number(track.discNo)) && Number(track.discNo) > 0) {
    return Number(track.discNo);
  }
  if (track.discTrack && /^\d{3,}$/.test(String(track.discTrack))) {
    const discPart = Math.floor(Number(track.discTrack) / 100);
    if (discPart > 0) return discPart;
  }
  return 1;
}

/**
 * Generates a deterministic canonical album grouping key (`${cleanArtist}|${cleanAlbum}`)
 * with optional disc scoping (`|disc:${discNumber}`).
 *
 * Prioritizes:
 * 1. `"various artists"` if `track.compilation === true` or `albumArtist === "Various Artists"`
 * 2. `track.albumArtist` if present and non-empty
 * 3. `track.artist` with featuring credits stripped
 */
export function getAlbumGroupKey(track, { includeDisc = false } = {}) {
  if (!track || typeof track !== 'object') return 'unknown artist|unknown album';

  const rawAlbumArtist = String(track.albumArtist || '').trim();
  const isCompilation =
    Boolean(track.compilation) ||
    /^various(\s+artists)?$/i.test(rawAlbumArtist) ||
    /^various(\s+artists)?$/i.test(String(track.artist || '').trim());

  const anchorArtist = isCompilation
    ? 'various artists'
    : cleanArtistForGrouping(rawAlbumArtist || track.artist || '');

  const cleanAlbum = cleanAlbumForGrouping(track.album || '');
  const baseKey = `${anchorArtist}|${cleanAlbum}`;

  if (includeDisc) {
    return `${baseKey}|disc:${getTrackDiscNumber(track)}`;
  }
  return baseKey;
}

/**
 * Finds all tracks in `tracksList` that belong to the same album as `referenceTrack`.
 *
 * Handles:
 * 1. Tracks with matching canonical `getAlbumGroupKey(t, { includeDisc })` (handles `albumArtist`, `feat.` credits,
 *    `(Disc 1)` suffixes, curly apostrophes, and remaster tag noise).
 * 2. Multi-artist compilations, soundtracks, or DJ mixes where `albumArtist` was not tagged on individual files
 *    (so `track.artist` differs on every song), matched by shared non-generic `cleanAlbumForGrouping(track.album)`.
 */
export function findAlbumSiblingTracks(
  tracksList,
  referenceTrack,
  { includeDisc = false } = {}
) {
  if (!Array.isArray(tracksList) || !referenceTrack) return [];

  const targetGroupKey = getAlbumGroupKey(referenceTrack, { includeDisc });
  const targetCleanAlbum = cleanAlbumForGrouping(referenceTrack.album || '');
  const targetDisc = getTrackDiscNumber(referenceTrack);
  const isSpecificAlbumTitle =
    targetCleanAlbum.length >= 4 && !GENERIC_ALBUM_TITLES.has(targetCleanAlbum);

  return tracksList.filter((t) => {
    if (!t) return false;
    if (getAlbumGroupKey(t, { includeDisc }) === targetGroupKey) {
      return true;
    }
    if (isSpecificAlbumTitle) {
      const candidateAlbum = cleanAlbumForGrouping(t.album || '');
      if (candidateAlbum === targetCleanAlbum) {
        if (includeDisc && getTrackDiscNumber(t) !== targetDisc) {
          return false;
        }
        return true;
      }
    }
    return false;
  });
}

class VaultRegistry {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.tracksMap = {}; // { [trackKey]: trackRecord }
    this.hashes = [];
    this.playlists = {}; // { [playlistId]: { id, name, createdAt, updatedAt, trackKeys: [] } }
    this.mostRecentPlaylistId = null;

    this.hashSet = new Set();
    this.keySet = new Set();
    this.filenameSet = new Set();
    this.baseNameSet = new Set();
    this.initialized = false;
    this.lastSyncDiskTime = 0;
  }

  getVaultDir() {
    const raw = expandTilde(this.config.vaultPath || DEFAULT_CONFIG.vaultPath);
    if (/\/playlists?\/?$/i.test(raw)) {
      return path.dirname(raw.replace(/\/+$/, ''));
    }
    return raw;
  }

  getPlaylistsDir() {
    return this.getVaultDir();
  }

  getVaultIndexPath() {
    const vaultDir = this.getVaultDir();
    try {
      fs.mkdirSync(vaultDir, { recursive: true });
      return path.join(vaultDir, '.vault_index.json');
    } catch {
      return path.join(APP_DATA_DIR, '.vault_index.json');
    }
  }

  init() {
    if (this.initialized) return;

    // 1. Load bootstrap config if present
    try {
      if (fs.existsSync(CONFIG_BOOTSTRAP_FILE)) {
        const parsedCfg = JSON.parse(fs.readFileSync(CONFIG_BOOTSTRAP_FILE, 'utf8'));
        this.config = {
          ...DEFAULT_CONFIG,
          ...parsedCfg,
          sourcePath: expandTilde(parsedCfg.sourcePath || DEFAULT_CONFIG.sourcePath),
          vaultPath: expandTilde(parsedCfg.vaultPath || DEFAULT_CONFIG.vaultPath),
        };
      }
    } catch {
      // Ignore bootstrap read error
    }

    this.ensureVaultDir();

    const vaultIndexPath = this.getVaultIndexPath();

    // 2. Load ~/Music/AudiophileVault/.vault_index.json (or migrate from legacy .library_index.json)
    try {
      if (fs.existsSync(vaultIndexPath)) {
        const raw = fs.readFileSync(vaultIndexPath, 'utf8');
        this.hydrateFromParsed(JSON.parse(raw));
      } else if (fs.existsSync(LEGACY_INDEX_FILE)) {
        const raw = fs.readFileSync(LEGACY_INDEX_FILE, 'utf8');
        this.hydrateFromParsed(JSON.parse(raw));
        this.persist();
      } else {
        this.persist();
      }
    } catch (err) {
      console.error('[DB] Failed to load .vault_index.json, starting fresh:', err.message);
    }

    this.ensureVaultDir();
    this.rebuildIndexes();
    if (this._pendingKeyMigrationPersist) {
      this._pendingKeyMigrationPersist = false;
      this.persist();
    }
    this.initialized = true;
  }

  hydrateFromParsed(parsed) {
    if (!parsed || typeof parsed !== 'object') return;

    if (parsed.config) {
      this.config = {
        ...DEFAULT_CONFIG,
        ...parsed.config,
        sourcePath: expandTilde(parsed.config.sourcePath || DEFAULT_CONFIG.sourcePath),
        vaultPath: expandTilde(parsed.config.vaultPath || DEFAULT_CONFIG.vaultPath),
        sdCardPath: parsed.config.sdCardPath ?? DEFAULT_CONFIG.sdCardPath,
        playlistFormat: parsed.config.playlistFormat || DEFAULT_CONFIG.playlistFormat,
        emitCompanionM3u8: Boolean(
          parsed.config.emitCompanionM3u8 ??
          (parsed.config.playlistFormat === 'm3u8' || DEFAULT_CONFIG.emitCompanionM3u8)
        ),
      };
    }

    const keyMap = {};
    let migratedAnyKey = false;

    // Support both object map `tracks: { [key]: track }` and legacy array `tracks: [...]`
    if (Array.isArray(parsed.tracks)) {
      this.tracksMap = {};
      for (const t of parsed.tracks) {
        const oldKey = t.trackKey || t.normalizedKey || t.filename;
        if (oldKey) {
          const newKey = buildNormalizedKey(
            t.artist,
            t.album,
            t.discTrack,
            t.title
          );
          if (oldKey !== newKey) migratedAnyKey = true;
          keyMap[oldKey] = newKey;
          if (t.normalizedKey) keyMap[t.normalizedKey] = newKey;
          if (t.trackKey) keyMap[t.trackKey] = newKey;

          this.tracksMap[newKey] = {
            ...t,
            normalizedKey: newKey,
            trackKey: newKey,
            baseName: t.baseName || getTrackBaseNameFromFilename(t.filename),
            discNumber: getTrackDiscNumber(t),
            albumGroupKey: getAlbumGroupKey(t),
            hasArtwork: Boolean(t.hasArtwork),
            artworkFilename: t.artworkFilename || getCompanionJpgFilename(t.filename),
          };
        }
      }
    } else if (parsed.tracks && typeof parsed.tracks === 'object') {
      this.tracksMap = {};
      for (const [k, t] of Object.entries(parsed.tracks)) {
        const oldKey = t.trackKey || t.normalizedKey || k;
        const newKey = buildNormalizedKey(
          t.artist,
          t.album,
          t.discTrack,
          t.title
        );
        if (k !== newKey || oldKey !== newKey) migratedAnyKey = true;
        keyMap[k] = newKey;
        keyMap[oldKey] = newKey;
        if (t.normalizedKey) keyMap[t.normalizedKey] = newKey;
        if (t.trackKey) keyMap[t.trackKey] = newKey;

        this.tracksMap[newKey] = {
          ...t,
          normalizedKey: newKey,
          trackKey: newKey,
          baseName: t.baseName || getTrackBaseNameFromFilename(t.filename),
          discNumber: getTrackDiscNumber(t),
          albumGroupKey: getAlbumGroupKey(t),
          hasArtwork: Boolean(t.hasArtwork),
          artworkFilename: t.artworkFilename || getCompanionJpgFilename(t.filename),
        };
      }
    }

    if (Array.isArray(parsed.hashes)) {
      this.hashes = parsed.hashes;
    }

    if (parsed.playlists && typeof parsed.playlists === 'object') {
      const nextPlaylists = {};
      for (const [plId, pl] of Object.entries(parsed.playlists)) {
        if (!pl || typeof pl !== 'object') continue;
        const rawKeys = Array.isArray(pl.trackKeys) ? pl.trackKeys : [];
        nextPlaylists[plId] = {
          ...pl,
          trackKeys: rawKeys.map((k) => keyMap[k] || k),
        };
      }
      this.playlists = nextPlaylists;
    }

    if (typeof parsed.mostRecentPlaylistId === 'string') {
      this.mostRecentPlaylistId = parsed.mostRecentPlaylistId;
    } else {
      this.mostRecentPlaylistId = null;
    }

    this._pendingKeyMigrationPersist = migratedAnyKey;
  }

  ensureVaultDir() {
    try {
      const vaultDir = this.getVaultDir();
      fs.mkdirSync(vaultDir, { recursive: true });
    } catch (err) {
      console.warn('[DB] Could not auto-create vault directory:', err.message);
    }
  }

  rebuildIndexes() {
    this.hashSet.clear();
    this.keySet.clear();
    this.filenameSet.clear();
    this.baseNameSet.clear();

    for (const h of this.hashes) {
      if (h) this.hashSet.add(h);
    }

    for (const [key, track] of Object.entries(this.tracksMap)) {
      if (track.sha256) this.hashSet.add(track.sha256);
      this.keySet.add(key);
      if (track.normalizedKey) this.keySet.add(track.normalizedKey);
      if (track.filename) {
        this.filenameSet.add(track.filename.toLowerCase());
        this.baseNameSet.add(
          getTrackBaseNameFromFilename(track.filename).toLowerCase()
        );
      }
      if (track.baseName) {
        this.baseNameSet.add(track.baseName.toLowerCase());
      }
    }

    this.hashes = Array.from(this.hashSet);
  }

  persist() {
    try {
      this.ensureVaultDir();
      this.hashes = Array.from(this.hashSet);

      const indexPayload = JSON.stringify(
        {
          updatedAt: new Date().toISOString(),
          config: this.config,
          tracks: this.tracksMap,
          hashes: this.hashes,
          playlists: this.playlists,
          mostRecentPlaylistId: this.mostRecentPlaylistId,
        },
        null,
        2
      );

      const targetIndexPath = this.getVaultIndexPath();
      const tmpIndexPath = `${targetIndexPath}.tmp`;
      fs.writeFileSync(tmpIndexPath, indexPayload, 'utf8');
      fs.renameSync(tmpIndexPath, targetIndexPath);

      const tmpBootstrapPath = `${CONFIG_BOOTSTRAP_FILE}.tmp`;
      fs.writeFileSync(
        tmpBootstrapPath,
        JSON.stringify(this.config, null, 2),
        'utf8'
      );
      fs.renameSync(tmpBootstrapPath, CONFIG_BOOTSTRAP_FILE);
    } catch (err) {
      console.error('[DB] Failed to write .vault_index.json:', err.message);
    }
  }

  getAllTracksArray() {
    this.init();
    return Object.values(this.tracksMap).sort((a, b) => {
      const da = a.addedDate || '';
      const dbDate = b.addedDate || '';
      return dbDate.localeCompare(da);
    });
  }

  getTrackByKey(trackKey) {
    this.init();
    if (!trackKey) return null;
    return this.tracksMap[trackKey] || null;
  }

  getConfig() {
    this.init();
    const tracksArr = this.getAllTracksArray();
    const totalTracks = tracksArr.length;
    const totalBytes = tracksArr.reduce((sum, t) => sum + (Number(t.fileSize) || 0), 0);
    const totalSizeGB = Number((totalBytes / (1024 ** 3)).toFixed(3));
    const tracksWithArtwork = tracksArr.filter((t) => Boolean(t.hasArtwork)).length;

    return {
      sourcePath: this.config.sourcePath,
      vaultPath: this.config.vaultPath,
      sdCardPath: this.config.sdCardPath,
      targetPath: this.config.sdCardPath,
      playlistFormat: this.config.playlistFormat || 'm3u',
      emitCompanionM3u8: Boolean(
        this.config.emitCompanionM3u8 ?? (this.config.playlistFormat === 'm3u8')
      ),
      registryPath: this.getVaultIndexPath(),
      stats: {
        totalTracks,
        totalBytes,
        totalSizeGB,
        tracksWithArtwork,
      },
    };
  }

  updateConfig(partial) {
    this.init();
    if (!partial || typeof partial !== 'object') {
      return this.getConfig();
    }
    if (typeof partial.sourcePath === 'string' && partial.sourcePath.trim()) {
      this.config.sourcePath = expandTilde(partial.sourcePath.trim());
    }
    if (typeof partial.vaultPath === 'string' && partial.vaultPath.trim()) {
      this.config.vaultPath = expandTilde(partial.vaultPath.trim());
      this.ensureVaultDir();
    }
    const targetInput =
      partial.targetPath !== undefined ? partial.targetPath : partial.sdCardPath;
    if (typeof targetInput === 'string') {
      this.config.sdCardPath = targetInput.trim();
    }
    if (typeof partial.playlistFormat === 'string') {
      const fmt = partial.playlistFormat.toLowerCase().trim();
      this.config.playlistFormat = fmt === 'm3u8' ? 'm3u8' : 'm3u';
      if (fmt === 'm3u8') {
        this.config.emitCompanionM3u8 = true;
      }
    }
    if (partial.emitCompanionM3u8 !== undefined) {
      this.config.emitCompanionM3u8 = Boolean(partial.emitCompanionM3u8);
    }
    this.persist();
    return this.getConfig();
  }

  hasDuplicate({ sha256, normalizedKey, filename }) {
    this.init();
    if (sha256 && this.hashSet.has(sha256)) {
      return { duplicate: true, reason: 'SHA-256 hash match' };
    }
    if (normalizedKey && this.keySet.has(normalizedKey)) {
      return { duplicate: true, reason: 'Normalized Artist|Album|Title match' };
    }
    if (filename) {
      if (this.filenameSet.has(filename.toLowerCase())) {
        return { duplicate: true, reason: 'Filename already indexed' };
      }
      const baseName = getTrackBaseNameFromFilename(filename).toLowerCase();
      if (baseName && this.baseNameSet.has(baseName)) {
        return { duplicate: true, reason: 'Track baseName already in vault' };
      }
    }
    return { duplicate: false, reason: null };
  }

  addTrack(trackRecord) {
    this.init();
    const key = trackRecord.trackKey || trackRecord.normalizedKey || trackRecord.filename;
    const enriched = {
      ...trackRecord,
      normalizedKey: key,
      trackKey: key,
      baseName:
        trackRecord.baseName || getTrackBaseNameFromFilename(trackRecord.filename),
      discNumber: getTrackDiscNumber(trackRecord),
      albumGroupKey: getAlbumGroupKey(trackRecord),
      artworkFilename:
        trackRecord.artworkFilename || getCompanionJpgFilename(trackRecord.filename),
      hasArtwork: Boolean(trackRecord.hasArtwork),
      artworkEmbedded: Boolean(trackRecord.artworkEmbedded ?? trackRecord.hasArtwork),
    };
    this.tracksMap[key] = enriched;
    if (enriched.sha256) this.hashSet.add(enriched.sha256);
    if (key) this.keySet.add(key);
    if (enriched.filename) {
      this.filenameSet.add(enriched.filename.toLowerCase());
      this.baseNameSet.add(
        getTrackBaseNameFromFilename(enriched.filename).toLowerCase()
      );
    }
    if (enriched.baseName) {
      this.baseNameSet.add(enriched.baseName.toLowerCase());
    }
    this.persist();
    return enriched;
  }

  markTrackArtwork(trackKey, hasArtwork = true, extra = {}) {
    this.init();
    const track = this.tracksMap[trackKey];
    if (!track) return null;
    track.hasArtwork = Boolean(hasArtwork);
    track.artworkEmbedded = Boolean(hasArtwork);
    track.artworkUpdatedAt = extra.updatedAt || Date.now();
    track.updatedAt = track.artworkUpdatedAt;
    if (extra.fileSize) {
      track.fileSize = extra.fileSize;
    }
    return track;
  }

  getTracks(searchQuery = '') {
    this.init();
    const all = this.getAllTracksArray();
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;

    return all.filter((t) => {
      return (
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q)) ||
        (t.filename && t.filename.toLowerCase().includes(q)) ||
        (t.discTrack && String(t.discTrack).toLowerCase().includes(q))
      );
    });
  }

  /**
   * Reconciles the in-memory index with audio files inside the Flat Vault directory,
   * cleans up any interrupted `.tmp` files, and preserves embedded `track.hasArtwork` state
   * (while also detecting any pre-migration companion `.jpg` files on disk).
   */
  async syncVaultOnDisk({ force = false } = {}) {
    this.init();
    const now = Date.now();
    if (!force && now - this.lastSyncDiskTime < 2000) {
      return;
    }
    this.lastSyncDiskTime = now;

    const vaultDir = this.getVaultDir();
    try {
      await fsp.mkdir(vaultDir, { recursive: true });
      const entries = await fsp.readdir(vaultDir);

      // Remove any interrupted audio .tmp files (ignore hidden dotfiles like .vault_index.json.tmp)
      let removedTmp = false;
      for (const name of entries) {
        if (!name.startsWith('.') && /\.tmp(\.[a-z0-9]+)?$/i.test(name)) {
          await fsp.unlink(path.join(vaultDir, name)).catch(() => {});
          removedTmp = true;
        }
      }

      const refreshedEntries = removedTmp ? await fsp.readdir(vaultDir) : entries;
      const onDiskSet = new Set();
      for (const entry of refreshedEntries) {
        onDiskSet.add(entry.toLowerCase());
        onDiskSet.add(entry.normalize('NFC').toLowerCase());
      }
      let changed = false;

      for (const [key, track] of Object.entries(this.tracksMap)) {
        const audioFilename = track.filename || '';
        const normAudio = audioFilename.normalize('NFC').toLowerCase();
        if (!onDiskSet.has(audioFilename.toLowerCase()) && !onDiskSet.has(normAudio)) {
          delete this.tracksMap[key];
          changed = true;
          continue;
        }

        const baseName = getTrackBaseNameFromFilename(audioFilename);
        if (track.baseName !== baseName) {
          track.baseName = baseName;
          changed = true;
        }
        if (typeof track.hasArtwork !== 'boolean') {
          track.hasArtwork = Boolean(track.hasArtwork);
          changed = true;
        }
      }

      if (changed) {
        this.rebuildIndexes();
        this.persist();
      }
    } catch {
      // Ignore if vaultPath isn't accessible yet
    }
  }
}

export const db = new VaultRegistry();
