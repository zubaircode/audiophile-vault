import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  db,
  getCompanionJpgFilename,
  getAlbumGroupKey,
  findAlbumSiblingTracks,
} from './db.js';
import { SUPPORTED_EXTENSIONS } from './services/metadata.js';
import {
  embedArtBuffer,
  extractEmbeddedArt,
  hasEmbeddedArt,
  removeEmbeddedArt,
  normalizeToJpegBuffer,
} from './embedder.js';

export const artworkEmitter = new EventEmitter();
artworkEmitter.setMaxListeners(50);

const USER_AGENT = 'AudiophileVault/1.0.0 ( contact@audiophilevault.local )';

// In-memory album cache mapped by "${cleanedArtist.toLowerCase()}|${cleanedAlbum.toLowerCase()}"
// Value shape: { buffer?: Buffer, provider?: 'iTunes' | 'Deezer' | 'CoverArtArchive' | 'Embedded' | 'LocalJPEG' | 'Manual', notFound?: boolean }
const albumArtCache = new Map();

let isFetchingArtwork = false;
let currentAbortController = null;

export function getArtworkState() {
  return { isFetchingArtwork };
}

export function clearAlbumArtNotFoundCache() {
  for (const [k, v] of albumArtCache.entries()) {
    if (v?.notFound) {
      albumArtCache.delete(k);
    }
  }
}

function emitArtworkEvent(type, message, extra = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    type, // 'ARTWORK' | 'SKIPPED' | 'ERROR' | 'DONE'
    message,
    ...extra,
  };
  artworkEmitter.emit('progress', payload);
}

/**
 * 1. QUERY SANITIZATION ENGINE
 * Strips remaster/edition/disc noise, normalizes featuring credits and smart punctuation,
 * and returns both `cleaned` and `original` pairs for waterfall search queries.
 */
