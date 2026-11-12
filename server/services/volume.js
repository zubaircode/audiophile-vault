import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const VOLUMES_ROOT = '/Volumes';

const FORBIDDEN_VOLUME_NAMES = new Set([
  'Macintosh HD',
  'Macintosh HD - Data',
  'Recovery',
  'Preboot',
  'VM',
  'Update',
  'com.apple.TimeMachine.localsnapshots',
]);

/**
 * Validates that a volume path is strictly inside `/Volumes/{VolumeName}` and is not root `/`
 * or a system partition such as `Macintosh HD`.
 */
export async function isSafeExternalVolume(volumePath) {
  if (!volumePath || typeof volumePath !== 'string') {
    return { safe: false, reason: 'Volume path is empty.' };
  }

  const resolved = path.resolve(volumePath);
  if (resolved === '/' || !resolved.startsWith('/Volumes/')) {
    return {
      safe: false,
      reason: `Target "${resolved}" must reside under /Volumes/.`,
    };
  }

  const relative = path.relative(VOLUMES_ROOT, resolved);
  const volumeName = relative.split(path.sep)[0];

  if (!volumeName || volumeName === '.' || volumeName === '..') {
    return { safe: false, reason: 'Invalid volume name.' };
  }

  if (FORBIDDEN_VOLUME_NAMES.has(volumeName)) {
    return {
      safe: false,
      reason: `"${volumeName}" is a protected macOS system volume.`,
    };
  }

  const canonicalMount = path.join(VOLUMES_ROOT, volumeName);

  try {
    const lstat = await fsp.lstat(canonicalMount);
    if (lstat.isSymbolicLink()) {
      const realTarget = await fsp.realpath(canonicalMount);
      if (realTarget === '/') {
        return {
          safe: false,
          reason: `"${volumeName}" points to the root filesystem (/).`,
        };
      }
    }
  } catch (err) {
    return {
      safe: false,
      reason: `Volume "${canonicalMount}" is not currently mounted (${err.message}).`,
    };
  }

  return {
    safe: true,
    volumeName,
    resolvedVolumePath: canonicalMount,
  };
}

/**
 * Queries `df -k` for disk capacity & available space in bytes for a mount path.
 */
async function getDiskSpaceBytes(mountPath) {
  try {
    const { stdout } = await execFileAsync('/bin/df', ['-k', mountPath]);
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) return { freeSpace: 0, totalSpace: 0 };

    // Last line has columns: Filesystem 1024-blocks Used Available Capacity iused ifree %iused Mounted on
    const parts = lines[lines.length - 1].trim().split(/\s+/);
    const totalBlocks = parseInt(parts[1], 10);
    const availBlocks = parseInt(parts[3], 10);

    if (Number.isNaN(totalBlocks) || Number.isNaN(availBlocks)) {
      return { freeSpace: 0, totalSpace: 0 };
    }

    return {
      totalSpace: totalBlocks * 1024,
      freeSpace: availBlocks * 1024,
    };
  } catch {
    return { freeSpace: 0, totalSpace: 0 };
  }
}

/**
 * Lists removable/external volumes mounted in `/Volumes/`, filtering out `Macintosh HD` and system volumes.
 */
export async function listMountedVolumes() {
  let entries = [];
  try {
    entries = await fsp.readdir(VOLUMES_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }

  const volumes = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    if (FORBIDDEN_VOLUME_NAMES.has(entry.name)) continue;

    const fullPath = path.join(VOLUMES_ROOT, entry.name);
    const check = await isSafeExternalVolume(fullPath);
    if (!check.safe) continue;

    try {
      await fsp.access(fullPath, fs.constants.R_OK | fs.constants.W_OK);
    } catch {
      // Skip read-only or inaccessible system mounts
      continue;
    }

    const { freeSpace, totalSpace } = await getDiskSpaceBytes(fullPath);
    volumes.push({
      name: entry.name,
      path: fullPath,
      musicTargetPath: path.join(fullPath, 'Music'),
      freeSpace,
      totalSpace,
    });
  }

  return volumes;
}

/**
 * Ejects a mounted volume using `/usr/sbin/diskutil unmountDisk /Volumes/{SelectedVolume}`.
 */
export async function ejectVolume(volumePath) {
  const check = await isSafeExternalVolume(volumePath);
  if (!check.safe) {
    throw new Error(`Cannot eject volume: ${check.reason}`);
  }

  const { stdout, stderr } = await execFileAsync('/usr/sbin/diskutil', [
    'unmountDisk',
    check.resolvedVolumePath,
  ]);

  return {
    success: true,
    volume: check.volumeName,
    path: check.resolvedVolumePath,
    output: (stdout || stderr || `Unmounted ${check.resolvedVolumePath}`).trim(),
  };
}
