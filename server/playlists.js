import fs from 'node:fs';
import path from 'node:path';
import { db } from './db.js';
import { sanitizeSegment } from './services/metadata.js';

/**
 * Sanitizes a playlist display name into a clean filesystem-safe `.m3u` filename.
 */
export function getPlaylistFilename(playlistName) {
  const safeStem = sanitizeSegment(playlistName, 'Playlist');
  return `${safeStem}.m3u`;
}

export function getPlaylistM3u8Filename(playlistName) {
  return getPlaylistFilename(playlistName);
}

/**
 * Resolves the relative path between the playlist destination directory and the audio file.
 * - Forces forward slashes (`/`).
 * - Ensures the path never begins with a leading slash (`/`).
 * - Strips leading `./` so strict embedded RTOS parsers resolve directly.
 */
export function resolveRelativeTrackPath(targetPlaylistDir, trackFilenameOrPath, audioDir) {
  const baseAudioDir = audioDir || db.getVaultDir();
  const basePlaylistDir = targetPlaylistDir || baseAudioDir;

  const absoluteTrackPath = path.isAbsolute(trackFilenameOrPath)
    ? trackFilenameOrPath
    : path.join(baseAudioDir, trackFilenameOrPath);

  let relativeTrackPath = path.relative(basePlaylistDir, absoluteTrackPath)
    .split(path.sep)
    .join('/'); // Force forward slashes

  // Zero Leading Slashes: Ensure the output never begins with / or \
  relativeTrackPath = relativeTrackPath.replace(/^[/\\]+/, '');

  // Strip leading ./ if present so RTOS players resolve directly
  if (relativeTrackPath.startsWith('./')) {
    relativeTrackPath = relativeTrackPath.slice(2);
  }

  return relativeTrackPath;
}

/**
 * Builds universal M3U file content:
 * - Line Endings: Strict Windows CRLF (\r\n) on every line to prevent embedded RTOS parsers
 *   from appending \r to track names.
 * - File Structure:
 *     #EXTM3U\r\n
 *     #EXTINF:-1,{Artist} - {Title}\r\n
 *     {relativeTrackPath}\r\n
 * - Relative Path Resolution: Enforces forward slashes and zero leading slashes.
 * - Encoding: Standard UTF-8 without Byte Order Mark (BOM).
 */
export function buildM3u8Content(playlist, options = {}) {
  const CRLF = '\r\n';
  const lines = ['#EXTM3U'];
  const trackKeys = Array.isArray(playlist?.trackKeys) ? playlist.trackKeys : [];

  const targetPlaylistDir = options.targetPlaylistDir || db.getVaultDir();
  const audioDir = options.audioDir || db.getVaultDir();

  for (const key of trackKeys) {
    const track = db.getTrackByKey(key);
    if (!track || !track.filename) continue;

    const artist = (track.artist || 'Unknown Artist').replace(/\r?\n/g, ' ').trim();
    const title = (track.title || track.filename).replace(/\r?\n/g, ' ').trim();

    const relativeTrackPath = resolveRelativeTrackPath(
      targetPlaylistDir,
      track.filename,
      audioDir
    );

    lines.push(`#EXTINF:-1,${artist} - ${title}`);
    lines.push(relativeTrackPath);
  }

  return lines.join(CRLF) + CRLF;
}

export const buildPlaylistContent = buildM3u8Content;

/**
 * Removes the discontinued `PLAYLISTS/` directory if present and sweeps any legacy `.m3u8` files
 * so only clean `.m3u` files remain.
 * Never removes primary `.m3u` files.
 */