export function cleanSearchTerms(artist, album) {
  const originalArtist = String(artist || '').trim();
  const originalAlbum = String(album || '').trim();

  const normalizeQuotes = (str) =>
    str
      .replace(/[’‘`]/g, "'")
      .replace(/[“”]/g, '"');

  const stripEditionNoise = (str) =>
    str
      .replace(
        /\s*[\(\[](remaster(ed)?(\s*\d{4})?|deluxe|expanded|anniversary|special|bonus|live|mono|stereo|explicit)[\)\]]/gi,
        ''
      )
      .replace(
        /\s*[\(\[][^)\]]*\b(remaster(ed)?|deluxe|expanded|anniversary|special\s+edition|bonus\s+track|edition|reissue|explicit|mono|stereo)\b[^)\]]*[\)\]]/gi,
        ''
      )
      .replace(/\s*[\(\[](disc|cd)\s*\d+[^)\]]*[\)\]]/gi, '')
      .replace(/\s*[\(\[](feat\.?|ft\.?|featuring)\s+[^)\]]+[\)\]]/gi, '');

  const stripFeaturing = (str) =>
    str.replace(/\s+\b(feat\.?|ft\.?|featuring)\s+.*$/i, '');

  const finalize = (str) =>
    str
      .replace(/\s+/g, ' ')
      .replace(/[\s\-–—:]+$/g, '')
      .trim();

  const cleanedArtist =
    finalize(stripFeaturing(stripEditionNoise(normalizeQuotes(originalArtist)))) ||
    originalArtist;

  const cleanedAlbum =
    finalize(stripFeaturing(stripEditionNoise(normalizeQuotes(originalAlbum)))) ||
    originalAlbum;

  return {
    cleaned: {
      artist: cleanedArtist,
      album: cleanedAlbum,
    },
    original: {
      artist: originalArtist,
      album: originalAlbum,
    },
    cleanedArtist,
    cleanedAlbum,
    originalArtist,
    originalAlbum,
  };
}

/**
 * Builds the in-memory cache key: "${cleanedArtist.toLowerCase()}|${cleanedAlbum.toLowerCase()}"
 */
export function buildAlbumCacheKey(artist, album) {
  const { cleanedArtist, cleanedAlbum } = cleanSearchTerms(artist, album);
  return `${cleanedArtist.toLowerCase()}|${cleanedAlbum.toLowerCase()}`;
}

/**
 * Checks if a companion `.jpg` file exists on disk and has size > 0 bytes.
 */
export async function hasValidCompanionJpg(targetJpgPath) {
  try {
    const st = await fsp.stat(targetJpgPath);
    if (st.isFile() && st.size > 0) {
      return true;
    }
    if (st.isFile() && st.size === 0) {
      await fsp.unlink(targetJpgPath).catch(() => {});
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Downloads an image URL into a Node.js Buffer.
 */
async function downloadImageBuffer(imageUrl, signal) {
  const response = await fetch(imageUrl, {
    signal,
    headers: {
      'User-Agent': USER_AGENT,
    },
  });

  if (!response.ok) {
    throw new Error(`Image download HTTP ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  if (buffer.length === 0) {
    throw new Error('Downloaded artwork buffer is 0 bytes');
  }
  return buffer;
}

/**
 * Sleep helper that respects an AbortSignal.
 */
function delayWithSignal(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      return reject(new DOMException('Aborted', 'AbortError'));
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ==================================================
// TIER 1: APPLE ITUNES SEARCH API (PRIMARY)
// ==================================================

async function queryItunesTerm(term, signal) {
  if (!term || !term.trim()) return null;
  const url = `https://itunes.apple.com/search?term=${encodeURIComponent(
    term.trim()
  )}&entity=album&limit=3`;

  const res = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !Array.isArray(data.results) || data.results.length === 0) {
    return null;
  }

  for (const item of data.results) {
    if (item?.artworkUrl100 && typeof item.artworkUrl100 === 'string') {
      return item.artworkUrl100
        .replace('100x100bb.jpg', '1000x1000bb.jpg')
        .replace(/\/\d+x\d+bb\.(jpg|png)$/i, '/1000x1000bb.jpg');
    }
  }
  return null;
}

export async function searchITunes(cleanedArtist, cleanedAlbum, signal) {
  try {
    const hasArtist =
      cleanedArtist && cleanedArtist.toLowerCase() !== 'unknown artist';
    const hasAlbum =
      cleanedAlbum && cleanedAlbum.toLowerCase() !== 'unknown album';

    let imageUrl = null;

    if (hasArtist && hasAlbum) {
      imageUrl = await queryItunesTerm(`${cleanedArtist} ${cleanedAlbum}`, signal);
    }

    if (!imageUrl && hasAlbum) {
      imageUrl = await queryItunesTerm(cleanedAlbum, signal);
    }

    if (!imageUrl && hasArtist && !hasAlbum) {
      imageUrl = await queryItunesTerm(cleanedArtist, signal);
    }

    if (!imageUrl) return null;

    const buffer = await downloadImageBuffer(imageUrl, signal);
    return { buffer, provider: 'iTunes' };
  } catch (err) {
    if (err.name === 'AbortError' || signal?.aborted) throw err;
    return null;
  }
}

// ==================================================
// TIER 2: DEEZER PUBLIC API (FIRST FALLBACK)
// ==================================================

async function queryDeezerAlbum(queryStr, signal) {
  if (!queryStr || !queryStr.trim()) return null;
  const url = `https://api.deezer.com/search/album?q=${encodeURIComponent(
    queryStr.trim()
  )}&limit=3`;

  const res = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (!data || !Array.isArray(data.data) || data.data.length === 0) {
    return null;
  }

  for (const item of data.data) {
    const coverUrl = item?.cover_xl || item?.cover_big || item?.cover_medium;
    if (coverUrl && typeof coverUrl === 'string') {
      return coverUrl;
    }
  }
  return null;
}

export async function searchDeezer(cleanedArtist, cleanedAlbum, signal) {
  try {
    const hasArtist =
      cleanedArtist && cleanedArtist.toLowerCase() !== 'unknown artist';
    const hasAlbum =
      cleanedAlbum && cleanedAlbum.toLowerCase() !== 'unknown album';

    let imageUrl = null;

    if (hasArtist && hasAlbum) {
      imageUrl = await queryDeezerAlbum(
        `artist:"${cleanedArtist}" album:"${cleanedAlbum}"`,
        signal
      );
    }

    if (!imageUrl && hasArtist && hasAlbum) {
      imageUrl = await queryDeezerAlbum(
        `${cleanedArtist} ${cleanedAlbum}`,
        signal
      );
    }

    if (!imageUrl && hasAlbum) {
      imageUrl = await queryDeezerAlbum(`album:"${cleanedAlbum}"`, signal);
    }

    if (!imageUrl) return null;

    const buffer = await downloadImageBuffer(imageUrl, signal);
    return { buffer, provider: 'Deezer' };
  } catch (err) {
    if (err.name === 'AbortError' || signal?.aborted) throw err;
    return null;
  }
}

// ==================================================
// TIER 3: MUSICBRAINZ + COVER ART ARCHIVE (DEEP FALLBACK)
// ==================================================

let lastMusicBrainzRequestTime = 0;

async function enforceMusicBrainzRateLimit(signal) {
  const now = Date.now();
  const elapsed = now - lastMusicBrainzRequestTime;
  const minIntervalMs = 1100;
  if (elapsed < minIntervalMs) {
    await delayWithSignal(minIntervalMs - elapsed, signal);
  }
  lastMusicBrainzRequestTime = Date.now();
}

export async function searchMusicBrainz(cleanedArtist, cleanedAlbum, signal) {
  try {
    const hasArtist =
      cleanedArtist && cleanedArtist.toLowerCase() !== 'unknown artist';
    const hasAlbum =
      cleanedAlbum && cleanedAlbum.toLowerCase() !== 'unknown album';

    if (!hasAlbum) return null;

    await enforceMusicBrainzRateLimit(signal);

    const luceneQuery = hasArtist
      ? `release:"${cleanedAlbum}" AND artist:"${cleanedArtist}"`
      : `release:"${cleanedAlbum}"`;

    const mbUrl = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(
      luceneQuery
    )}&fmt=json&limit=3`;

    const mbRes = await fetch(mbUrl, {
      signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
    });

    if (!mbRes.ok) return null;
    const mbData = await mbRes.json();
    const releases = Array.isArray(mbData?.releases) ? mbData.releases : [];
    if (releases.length === 0) return null;

    for (const rel of releases.slice(0, 3)) {
      if (!rel?.id) continue;
      const caaUrl = `https://coverartarchive.org/release/${rel.id}/front-1200`;
      try {
        const buffer = await downloadImageBuffer(caaUrl, signal);
        if (buffer && buffer.length > 0) {
          return { buffer, provider: 'CoverArtArchive' };
        }
      } catch (innerErr) {
        if (innerErr.name === 'AbortError' || signal?.aborted) throw innerErr;
        try {
          const fallbackCaaUrl = `https://coverartarchive.org/release/${rel.id}/front`;
          const buffer = await downloadImageBuffer(fallbackCaaUrl, signal);
          if (buffer && buffer.length > 0) {
            return { buffer, provider: 'CoverArtArchive' };
          }
        } catch (fallbackErr) {
          if (fallbackErr.name === 'AbortError' || signal?.aborted) {
            throw fallbackErr;
          }
        }
      }
    }

    return null;
  } catch (err) {
    if (err.name === 'AbortError' || signal?.aborted) throw err;
    return null;
  }
}

// ==================================================
// MASTER WATERFALL & EMBEDDING ORCHESTRATOR
// ==================================================

/**
 * Finds and unlinks all matching `.jpg`/`.jpeg`/`.png` companion files in `vaultDir`
 * for a given `candidateJpgName` (handling macOS APFS Unicode NFD/NFC normalization).
 */
