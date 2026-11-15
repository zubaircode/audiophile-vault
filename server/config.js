import path from 'node:path';
import os from 'node:os';
import { db, expandTilde } from './db.js';
import { isSafeExternalVolume, listMountedVolumes } from './services/volume.js';

const HOME_DIR = os.homedir();

export const HARDENED_PATH = '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin';

/**
 * Returns a hardened process environment guaranteeing common and system binary lookup paths.
 * macOS GUI-launched apps do not inherit interactive terminal shell `$PATH`.
 */
export function getHardenedEnv(extra = {}) {
  return {
    ...process.env,
    PATH: HARDENED_PATH,
    ...extra,
  };
}

export const DEFAULT_CONFIG = {
  sourcePath: path.join(HOME_DIR, 'Music/Music/Media.localized/Music/'),
  vaultPath: path.join(HOME_DIR, 'Music/AudiophileVault/'),
  sdCardPath: process.env.AV_TARGET_SD_PATH || '',
  exportPlaylistFolders: false,
};

/**
 * Returns the current application configuration merged with stats & defaults.
 */
export function getConfig() {
  return db.getConfig();
}

/**
 * Updates application configuration (`sourcePath`, `vaultPath`, `sdCardPath`, `exportPlaylistFolders`).
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