export function cleanupStrayRootM3u8Files(_unused, targetDir) {
  try {
    const vaultDir = targetDir || db.getVaultDir();
    if (!fs.existsSync(vaultDir)) return;

    // 1. Remove discontinued PLAYLISTS subfolder if present
    const legacyPlaylistsSubdir = path.join(vaultDir, 'PLAYLISTS');
    if (fs.existsSync(legacyPlaylistsSubdir)) {
      fs.rmSync(legacyPlaylistsSubdir, { recursive: true, force: true });
    }

    // 2. Always sweep legacy .m3u8 files
    const entries = fs.readdirSync(vaultDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /\.m3u8$/i.test(entry.name)) {
        try {
          fs.unlinkSync(path.join(vaultDir, entry.name));
        } catch {
          // Ignore individual unlink error
        }
      }
    }
  } catch (err) {
    console.warn('[PLAYLIST] Could not sweep legacy/obsolete playlist files:', err.message);
  }
}

/**
 * Writes the universal `.m3u` playlist file to the destination directory
 * (UTF-8 without BOM, CRLF line endings, relative paths without leading slashes)
 * and removes any legacy `.m3u8` file with the same stem.
 */
export function writePlaylistM3u8(playlist, options = {}) {
  db.init();
  const targetPlaylistDir = options.targetPlaylistDir || db.getVaultDir();
  const audioDir = options.audioDir || db.getVaultDir();

  fs.mkdirSync(targetPlaylistDir, { recursive: true });

  const content = buildM3u8Content(playlist, { targetPlaylistDir, audioDir });

  // Write primary .m3u file (Universal Standard for Music Players)
  const m3uFilename = getPlaylistFilename(playlist.name);
  const m3uFullPath = path.join(targetPlaylistDir, m3uFilename);
  fs.writeFileSync(m3uFullPath, content, { encoding: 'utf8' });

  // Ensure any legacy .m3u8 file with the same stem is removed
  const legacyM3u8Filename = `${sanitizeSegment(playlist.name, 'Playlist')}.m3u8`;
  const legacyM3u8FullPath = path.join(targetPlaylistDir, legacyM3u8Filename);
  if (fs.existsSync(legacyM3u8FullPath)) {
    try {
      fs.unlinkSync(legacyM3u8FullPath);
    } catch {
      // Ignore unlink error
    }
  }

  console.log(`[PLAYLIST] Generated universal .m3u playlist: "${m3uFilename}"`);
  return m3uFullPath;
}

export const writePlaylist = writePlaylistM3u8;

/**
 * Removes a playlist file (.m3u and any legacy .m3u8) from the destination directory if it exists.
 */
export function deletePlaylistM3u8(playlistName, options = {}) {
  try {
    const targetPlaylistDir = options.targetPlaylistDir || db.getVaultDir();
    const safeStem = sanitizeSegment(playlistName, 'Playlist');
    const m3uFilename = `${safeStem}.m3u`;
    const legacyM3u8Filename = `${safeStem}.m3u8`;

    for (const name of [m3uFilename, legacyM3u8Filename]) {
      const fullPath = path.join(targetPlaylistDir, name);
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    }
  } catch (err) {
    console.warn(`[PLAYLIST] Could not delete playlist files for "${playlistName}":`, err.message);
  }
}

/**
 * Regenerates all `.m3u` playlist files in the vault from `.vault_index.json`,
 * removes the legacy `PLAYLISTS/` directory, sweeps any `.m3u8` files, and prunes orphaned `.m3u` files.
 */
export function syncAllPlaylistsM3u8(options = {}) {
  db.init();
  const targetPlaylistDir = options.targetPlaylistDir || db.getVaultDir();
  const audioDir = options.audioDir || db.getVaultDir();

  cleanupStrayRootM3u8Files(undefined, targetPlaylistDir);
  fs.mkdirSync(targetPlaylistDir, { recursive: true });

  const validFilenames = new Set();
  for (const playlist of Object.values(db.playlists)) {
    const m3uFilename = getPlaylistFilename(playlist.name);
    validFilenames.add(m3uFilename.toLowerCase());

    writePlaylistM3u8(playlist, {
      targetPlaylistDir,
      audioDir,
    });
  }

  // Prune any orphaned .m3u or legacy .m3u8 files in the target playlist directory
  try {
    const entries = fs.readdirSync(targetPlaylistDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const lower = entry.name.toLowerCase();
      if (lower.endsWith('.m3u')) {
        if (!validFilenames.has(lower)) {
          fs.unlinkSync(path.join(targetPlaylistDir, entry.name));
        }
      } else if (lower.endsWith('.m3u8')) {
        fs.unlinkSync(path.join(targetPlaylistDir, entry.name));
      }
    }
  } catch {
    // Ignore read/unlink errors if targetPlaylistDir is not yet accessible
  }
}