async function unlinkMatchingJpgOnDisk(vaultDir, candidateJpgName, existingEntries = null) {
  if (!candidateJpgName) return 0;
  let removed = 0;
  const directPath = path.join(vaultDir, path.basename(candidateJpgName));

  try {
    await fsp.unlink(directPath);
    removed += 1;
  } catch (err) {
    if (err.code !== 'ENOENT') {
      throw err;
    }
  }

  try {
    const entries = existingEntries || (await fsp.readdir(vaultDir));
    const targetNfc = path
      .basename(candidateJpgName)
      .normalize('NFC')
      .toLowerCase();
    const targetTrimmedNfc = path
      .basename(candidateJpgName)
      .replace(/\.(jpg|jpeg|png|webp)$/i, '')
      .trim()
      .normalize('NFC')
      .toLowerCase();

    for (const entry of entries) {
      if (!/\.(jpg|jpeg|png|webp)$/i.test(entry)) continue;
      const entryNfc = entry.normalize('NFC').toLowerCase();
      const entryTrimmedNfc = entry
        .replace(/\.(jpg|jpeg|png|webp)$/i, '')
        .trim()
        .normalize('NFC')
        .toLowerCase();

      if (entryNfc === targetNfc || entryTrimmedNfc === targetTrimmedNfc) {
        await fsp.unlink(path.join(vaultDir, entry)).catch(() => {});
        removed += 1;
      }
    }
  } catch {
    // Ignore directory read error
  }

  return removed;
}

/**
 * Resolves a companion `.jpg` on disk if one exists for `targetAudioPath` (for fault-tolerant migration).
 */
async function findExistingCompanionJpgForAudio(targetAudioPath) {
  if (!targetAudioPath) return null;
  const vaultDir = path.dirname(targetAudioPath);
  const audioBase = path
    .basename(targetAudioPath)
    .replace(/\.[^.]+$/, '');
  const directJpg = path.join(vaultDir, `${audioBase}.jpg`);

  if (await hasValidCompanionJpg(directJpg)) {
    return directJpg;
  }

  try {
    const entries = await fsp.readdir(vaultDir);
    const targetNfc = audioBase.trim().normalize('NFC').toLowerCase();
    for (const entry of entries) {
      if (!/\.(jpg|jpeg|png|webp)$/i.test(entry) || /\.tmp/i.test(entry)) {
        continue;
      }
      const entryBaseNfc = entry
        .replace(/\.(jpg|jpeg|png|webp)$/i, '')
        .trim()
        .normalize('NFC')
        .toLowerCase();
      if (entryBaseNfc === targetNfc) {
        const fullCandidate = path.join(vaultDir, entry);
        if (await hasValidCompanionJpg(fullCandidate)) {
          return fullCandidate;
        }
      }
    }
  } catch {
    // Ignore directory read error
  }

  return null;
}

/**
 * Unified master orchestrator for embedding album artwork directly into `targetAudioPath`:
 * 1. Checks if `targetAudioPath` already contains embedded picture tags (`hasEmbeddedArt`).
 *    - If already embedded, caches the picture in `albumArtCache` and returns `ALREADY_EMBEDDED`.
 * 2. Checks in-memory `albumArtCache` for `"${cleanedArtist.toLowerCase()}|${cleanedAlbum.toLowerCase()}"`.
 * 3. Waterfalls across Tier 1 (iTunes) -> Tier 2 (Deezer) -> Tier 3 (MusicBrainz / CoverArtArchive),
 *    and embeds the resulting image buffer directly into `targetAudioPath` (never writing a `.jpg` to disk).
 */
export async function fetchAndEmbedAlbumArt(
  artist,
  album,
  targetAudioPath,
  { signal, rateLimitDelayMs = 150 } = {}
) {
  const { cleanedArtist, cleanedAlbum, originalArtist, originalAlbum } =
    cleanSearchTerms(artist, album);
  const cacheKey = `${cleanedArtist.toLowerCase()}|${cleanedAlbum.toLowerCase()}`;

  // 1. Check if audio file already has embedded artwork
  if (await hasEmbeddedArt(targetAudioPath)) {
    if (!albumArtCache.has(cacheKey)) {
      const existingArt = await extractEmbeddedArt(targetAudioPath);
      if (existingArt?.buffer) {
        albumArtCache.set(cacheKey, {
          buffer: existingArt.buffer,
          provider: 'Embedded',
        });
      }
    }
    return {
      status: 'ALREADY_EMBEDDED',
      provider: 'Embedded',
      path: targetAudioPath,
    };
  }

  // 2. Check in-memory album cache
  if (albumArtCache.has(cacheKey)) {
    const cached = albumArtCache.get(cacheKey);
    if (cached?.buffer && cached.buffer.length > 0) {
      const embedRes = await embedArtBuffer(
        targetAudioPath,
        cached.buffer,
        'image/jpeg'
      );
      return {
        status: 'CACHED',
        provider: cached.provider || 'Cache',
        path: targetAudioPath,
        fileSize: embedRes.fileSize,
      };
    }
    if (cached?.notFound) {
      return { status: 'NOT_FOUND', provider: null, path: targetAudioPath };
    }
  }

  // 3. Throttle / rate limit before external API waterfall (150ms default)
  if (rateLimitDelayMs > 0) {
    await delayWithSignal(rateLimitDelayMs, signal);
  }

  // 4. Waterfall Tier 1 -> Tier 2 -> Tier 3 using cleaned search terms
  let match =
    (await searchITunes(cleanedArtist, cleanedAlbum, signal)) ||
    (await searchDeezer(cleanedArtist, cleanedAlbum, signal)) ||
    (await searchMusicBrainz(cleanedArtist, cleanedAlbum, signal));

  // 5. If cleaned terms differed from original and returned 0 hits, try original terms on iTunes & Deezer
  const termsChanged =
    cleanedArtist !== originalArtist || cleanedAlbum !== originalAlbum;
  if (!match && termsChanged) {
    match =
      (await searchITunes(originalArtist, originalAlbum, signal)) ||
      (await searchDeezer(originalArtist, originalAlbum, signal));
  }

  if (!match || !match.buffer) {
    albumArtCache.set(cacheKey, { notFound: true });
    return { status: 'NOT_FOUND', provider: null, path: targetAudioPath };
  }

  // 6. Cache buffer in memory and embed directly into the audio container (no .jpg written to disk)
  albumArtCache.set(cacheKey, {
    buffer: match.buffer,
    provider: match.provider,
  });

  const embedRes = await embedArtBuffer(
    targetAudioPath,
    match.buffer,
    'image/jpeg'
  );

  return {
    status: 'DOWNLOADED',
    provider: match.provider,
    path: targetAudioPath,
    fileSize: embedRes.fileSize,
  };
}

