import path from 'node:path';
import os from 'node:os';
import { db, expandTilde } from './db.js';
import { isSafeExternalVolume, listMountedVolumes } from './services/volume.js';

const HOME_DIR = os.homedir();

export const DEFAULT_CONFIG = {
  sourcePath: path.join(HOME_DIR, 'Music/Music/Media.localized/Music/'),
  vaultPath: path.join(HOME_DIR, 'Music/AudiophileVault/'),
  sdCardPath: process.env.AV_TARGET_SD_PATH || '',
  playlistFormat: 'm3u',
  emitCompanionM3u8: false,
};

/**
 * Returns the current application configuration merged with stats & defaults.
 */
export function getConfig() {
  return db.getConfig();
}

/**
 * Updates application configuration (`sourcePath`, `vaultPath`, `sdCardPath`, `playlistFormat`).
 */
export function updateConfig(partial) {
  return db.updateConfig(partial);
}

/**
 * Sets the active SD card sync target path after validating safety against `/Volumes/`.
 */
export async function setSyncTarget(requestedPath) {
  if (!requestedPath || typeof requestedPath !== 'string') {
    throw new Error('Target SD card path cannot be empty.');
  }

  const cleaned = expandTilde(requestedPath.trim());
  const safety = await isSafeExternalVolume(cleaned);
  if (!safety.safe) {
    throw new Error(`Target path rejected: ${safety.reason}`);
  }

  return db.updateConfig({ sdCardPath: cleaned });
}

/**
 * Resolves the default sync destination inside a mounted volume.
 * If volume root is passed (e.g. `/Volumes/WALKMAN`), defaults to `/Volumes/WALKMAN/Music/`.
 */
export function resolveTargetMusicDir(volumePath) {
  if (!volumePath) return '';
  const cleaned = expandTilde(volumePath.trim());
  if (path.basename(cleaned).toLowerCase() === 'music') {
    return cleaned;
  }
  return path.join(cleaned, 'Music');
}

export { expandTilde };