/**
 * Returns all playlists sorted alphabetically by name, along with `mostRecentPlaylistId`.
 */
export function listPlaylists() {
  db.init();
  const playlists = Object.values(db.playlists).sort((a, b) =>
    (a.name || '').localeCompare(b.name || '', undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );

  // Verify mostRecentPlaylistId still points to a valid playlist
  let mostRecentPlaylistId = db.mostRecentPlaylistId;
  if (mostRecentPlaylistId && !db.playlists[mostRecentPlaylistId]) {
    mostRecentPlaylistId = playlists.length > 0 ? playlists[0].id : null;
    db.mostRecentPlaylistId = mostRecentPlaylistId;
    db.persist();
  } else if (!mostRecentPlaylistId && playlists.length > 0) {
    mostRecentPlaylistId = playlists[0].id;
  }

  return {
    playlists,
    mostRecentPlaylistId,
  };
}

/**
 * Generates the default playlist name `"Playlist XX"` where XX is a 2-digit zero-padded number
 * starting at `(current playlist count + 1)` and avoiding collisions.
 */
function generateDefaultPlaylistName() {
  const existingNames = new Set(
    Object.values(db.playlists).map((p) => (p.name || '').toLowerCase())
  );
  let num = Object.keys(db.playlists).length + 1;
  let candidate = `Playlist ${String(num).padStart(2, '0')}`;

  while (existingNames.has(candidate.toLowerCase())) {
    num += 1;
    candidate = `Playlist ${String(num).padStart(2, '0')}`;
  }
  return candidate;
}

/**
 * Generates a unique playlist ID (`pl_1`, `pl_2`, ...).
 */
function generatePlaylistId() {
  let idx = Object.keys(db.playlists).length + 1;
  while (db.playlists[`pl_${idx}`]) {
    idx += 1;
  }
  return `pl_${idx}`;
}

/**
 * Creates a new playlist, writes its initial `.m3u8` file, and updates `.vault_index.json`.
 */
export function createPlaylist(rawName) {
  db.init();
  const trimmed = typeof rawName === 'string' ? rawName.trim() : '';
  const finalName = trimmed
    ? sanitizeSegment(trimmed, generateDefaultPlaylistName())
    : generateDefaultPlaylistName();

  // Check for duplicate playlist name
  const duplicateName = Object.values(db.playlists).some(
    (p) => p.name.toLowerCase() === finalName.toLowerCase()
  );
  if (duplicateName && trimmed) {
    throw new Error(`A playlist named "${finalName}" already exists.`);
  }

  const id = generatePlaylistId();
  const now = new Date().toISOString();

  const playlist = {
    id,
    name: finalName,
    createdAt: now,
    updatedAt: now,
    trackKeys: [],
  };

  db.playlists[id] = playlist;
  db.mostRecentPlaylistId = id;
  db.persist();
  writePlaylistM3u8(playlist);

  return playlist;
}

/**
 * Renames an existing playlist, safely removes/renames the old `.m3u8` file, and writes the new `.m3u8` file.
 */
export function renamePlaylist(id, rawNewName) {
  db.init();
  const playlist = db.playlists[id];
  if (!playlist) {
    throw new Error('Playlist not found.');
  }

  const trimmed = typeof rawNewName === 'string' ? rawNewName.trim() : '';
  if (!trimmed) {
    throw new Error('Playlist name cannot be empty.');
  }

  const sanitizedName = sanitizeSegment(trimmed, playlist.name);

  const collision = Object.values(db.playlists).some(
    (p) => p.id !== id && p.name.toLowerCase() === sanitizedName.toLowerCase()
  );
  if (collision) {
    throw new Error(`A playlist named "${sanitizedName}" already exists.`);
  }

  const oldName = playlist.name;
  const oldM3u8File = getPlaylistM3u8Filename(oldName);
  const newM3u8File = getPlaylistM3u8Filename(sanitizedName);

  playlist.name = sanitizedName;
  playlist.updatedAt = new Date().toISOString();
  db.mostRecentPlaylistId = id;

  if (oldM3u8File !== newM3u8File) {
    deletePlaylistM3u8(oldName);
  }

  writePlaylistM3u8(playlist);
  db.persist();

  return playlist;
}

/**
 * Clones a playlist and its `trackKeys` into `"{Original Name} Copy"` (or numbered suffix on collision).
 */
export function duplicatePlaylist(id) {
  db.init();
  const source = db.playlists[id];
  if (!source) {
    throw new Error('Source playlist not found.');
  }

  const existingNames = new Set(
    Object.values(db.playlists).map((p) => p.name.toLowerCase())
  );

  const baseCopyName = sanitizeSegment(`${source.name} Copy`, 'Playlist Copy');
  let finalName = baseCopyName;
  let suffix = 2;

  while (existingNames.has(finalName.toLowerCase())) {
    finalName = `${baseCopyName} ${suffix}`;
    suffix += 1;
  }

  const newId = generatePlaylistId();
  const now = new Date().toISOString();

  const cloned = {
    id: newId,
    name: finalName,
    createdAt: now,
    updatedAt: now,
    trackKeys: Array.isArray(source.trackKeys) ? [...source.trackKeys] : [],
  };

  db.playlists[newId] = cloned;
  db.mostRecentPlaylistId = newId;
  db.persist();
  writePlaylistM3u8(cloned);

  return cloned;
}

/**
 * Deletes a playlist from `.vault_index.json` and removes its `.m3u8` file on disk.
 */
export function deletePlaylist(id) {
  db.init();
  const playlist = db.playlists[id];
  if (!playlist) {
    throw new Error('Playlist not found.');
  }

  deletePlaylistM3u8(playlist.name);
  delete db.playlists[id];

  if (db.mostRecentPlaylistId === id) {
    const remaining = Object.values(db.playlists).sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );
    db.mostRecentPlaylistId = remaining.length > 0 ? remaining[0].id : null;
  }

  db.persist();
  return { deletedId: id, name: playlist.name, mostRecentPlaylistId: db.mostRecentPlaylistId };
}