// Backward-compatible alias used by scanner.js
export const fetchAndSaveAlbumArt = fetchAndEmbedAlbumArt;

/**
 * Stops an in-progress artwork backfill run midway.
 */
export function stopArtworkBackfill() {
  if (!isFetchingArtwork || !currentAbortController) {
    return { stopped: false, message: 'No artwork backfill is currently running.' };
  }
  currentAbortController.abort();
  return { stopped: true, message: 'Stopping artwork lookup…' };
}

/**
 * Runs the multi-tiered artwork backfill & embedding pipeline for either a specific playlist (`playlistId`),
 * an explicit array of `trackKeys`, or the entire library.
 * - Inspects each audio file using `music-metadata` (`hasEmbeddedArt`):
 *   * If embedded picture tags already exist, marks as `ALREADY_EMBEDDED` and skips.
 *   * If missing, queries the waterfall (`iTunes -> Deezer -> CoverArtArchive`), embeds into the audio container,
 *     and throttles with a 150ms delay between tracks.
 */
export async function runArtworkBackfill({ playlistId = null, trackKeys = null } = {}) {
  if (isFetchingArtwork) {
    throw new Error('Artwork lookup is already running.');
  }

  isFetchingArtwork = true;
  currentAbortController = new AbortController();
  const { signal } = currentAbortController;

  clearAlbumArtNotFoundCache();

  await db.syncVaultOnDisk();
  const vaultDir = db.getVaultDir();

  // Determine target tracks (Selected Playlist vs. Full Library)
  let targetTracks = [];
  let scopeLabel = 'Master Library';

  if (playlistId && db.playlists[playlistId]) {
    const pl = db.playlists[playlistId];
    scopeLabel = `Playlist "${pl.name}"`;
    targetTracks = (pl.trackKeys || [])
      .map((k) => db.getTrackByKey(k))
      .filter(Boolean);
  } else if (Array.isArray(trackKeys) && trackKeys.length > 0) {
    scopeLabel = `Selected View (${trackKeys.length} tracks)`;
    targetTracks = trackKeys.map((k) => db.getTrackByKey(k)).filter(Boolean);
  } else {
    targetTracks = db.getAllTracksArray();
  }

  const summary = {
    done: false,
    stopped: false,
    scope: scopeLabel,
    total: targetTracks.length,
    downloaded: 0,
    cached: 0,
    migrated: 0,
    skipped: 0,
    byProvider: {
      itunes: 0,
      deezer: 0,
      coverArtArchive: 0,
      migrated: 0,
    },
    failed: 0,
  };

  const incrementProviderStat = (provider) => {
    if (provider === 'iTunes') summary.byProvider.itunes += 1;
    else if (provider === 'Deezer') summary.byProvider.deezer += 1;
    else if (provider === 'CoverArtArchive') summary.byProvider.coverArtArchive += 1;
    else if (provider === 'LocalJPEG') summary.byProvider.migrated += 1;
  };

  try {
    await fsp.mkdir(vaultDir, { recursive: true });

    emitArtworkEvent(
      'ARTWORK',
      `[ARTWORK] Starting embedded artwork backfill for ${scopeLabel} (${targetTracks.length} tracks)…`
    );

    for (let i = 0; i < targetTracks.length; i += 1) {
      if (signal.aborted) {
        summary.stopped = true;
        break;
      }

      const track = targetTracks[i];
      const trackKey = track.trackKey || track.normalizedKey || track.filename;
      const targetAudioPath = path.join(vaultDir, track.filename);

      try {
        const result = await fetchAndEmbedAlbumArt(
          track.artist,
          track.album,
          targetAudioPath,
          { signal, rateLimitDelayMs: 150 }
        );

        const nowTs = Date.now();

        if (result.status === 'ALREADY_EMBEDDED' || result.status === 'SKIPPED') {
          summary.skipped += 1;
          db.markTrackArtwork(trackKey, true, { updatedAt: track.artworkUpdatedAt || nowTs });
          emitArtworkEvent(
            'SKIPPED',
            `[ALREADY_EMBEDDED] ${track.filename}`,
            { trackKey, hasArtwork: true }
          );
        } else if (result.status === 'MIGRATED') {
          summary.migrated += 1;
          summary.downloaded += 1;
          incrementProviderStat('LocalJPEG');
          db.markTrackArtwork(trackKey, true, {
            updatedAt: nowTs,
            fileSize: result.fileSize,
          });
          emitArtworkEvent(
            'ARTWORK',
            `[EMBEDDED] ${track.filename} (migrated from local .jpg)`,
            {
              trackKey,
              hasArtwork: true,
              provider: 'LocalJPEG',
              updatedAt: nowTs,
            }
          );
        } else if (result.status === 'CACHED') {
          summary.cached += 1;
          summary.downloaded += 1;
          incrementProviderStat(result.provider);
          db.markTrackArtwork(trackKey, true, {
            updatedAt: nowTs,
            fileSize: result.fileSize,
          });
          emitArtworkEvent(
            'ARTWORK',
            `[EMBEDDED] ${track.filename} (${result.provider} cache)`,
            {
              trackKey,
              hasArtwork: true,
              provider: result.provider,
              cached: true,
              updatedAt: nowTs,
            }
          );
        } else if (result.status === 'DOWNLOADED') {
          summary.downloaded += 1;
          incrementProviderStat(result.provider);
          db.markTrackArtwork(trackKey, true, {
            updatedAt: nowTs,
            fileSize: result.fileSize,
          });
          emitArtworkEvent(
            'ARTWORK',
            `[EMBEDDED] ${track.filename} (${result.provider})`,
            {
              trackKey,
              hasArtwork: true,
              provider: result.provider,
              cached: false,
              updatedAt: nowTs,
            }
          );
        } else {
          summary.failed += 1;
          emitArtworkEvent(
            'SKIPPED',
            `[ARTWORK: NOT FOUND] Could not resolve: ${track.artist} - ${track.album}`
          );
        }
      } catch (err) {
        if (err.name === 'AbortError' || signal.aborted) {
          summary.stopped = true;
          break;
        }
        summary.failed += 1;
        emitArtworkEvent(
          'ERROR',
          `[ERROR] Embedding artwork failed for "${track.title}": ${err.message}`
        );
      }
    }

    summary.done = true;
    db.persist();

    const statusVerb = summary.stopped ? 'Stopped by user' : 'Completed';
    const p = summary.byProvider;
    emitArtworkEvent(
      'DONE',
      `[DONE] Embedded Artwork ${statusVerb} (${scopeLabel}) — Embedded: ${summary.downloaded} (iTunes: ${p.itunes}, Deezer: ${p.deezer}, CoverArtArchive: ${p.coverArtArchive}, Migrated: ${p.migrated}) | Already Embedded: ${summary.skipped} | Not Found: ${summary.failed}`,
      { summary }
    );

    return summary;
  } finally {
    isFetchingArtwork = false;
    currentAbortController = null;
  }
}

