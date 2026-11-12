import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { db, expandTilde } from '../db.js';
import { isSafeExternalVolume } from './volume.js';
import { syncAllPlaylistsM3u8 } from '../playlists.js';
import { resolveTargetMusicDir } from '../config.js';

export const syncEmitter = new EventEmitter();
syncEmitter.setMaxListeners(50);

let isSyncing = false;

export function getSyncState() {
  return { isSyncing };
}

function emitSyncEvent(type, message, extra = {}) {
  const payload = {
    timestamp: new Date().toISOString(),
    type, // 'RSYNC' | 'ERROR' | 'DONE'
    message,
    ...extra,
  };
  syncEmitter.emit('progress', payload);
}

/**
 * Buffers a readable stream and invokes `onLine` for each complete line (`\n` or `\r`).
 */
function attachLineReader(stream, onLine) {
  let buffer = '';
  stream.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    const lines = buffer.split(/\r?\n|\r/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) onLine(trimmed);
    }
  });
  stream.on('end', () => {
    const trimmed = buffer.trim();
    if (trimmed) onLine(trimmed);
  });
}

/**
 * Spawns `/usr/bin/rsync` to synchronize the Flat Vault directory with `/Volumes/{SelectedVolume}/Music/`.
 */
export async function runRsyncToSdCard(requestedVolumePath) {
  if (isSyncing) {
    throw new Error('An rsync operation is already in progress.');
  }

  const config = db.getConfig();
  const vaultDir = expandTilde(config.vaultPath);
  const volumePath = requestedVolumePath || config.sdCardPath;

  if (!volumePath) {
    throw new Error('No target SD card or external volume selected.');
  }

  // Strict safety verification against `/` or `Macintosh HD`
  const safety = await isSafeExternalVolume(volumePath);
  if (!safety.safe) {
    throw new Error(`Unsafe target volume blocked: ${safety.reason}`);
  }

  // Resolve target directory (defaults to {SelectedVolume}/Music/ if root volume is given)
  const resolvedTarget = resolveTargetMusicDir(volumePath);
  const targetMusicDir = resolvedTarget.endsWith('/') ? resolvedTarget : `${resolvedTarget}/`;
  const normalizedVaultDir = vaultDir.endsWith('/') ? vaultDir : `${vaultDir}/`;

  isSyncing = true;

  try {
    await fsp.mkdir(normalizedVaultDir, { recursive: true });
    await fsp.mkdir(targetMusicDir, { recursive: true });

    // Regenerate all universal playlists in ~/Music/AudiophileVault/ prior to rsync
    syncAllPlaylistsM3u8();

    const rsyncArgs = [
      '-avu',
      '--delete',
      '--modify-window=1',
      '--exclude=.vault_index.json',
      '--exclude=.DS_Store',
      normalizedVaultDir,
      targetMusicDir,
    ];

    const playlistExt = (config.playlistFormat || 'm3u').toLowerCase();
    emitSyncEvent('RSYNC', `[SYNC] Syncing vault to SD Card: ${targetMusicDir}`);
    emitSyncEvent(
      'RSYNC',
      `[RSYNC] Synchronizing audio tracks & .${playlistExt} playlists to "${targetMusicDir}"`
    );
    emitSyncEvent(
      'RSYNC',
      `[RSYNC] Executing: /usr/bin/rsync ${rsyncArgs.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}`
    );

    await new Promise((resolve, reject) => {
      const child = spawn('/usr/bin/rsync', rsyncArgs, {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          // Prevent macOS from synthesizing `._*` AppleDouble resource fork files on exFAT/FAT32 SD cards
          COPYFILE_DISABLE: '1',
        },
      });

      attachLineReader(child.stdout, (line) => {
        emitSyncEvent('RSYNC', `[RSYNC] ${line}`);
      });

      attachLineReader(child.stderr, (line) => {
        emitSyncEvent('ERROR', `[RSYNC STDERR] ${line}`);
      });

      child.on('error', (err) => {
        emitSyncEvent('ERROR', `[ERROR] Failed to spawn /usr/bin/rsync: ${err.message}`);
        reject(err);
      });

      child.on('close', (code) => {
        if (code === 0) {
          emitSyncEvent(
            'DONE',
            `[DONE] Sync to "${targetMusicDir}" finished cleanly (exit code 0).`
          );
          resolve();
        } else {
          const errMsg = `[ERROR] rsync exited with code ${code}`;
          emitSyncEvent('ERROR', errMsg);
          reject(new Error(errMsg));
        }
      });
    });
  } finally {
    isSyncing = false;
  }
}