/**
 * Appends `trackKey` to the playlist's `trackKeys` (preventing duplicates),
 * updates `mostRecentPlaylistId`, and rewrites the `.m3u8` file on disk.
 */
export function addTrackToPlaylist(id, trackKey) {
  db.init();
  const playlist = db.playlists[id];
  if (!playlist) {
    throw new Error('Playlist not found.');
  }

  if (!trackKey || typeof trackKey !== 'string') {
    throw new Error('Valid trackKey is required.');
  }

  if (!Array.isArray(playlist.trackKeys)) {
    playlist.trackKeys = [];
  }

  const alreadyExists = playlist.trackKeys.includes(trackKey);
  if (!alreadyExists) {
    playlist.trackKeys.push(trackKey);
    playlist.updatedAt = new Date().toISOString();
  }

  db.mostRecentPlaylistId = id;
  db.persist();
  writePlaylistM3u8(playlist);

  const track = db.getTrackByKey(trackKey);

  return {
    playlist,
    alreadyExists,
    mostRecentPlaylistId: db.mostRecentPlaylistId,
    track,
  };
}

/**
 * Removes `trackKey` from a playlist's `trackKeys` array and rewrites the `.m3u8` file on disk.
 */
export function removeTrackFromPlaylist(id, trackKey) {
  db.init();
  const playlist = db.playlists[id];
  if (!playlist) {
    throw new Error('Playlist not found.');
  }

  if (!Array.isArray(playlist.trackKeys)) {
    playlist.trackKeys = [];
  }

  const beforeLen = playlist.trackKeys.length;
  playlist.trackKeys = playlist.trackKeys.filter((k) => k !== trackKey);
  const removed = playlist.trackKeys.length !== beforeLen;

  if (removed) {
    playlist.updatedAt = new Date().toISOString();
  }

  db.persist();
  writePlaylistM3u8(playlist);

  const track = db.getTrackByKey(trackKey);

  return {
    playlist,
    removed,
    track,
  };
}