// ==================================================
// MANUAL ARTWORK OVERRIDE & EXTRACTION ENDPOINTS
// ==================================================

const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

/**
 * Safely normalizes a track baseName (stripping `.jpg` or audio extensions and preventing path traversal).
 */
export function normalizeBaseName(rawBaseName) {
  if (!rawBaseName || typeof rawBaseName !== 'string') {
    throw new Error('Invalid artwork baseName.');
  }
  const safeBase = path.basename(rawBaseName);
  const stripped = safeBase.replace(
    /\.(jpg|jpeg|png|webp|mp3|m4a|flac|alac|wav|aiff|aac|ogg)$/i,
    ''
  );
  if (!stripped || stripped.trim() === '' || stripped === '.' || stripped === '..') {
    throw new Error('Invalid artwork baseName.');
  }
  return stripped;
}

/**
 * Legacy helper retained for compatibility; resolves baseName and vaultDir.
 */
export function resolveCompanionJpgPath(rawBaseName) {
  db.init();
  const baseName = normalizeBaseName(rawBaseName);
  const jpgFilename = `${baseName}.jpg`;
  const vaultDir = db.getVaultDir();
  const fullPath = path.join(vaultDir, jpgFilename);
  return { baseName, jpgFilename, fullPath, vaultDir };
}

/**
 * Locates the audio file `{baseName}.{ext}` in `~/Music/AudiophileVault/` and its track record in `db.tracksMap`.
 */
export async function resolveTrackAudioFile(rawBaseName, trackKey = '') {
  db.init();
  const vaultDir = db.getVaultDir();
  const baseName = normalizeBaseName(rawBaseName);
  const baseNfc = baseName.normalize('NFC').toLowerCase();
  const baseTrimNfc = baseName.trim().normalize('NFC').toLowerCase();
  const allTracks = Object.values(db.tracksMap);

  let track = trackKey ? db.getTrackByKey(trackKey) : null;
  if (!track) {
    track = allTracks.find((t) => {
      const trackBase = (t.filename || '')
        .replace(/\.[^.]+$/, '')
        .normalize('NFC')
        .toLowerCase();
      return trackBase === baseNfc || trackBase.trim() === baseTrimNfc;
    });
  }

  if (track?.filename) {
    const candidatePath = path.join(vaultDir, track.filename);
    try {
      await fsp.access(candidatePath, fs.constants.R_OK);
      return { baseName, vaultDir, audioPath: candidatePath, track };
    } catch {
      // Fallback to directory scan if NFC/NFD differs on disk
    }
  }

  // Direct extension probe
  for (const ext of SUPPORTED_EXTENSIONS) {
    const candidate = path.join(vaultDir, `${baseName}${ext}`);
    try {
      await fsp.access(candidate, fs.constants.R_OK);
      return { baseName, vaultDir, audioPath: candidate, track };
    } catch {
      // Continue
    }
  }

  // Unicode NFC/NFD directory scan fallback
  try {
    const entries = await fsp.readdir(vaultDir);
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (!SUPPORTED_EXTENSIONS.has(ext)) continue;
      const entryBase = entry
        .slice(0, -ext.length)
        .trim()
        .normalize('NFC')
        .toLowerCase();
      if (entryBase === baseTrimNfc) {
        return {
          baseName,
          vaultDir,
          audioPath: path.join(vaultDir, entry),
          track,
        };
      }
    }
  } catch {
    // Ignore readdir error
  }

  return { baseName, vaultDir, audioPath: null, track };
}

/**
 * Extracts embedded artwork from `{baseName}.{ext}` in the vault.
 * Fault-tolerantly falls back to any unmigrated `{baseName}.jpg` on disk (and migrates it into the audio container).
 */
