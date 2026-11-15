import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { db, expandTilde } from '../db.js';
import { listPlaylists } from '../playlists.js';
import { resolveTargetMusicDir } from '../config.js';

export const MANIFEST_FILENAME = '.av_snowflake_manifest.json';

export const PROTECTED_ROOT_FOLDERS = new Set([
  'music',
  'system volume information',
  '$recycle.bin',
  '.spotlight-v100',
  '.fseventsd',
  '.trashes',
  '.temporaryitems',
  '.ds_store',
]);

/**
 * Checks whether a folder name matches protected system or library root directories.
 */
export function isProtectedFolder(folderName) {
  if (!folderName || typeof folderName !== 'string') return true;
  const lower = folderName.trim().toLowerCase();
  if (
    lower === '' ||
    lower === '.' ||
    lower === '..' ||
    lower.includes('/') ||
    lower.includes('\\')
  ) {
    return true;
  }
  return PROTECTED_ROOT_FOLDERS.has(lower);
}

/**
 * Sanitizes a playlist name into a clean FAT32/exFAT directory name:
 * - Strips characters illegal on FAT32/exFAT: / \ : * ? " < > | and control chars.
 * - Trims whitespace and trailing dots.
 * - Never collides with protected root directory names like "Music".
 */
export function sanitizeFolderName(name, fallback = 'Playlist') {
  if (!name || typeof name !== 'string') return fallback;
  let sanitized = name
    .replace(/[/\\:*?"<>|\x00-\x1f]/g, '')
    .trim()
    .replace(/\.+$/, '');
  if (!sanitized) return fallback;
  if (sanitized.toLowerCase() === 'music') {
    return 'Music (Playlist)';
  }
  return sanitized;
}

/**
 * Resolves the SD card root directory (the parent of {sdTarget}/Music).
 * e.g., /Volumes/SD_CARD/Music/ -> /Volumes/SD_CARD
 */
export function resolveSdRoot(volumePath) {
  if (!volumePath) return '';
  const cleaned = expandTilde(volumePath.trim());
  const targetMusicDir = resolveTargetMusicDir(cleaned);
  return path.dirname(targetMusicDir.replace(/\/+$/, ''));
}

/**
 * Formats a 1-based sequential track prefix:
 * - 2 digits for playlists < 100 tracks (01, 02...)
 * - 3 digits for playlists >= 100 tracks (001, 002...)
 */
export function formatTrackPrefix(indexZeroBased, totalTracks) {
  const padLength = totalTracks >= 100 ? 3 : 2;
  return String(indexZeroBased + 1).padStart(padLength, '0');
}

/**
 * Synchronizes root playlist folders on the SD card when SNOWSKY Mode is active,
 * or sweeps previously generated playlist folders when SNOWSKY Mode is disabled.
 */
export async function syncPlaylistFolders({
  sdRoot,
  vaultDir,
  exportPlaylistFolders = false,
  emitSyncEvent = () => {},
}) {
  if (!sdRoot || typeof sdRoot !== 'string') return;
  if (!fs.existsSync(sdRoot)) return;

  const manifestPath = path.join(sdRoot, MANIFEST_FILENAME);

  // Read previous manifest if present on the target volume
  let previousFolders = [];
  try {
    if (fs.existsSync(manifestPath)) {
      const raw = await fsp.readFile(manifestPath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data?.folders)) {
        previousFolders = data.folders;
      }
    }
  } catch (err) {
    // Ignore corrupted or unreadable manifest
  }

  // ==================================================
  // MODE 1: SNOWSKY MODE DISABLED (CLEANUP MODE)
  // ==================================================
  if (!exportPlaylistFolders) {
    if (previousFolders.length > 0) {
      for (const folder of previousFolders) {
        if (isProtectedFolder(folder)) continue;
        const folderPath = path.join(sdRoot, folder);
        try {
          const stat = await fsp.stat(folderPath);
          if (stat.isDirectory()) {
            await fsp.rm(folderPath, { recursive: true, force: true });
            emitSyncEvent(
              'PLAYLIST',
              `[PLAYLIST FOLDER] Removed playlist folder (SNOWSKY disabled): /${folder}/`
            );
          }
        } catch {
          // Folder did not exist on disk
        }
      }

      await fsp.unlink(manifestPath).catch(() => {});
      emitSyncEvent(
        'PLAYLIST',
        '[PLAYLIST FOLDER] Cleaned up SNOWSKY playlist folders from SD card.'
      );
    }
    return;
  }

  // ==================================================
  // MODE 2: SNOWSKY MODE ENABLED (EXPORT & SYNC MODE)
  // ==================================================
  const { playlists } = listPlaylists();
  const currentFolders = [];
  const usedFolderNames = new Set();

  const resolvedVaultDir = vaultDir ? expandTilde(vaultDir) : db.getVaultDir();

  for (const playlist of playlists) {
    const rawName = playlist.name || 'Playlist';
    let folderName = sanitizeFolderName(rawName);

    // Ensure distinct folder names even if user has duplicate or homonym playlist titles
    let uniqueName = folderName;
    let counter = 2;
    while (usedFolderNames.has(uniqueName.toLowerCase())) {
      uniqueName = `${folderName}_${counter++}`;
    }
    usedFolderNames.add(uniqueName.toLowerCase());
    currentFolders.push(uniqueName);

    const playlistDir = path.join(sdRoot, uniqueName);
    await fsp.mkdir(playlistDir, { recursive: true });

    const trackKeys = Array.isArray(playlist.trackKeys) ? playlist.trackKeys : [];
    emitSyncEvent(
      'PLAYLIST',
      `[PLAYLIST FOLDER] Syncing "${rawName}" (${trackKeys.length} tracks) -> /${uniqueName}/`
    );

    const expectedFilenames = new Set();
    const tracksToCopy = [];

    for (let i = 0; i < trackKeys.length; i++) {
      const key = trackKeys[i];
      const track = db.getTrackByKey(key);
      if (!track || !track.filename) continue;

      const prefix = formatTrackPrefix(i, trackKeys.length);
      const destFilename = `${prefix} - ${track.filename}`;
      expectedFilenames.add(destFilename);

      tracksToCopy.push({
        track,
        srcPath: path.join(resolvedVaultDir, track.filename),
        destPath: path.join(playlistDir, destFilename),
      });
    }

    // 1. Remove stale files inside playlistDir that are no longer in the expected numbered track list
    try {
      const existingEntries = await fsp.readdir(playlistDir, { withFileTypes: true });
      for (const entry of existingEntries) {
        if (entry.name === '.DS_Store') {
          await fsp.unlink(path.join(playlistDir, entry.name)).catch(() => {});
          continue;
        }
        if (!expectedFilenames.has(entry.name)) {
          const stalePath = path.join(playlistDir, entry.name);
          if (entry.isDirectory()) {
            await fsp.rm(stalePath, { recursive: true, force: true }).catch(() => {});
          } else {
            await fsp.unlink(stalePath).catch(() => {});
          }
        }
      }
    } catch {
      // Readdir failed; ignore
    }

    // 2. Copy audio tracks if missing or file size differs
    for (const item of tracksToCopy) {
      let needsCopy = true;
      try {
        const [srcStat, destStat] = await Promise.all([
          fsp.stat(item.srcPath),
          fsp.stat(item.destPath),
        ]);
        if (srcStat.size === destStat.size) {
          needsCopy = false;
        }
      } catch {
        needsCopy = true;
      }

      if (needsCopy) {
        try {
          await fsp.copyFile(item.srcPath, item.destPath);
        } catch (copyErr) {
          emitSyncEvent(
            'ERROR',
            `[PLAYLIST FOLDER ERROR] Failed to copy "${item.track.filename}": ${copyErr.message}`
          );
        }
      }
    }
  }

  // 3. Remove orphaned playlist folders previously generated on SD root but no longer in active playlists
  const currentSet = new Set(currentFolders.map((f) => f.toLowerCase()));
  for (const prevFolder of previousFolders) {
    if (!currentSet.has(prevFolder.toLowerCase())) {
      if (isProtectedFolder(prevFolder)) continue;
      const staleFolderPath = path.join(sdRoot, prevFolder);
      try {
        const stat = await fsp.stat(staleFolderPath);
        if (stat.isDirectory()) {
          await fsp.rm(staleFolderPath, { recursive: true, force: true });
          emitSyncEvent(
            'PLAYLIST',
            `[PLAYLIST FOLDER] Removed orphaned playlist folder: /${prevFolder}/`
          );
        }
      } catch {
        // Folder didn't exist
      }
    }
  }

  // 4. Save updated sync manifest to SD root
  try {
    const manifestPayload = {
      version: 1,
      generatedBy: 'Audiophile Vault SNOWSKY Mode',
      generatedAt: new Date().toISOString(),
      folders: currentFolders,
    };
    await fsp.writeFile(manifestPath, JSON.stringify(manifestPayload, null, 2), 'utf8');
  } catch (err) {
    emitSyncEvent('ERROR', `[PLAYLIST FOLDER ERROR] Failed to write manifest: ${err.message}`);
  }
}