/**
 * Writes the `.m3u8` file to disk for a playlist by ID.
 */
export function writeM3U8File(playlistId) {
  db.init();
  const playlist = db.playlists[playlistId];
  if (!playlist) {
    throw new Error('Playlist not found.');
  }
  return writePlaylistM3u8(playlist);
}

/**
 * Reorders `playlist.trackKeys` via either `{ trackKeys: string[] }` or `{ fromIndex, toIndex }`,
 * validates membership, saves `.vault_index.json`, and regenerates the `.m3u8` file on disk.
 */
export function reorderPlaylistTracks(id, { trackKeys, fromIndex, toIndex } = {}) {
  db.init();
  const playlist = db.playlists[id];
  if (!playlist) {
    throw new Error('Playlist not found.');
  }

  const currentKeys = Array.isArray(playlist.trackKeys) ? [...playlist.trackKeys] : [];

  if (Array.isArray(trackKeys)) {
    if (trackKeys.length !== currentKeys.length) {
      throw new Error(
        `Invalid reorder payload: expected ${currentKeys.length} trackKeys, received ${trackKeys.length}.`
      );
    }

    const currentSet = new Set(currentKeys);
    const incomingSet = new Set(trackKeys);

    if (
      currentSet.size !== incomingSet.size ||
      !trackKeys.every((k) => typeof k === 'string' && currentSet.has(k))
    ) {
      throw new Error('Invalid reorder payload: all track keys must belong to the playlist.');
    }

    playlist.trackKeys = [...trackKeys];
  } else if (typeof fromIndex === 'number' && typeof toIndex === 'number') {
    if (
      fromIndex < 0 ||
      fromIndex >= currentKeys.length ||
      toIndex < 0 ||
      toIndex >= currentKeys.length
    ) {
      throw new Error('Invalid fromIndex or toIndex bounds for playlist reorder.');
    }

    if (fromIndex !== toIndex) {
      const [moved] = currentKeys.splice(fromIndex, 1);
      currentKeys.splice(toIndex, 0, moved);
      playlist.trackKeys = currentKeys;
    }
  } else {
    throw new Error('Provide either { trackKeys: string[] } or { fromIndex, toIndex }.');
  }

  playlist.updatedAt = new Date().toISOString();
  db.persist();
  writeM3U8File(id);

  return playlist;
}

/**
 * Moves a single `trackKey` one step `"up"` or `"down"` in `playlist.trackKeys`,
 * saves `.vault_index.json`, and regenerates the `.m3u8` file on disk.
 */
export function movePlaylistTrack(id, trackKey, direction) {
  db.init();
  const playlist = db.playlists[id];
  if (!playlist) {
    throw new Error('Playlist not found.');
  }

  if (direction !== 'up' && direction !== 'down') {
    throw new Error('Direction must be "up" or "down".');
  }

  const keys = Array.isArray(playlist.trackKeys) ? [...playlist.trackKeys] : [];
  const currentIndex = keys.indexOf(trackKey);

  if (currentIndex === -1) {
    throw new Error('Track not found in playlist.');
  }

  let targetIndex = currentIndex;
  if (direction === 'up' && currentIndex > 0) {
    targetIndex = currentIndex - 1;
  } else if (direction === 'down' && currentIndex < keys.length - 1) {
    targetIndex = currentIndex + 1;
  }

  if (targetIndex !== currentIndex) {
    const temp = keys[currentIndex];
    keys[currentIndex] = keys[targetIndex];
    keys[targetIndex] = temp;
    playlist.trackKeys = keys;
    playlist.updatedAt = new Date().toISOString();
    db.persist();
    writeM3U8File(id);
  }

  return playlist;
}