export async function getEmbeddedArtworkForBaseName(
  rawBaseName,
  { trackKey = '' } = {}
) {
  const { baseName, vaultDir, audioPath, track } = await resolveTrackAudioFile(
    rawBaseName,
    trackKey
  );

  if (audioPath) {
    const extracted = await extractEmbeddedArt(audioPath);
    if (extracted?.buffer && extracted.buffer.length > 0) {
      return {
        buffer: extracted.buffer,
        mimeType: extracted.mimeType || 'image/jpeg',
        baseName,
        audioPath,
        track,
      };
    }

    // Fault-tolerant lazy migration if a companion .jpg still exists on disk
    const legacyJpgPath = await findExistingCompanionJpgForAudio(audioPath);
    if (legacyJpgPath) {
      try {
        const jpgBuffer = await fsp.readFile(legacyJpgPath);
        if (jpgBuffer && jpgBuffer.length > 0) {
          // Lazily embed into audio container and remove loose .jpg once verified
          embedArtBuffer(audioPath, jpgBuffer, 'image/jpeg')
            .then(async (res) => {
              if (res.embedded && (await hasEmbeddedArt(audioPath))) {
                await fsp.unlink(legacyJpgPath).catch(() => {});
                if (track) {
                  track.hasArtwork = true;
                  track.artworkEmbedded = true;
                  db.persist();
                }
              }
            })
            .catch(() => {});

          return {
            buffer: jpgBuffer,
            mimeType: 'image/jpeg',
            baseName,
            audioPath,
            track,
          };
        }
      } catch {
        // Ignore read error
      }
    }
  } else {
    // Even if audioPath wasn't matched, check if a direct `{baseName}.jpg` exists
    const directJpg = path.join(vaultDir, `${baseName}.jpg`);
    if (await hasValidCompanionJpg(directJpg)) {
      const jpgBuffer = await fsp.readFile(directJpg);
      return {
        buffer: jpgBuffer,
        mimeType: 'image/jpeg',
        baseName,
        audioPath: null,
        track,
      };
    }
  }

  return null;
}

/**
 * Parses a `multipart/form-data` upload or JSON body for manual artwork replacement.
 * Supports `scope` (`'single'` | `'disc'` | `'album'`) as well as `applyToAlbum` and `includeDisc`.
 */
export async function parseMultipartArtworkRequest(req) {
  const contentType = String(req.headers['content-type'] || '');

  // Case 1: JSON body (e.g. base64 dataUrl)
  if (contentType.includes('application/json') && req.body) {
    const {
      dataUrl,
      imageBase64,
      mimeType,
      trackKey,
      scope,
      applyToAlbum,
      includeDisc,
      artist,
      album,
    } = req.body;
    let rawBase64 = imageBase64 || '';
    let detectedMime = mimeType || 'image/jpeg';

    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:')) {
      const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        detectedMime = match[1].toLowerCase();
        rawBase64 = match[2];
      }
    }

    if (!rawBase64) {
      throw new Error('No image payload provided.');
    }

    const boolApplyAlbum = applyToAlbum === true || applyToAlbum === 'true';
    const boolIncludeDisc = includeDisc === true || includeDisc === 'true';
    const resolvedScope =
      scope === 'album' || scope === 'disc' || scope === 'single'
        ? scope
        : boolApplyAlbum
        ? boolIncludeDisc
          ? 'disc'
          : 'album'
        : 'single';

    return {
      fileBuffer: Buffer.from(rawBase64, 'base64'),
      mimeType: detectedMime,
      trackKey: typeof trackKey === 'string' ? trackKey : '',
      scope: resolvedScope,
      applyToAlbum: resolvedScope === 'album' || resolvedScope === 'disc',
      includeDisc: resolvedScope === 'disc' || boolIncludeDisc,
      artist: typeof artist === 'string' ? artist : '',
      album: typeof album === 'string' ? album : '',
    };
  }

  // Case 2: Standard multipart/form-data upload
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) {
    throw new Error('Expected multipart/form-data with boundary or application/json.');
  }
  const boundary = `--${boundaryMatch[1] || boundaryMatch[2]}`;

  const chunks = [];
  let totalBytes = 0;
  const MAX_BYTES = 25 * 1024 * 1024; // 25 MB limit

  for await (const chunk of req) {
    totalBytes += chunk.length;
    if (totalBytes > MAX_BYTES) {
      throw new Error('Uploaded image exceeds 25 MB limit.');
    }
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks);
  const boundaryBuf = Buffer.from(boundary, 'utf8');
  const fields = {};
  let fileBuffer = null;
  let mimeType = 'image/jpeg';

  let start = rawBody.indexOf(boundaryBuf);
  while (start !== -1) {
    const partStart = start + boundaryBuf.length;
    if (
      rawBody[partStart] === 0x2d &&
      rawBody[partStart + 1] === 0x2d
    ) {
      break;
    }

    const nextBoundary = rawBody.indexOf(boundaryBuf, partStart);
    if (nextBoundary === -1) break;

    let sliceStart = partStart;
    if (rawBody[sliceStart] === 0x0d && rawBody[sliceStart + 1] === 0x0a) {
      sliceStart += 2;
    }
    let sliceEnd = nextBoundary;
    if (rawBody[sliceEnd - 2] === 0x0d && rawBody[sliceEnd - 1] === 0x0a) {
      sliceEnd -= 2;
    }

    const partBuf = rawBody.subarray(sliceStart, sliceEnd);
    const headerEnd = partBuf.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd !== -1) {
      const headerStr = partBuf.subarray(0, headerEnd).toString('utf8');
      const contentBuf = partBuf.subarray(headerEnd + 4);

      const nameMatch = headerStr.match(/name="([^"]+)"/i);
      const filenameMatch = headerStr.match(/filename="([^"]*)"/i);
      const typeMatch = headerStr.match(/Content-Type:\s*([^\r\n;]+)/i);

      const fieldName = nameMatch ? nameMatch[1] : '';

      if (filenameMatch || fieldName === 'image') {
        fileBuffer = Buffer.from(contentBuf);
        if (typeMatch) {
          mimeType = typeMatch[1].trim().toLowerCase();
        }
      } else if (fieldName) {
        fields[fieldName] = contentBuf.toString('utf8').trim();
      }
    }

    start = nextBoundary;
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    throw new Error('No image file found in multipart upload.');
  }

  const boolApplyAlbum =
    fields.applyToAlbum === 'true' || fields.applyToAlbum === '1';
  const boolIncludeDisc =
    fields.includeDisc === 'true' || fields.includeDisc === '1';
  const rawScope = fields.scope;
  const resolvedScope =
    rawScope === 'album' || rawScope === 'disc' || rawScope === 'single'
      ? rawScope
      : boolApplyAlbum
      ? boolIncludeDisc
        ? 'disc'
        : 'album'
      : 'single';

  return {
    fileBuffer,
    mimeType,
    trackKey: fields.trackKey || '',
    scope: resolvedScope,
    applyToAlbum: resolvedScope === 'album' || resolvedScope === 'disc',
    includeDisc: resolvedScope === 'disc' || boolIncludeDisc,
    artist: fields.artist || '',
    album: fields.album || '',
  };
}

/**
 * Embeds custom artwork directly into the targeted audio file (`{baseName}.{ext}`)
 * and optionally across all tracks on the same disc (`scope: 'disc'`) or album (`scope: 'album'`).
 * Never writes loose `.jpg` files to disk, and cleans up any legacy `.jpg` files for the updated tracks.
 */
export async function saveManualArtwork(
  rawBaseName,
  rawBuffer,
  {
    mimeType = 'image/jpeg',
    trackKey = '',
    scope = '',
    applyToAlbum = false,
    includeDisc = false,
    artist = '',
    album = '',
  } = {}
) {
  const normalizedMime = String(mimeType || '').toLowerCase();
  if (normalizedMime && !ALLOWED_IMAGE_MIME_TYPES.has(normalizedMime)) {
    throw new Error(
      `Unsupported MIME type "${mimeType}". Allowed: image/jpeg, image/png, image/webp.`
    );
  }

  const { buffer: jpegBuffer } = await normalizeToJpegBuffer(
    rawBuffer,
    normalizedMime
  );
  const {
    baseName,
    vaultDir,
    audioPath: primaryAudioPath,
    track: primaryTrack,
  } = await resolveTrackAudioFile(rawBaseName, trackKey);

  await fsp.mkdir(vaultDir, { recursive: true });

  const effectiveScope =
    scope === 'album' || scope === 'disc' || scope === 'single'
      ? scope
      : applyToAlbum
      ? includeDisc
        ? 'disc'
        : 'album'
      : 'single';
  const shouldApplyToGroup =
    effectiveScope === 'album' || effectiveScope === 'disc';
  const shouldScopeToDisc = effectiveScope === 'disc' || Boolean(includeDisc);

  const updatedAt = Date.now();
  const affectedTrackKeys = [];
  const allTracks = Object.values(db.tracksMap);

  // 1. Embed into primary audio file if resolved on disk
  if (primaryAudioPath) {
    const embedRes = await embedArtBuffer(
      primaryAudioPath,
      jpegBuffer,
      'image/jpeg'
    );
    await unlinkMatchingJpgOnDisk(vaultDir, `${baseName}.jpg`);

    if (primaryTrack) {
      const key =
        primaryTrack.trackKey ||
        primaryTrack.normalizedKey ||
        primaryTrack.filename;
      primaryTrack.hasArtwork = true;
      primaryTrack.artworkEmbedded = true;
      primaryTrack.artworkUpdatedAt = updatedAt;
      primaryTrack.updatedAt = updatedAt;
      if (embedRes.fileSize) primaryTrack.fileSize = embedRes.fileSize;
      if (key) affectedTrackKeys.push(key);
    }
  }

  const referenceTrack = primaryTrack || {
    artist: String(artist || '').trim(),
    album: String(album || '').trim(),
  };

  // 2. If scope is 'album' or 'disc', embed into all matching sibling audio files
  if (shouldApplyToGroup && (referenceTrack.album || referenceTrack.artist)) {
    const siblingTracks = findAlbumSiblingTracks(allTracks, referenceTrack, {
      includeDisc: shouldScopeToDisc,
    });

    for (const track of siblingTracks) {
      if (!track?.filename) continue;
      const trackAudioPath = path.join(vaultDir, track.filename);

      if (trackAudioPath !== primaryAudioPath) {
        try {
          const embedRes = await embedArtBuffer(
            trackAudioPath,
            jpegBuffer,
            'image/jpeg'
          );
          if (embedRes.fileSize) track.fileSize = embedRes.fileSize;
        } catch (err) {
          console.warn(
            `[EMBEDDER] Failed embedding sibling track ${track.filename}:`,
            err.message
          );
          continue;
        }
      }

      const trackJpg =
        getCompanionJpgFilename(track.filename) || track.artworkFilename;
      if (trackJpg) {
        await unlinkMatchingJpgOnDisk(vaultDir, trackJpg);
      }

      const key = track.trackKey || track.normalizedKey || track.filename;
      track.hasArtwork = true;
      track.artworkEmbedded = true;
      track.artworkUpdatedAt = updatedAt;
      track.updatedAt = updatedAt;
      if (key && !affectedTrackKeys.includes(key)) {
        affectedTrackKeys.push(key);
      }

      const tCacheKey = buildAlbumCacheKey(track.artist, track.album);
      albumArtCache.set(tCacheKey, { buffer: jpegBuffer, provider: 'Manual' });
    }

    const refCacheKey = buildAlbumCacheKey(
      referenceTrack.artist,
      referenceTrack.album
    );
    albumArtCache.set(refCacheKey, { buffer: jpegBuffer, provider: 'Manual' });
  }

  db.persist();

  const affectedCount = Math.max(1, affectedTrackKeys.length);
  const albumGroupKey = getAlbumGroupKey(referenceTrack, {
    includeDisc: shouldScopeToDisc,
  });
  emitArtworkEvent(
    'ARTWORK',
    `[EMBEDDED ART] Updated embedded container art for ${baseName}${
      affectedCount > 1 ? ` (embedded into ${affectedCount} album tracks)` : ''
    }`,
    {
      manual: true,
      baseName,
      scope: effectiveScope,
      albumGroupKey,
      affectedTrackKeys,
      hasArtwork: true,
      updatedAt,
    }
  );

  return {
    success: true,
    baseName,
    scope: effectiveScope,
    albumGroupKey,
    affectedCount,
    updatedCount: affectedCount,
    affectedTrackKeys,
    updatedAt,
  };
}

/**
 * Strips embedded cover art (`APIC` / `METADATA_BLOCK_PICTURE` / `covr`) from the targeted audio file(s)
 * and removes any legacy companion `.jpg` files on disk.
 */
export async function deleteManualArtwork(
  rawBaseName,
  {
    trackKey = '',
    scope = '',
    applyToAlbum = false,
    includeDisc = false,
    artist = '',
    album = '',
  } = {}
) {
  const {
    baseName,
    vaultDir,
    audioPath: primaryAudioPath,
    track: primaryTrack,
  } = await resolveTrackAudioFile(rawBaseName, trackKey);

  const effectiveScope =
    scope === 'album' || scope === 'disc' || scope === 'single'
      ? scope
      : applyToAlbum
      ? includeDisc
        ? 'disc'
        : 'album'
      : 'single';
  const shouldApplyToGroup =
    effectiveScope === 'album' || effectiveScope === 'disc';
  const shouldScopeToDisc = effectiveScope === 'disc' || Boolean(includeDisc);

  const allTracks = Object.values(db.tracksMap);
  const baseNfc = baseName.normalize('NFC').toLowerCase();
  const baseTrimNfc = baseName.trim().normalize('NFC').toLowerCase();

  let dirEntries = [];
  try {
    dirEntries = await fsp.readdir(vaultDir);
  } catch {
    dirEntries = [];
  }

  // Strip embedded art from primary audio file if resolved directly
  if (primaryAudioPath) {
    await removeEmbeddedArt(primaryAudioPath).catch(() => {});
  }
  await unlinkMatchingJpgOnDisk(vaultDir, `${baseName}.jpg`, dirEntries);

  const updatedAt = Date.now();
  const affectedTrackKeys = [];

  const referenceTrack = primaryTrack || {
    artist: String(artist || '').trim(),
    album: String(album || '').trim(),
  };

  const siblingSet = new Set();
  if (shouldApplyToGroup && (referenceTrack.album || referenceTrack.artist)) {
    const siblings = findAlbumSiblingTracks(allTracks, referenceTrack, {
      includeDisc: shouldScopeToDisc,
    });
    for (const s of siblings) {
      const sKey = s.trackKey || s.normalizedKey || s.filename;
      if (sKey) siblingSet.add(sKey);
    }
  }

  for (const track of allTracks) {
    const tKey = track.trackKey || track.normalizedKey || track.filename;
    const trackBase = (track.filename || '')
      .replace(/\.[^.]+$/, '')
      .normalize('NFC')
      .toLowerCase();
    const isPrimaryMatch =
      (trackKey && tKey === trackKey) ||
      trackBase === baseNfc ||
      trackBase.trim() === baseTrimNfc;

    const isAlbumMatch = shouldApplyToGroup && tKey && siblingSet.has(tKey);

    if (isPrimaryMatch || isAlbumMatch) {
      if (track.filename) {
        const trackAudioPath = path.join(vaultDir, track.filename);
        const stripRes = await removeEmbeddedArt(trackAudioPath).catch(
          () => null
        );
        if (stripRes?.fileSize) {
          track.fileSize = stripRes.fileSize;
        }
      }
      const trackJpg =
        getCompanionJpgFilename(track.filename) || track.artworkFilename;
      if (trackJpg) {
        await unlinkMatchingJpgOnDisk(vaultDir, trackJpg, dirEntries);
      }
      track.hasArtwork = false;
      track.artworkEmbedded = false;
      track.artworkUpdatedAt = updatedAt;
      track.updatedAt = updatedAt;
      if (tKey && !affectedTrackKeys.includes(tKey)) {
        affectedTrackKeys.push(tKey);
      }
      const tCacheKey = buildAlbumCacheKey(track.artist, track.album);
      albumArtCache.delete(tCacheKey);
    }
  }

  if (referenceTrack.artist || referenceTrack.album) {
    const cacheKey = buildAlbumCacheKey(
      referenceTrack.artist,
      referenceTrack.album
    );
    albumArtCache.delete(cacheKey);
  }

  db.persist();

  const removedCount = Math.max(1, affectedTrackKeys.length);
  const albumGroupKey = getAlbumGroupKey(referenceTrack, {
    includeDisc: shouldScopeToDisc,
  });
  emitArtworkEvent(
    'ARTWORK',
    `[EMBEDDED ART] Removed embedded artwork from ${baseName}${
      removedCount > 1 ? ` (${removedCount} album tracks)` : ''
    }`,
    {
      manual: true,
      baseName,
      scope: effectiveScope,
      albumGroupKey,
      affectedTrackKeys,
      hasArtwork: false,
      updatedAt,
    }
  );

  return {
    success: true,
    baseName,
    scope: effectiveScope,
    albumGroupKey,
    removedCount,
    affectedCount: removedCount,
    affectedTrackKeys,
    updatedAt,
  };
}
