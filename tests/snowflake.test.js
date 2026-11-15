import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  sanitizeFolderName,
  isProtectedFolder,
  formatTrackPrefix,
  resolveSdRoot,
  syncPlaylistFolders,
  MANIFEST_FILENAME,
} from '../server/services/snowflake.js';
import { db } from '../server/db.js';

test('sanitizeFolderName: strips illegal FAT32/exFAT characters and handles collisions', () => {
  assert.equal(sanitizeFolderName('Rock/Pop: 80s* & 90s?'), 'RockPop 80s & 90s');
  assert.equal(sanitizeFolderName('Favorite "Jams" <3> | Special'), 'Favorite Jams 3  Special');
  assert.equal(sanitizeFolderName('   Trailing Dots...   '), 'Trailing Dots');
  assert.equal(sanitizeFolderName('Music'), 'Music (Playlist)');
  assert.equal(sanitizeFolderName('music'), 'Music (Playlist)');
  assert.equal(sanitizeFolderName('???///', 'DefaultPL'), 'DefaultPL');
});

test('isProtectedFolder: protects system directories, Music library, and traversal paths', () => {
  assert.equal(isProtectedFolder('Music'), true);
  assert.equal(isProtectedFolder('music'), true);
  assert.equal(isProtectedFolder('System Volume Information'), true);
  assert.equal(isProtectedFolder('.Spotlight-V100'), true);
  assert.equal(isProtectedFolder('.fseventsd'), true);
  assert.equal(isProtectedFolder('.Trashes'), true);
  assert.equal(isProtectedFolder('..'), true);
  assert.equal(isProtectedFolder('../Music'), true);
  assert.equal(isProtectedFolder(''), true);

  assert.equal(isProtectedFolder('TRON'), false);
  assert.equal(isProtectedFolder('FAVS'), false);
  assert.equal(isProtectedFolder('Nine Inch Nails'), false);
});

test('formatTrackPrefix: generates zero-padded 1-based index numbers', () => {
  // < 100 tracks: 2 digits
  assert.equal(formatTrackPrefix(0, 10), '01');
  assert.equal(formatTrackPrefix(1, 10), '02');
  assert.equal(formatTrackPrefix(9, 10), '10');

  // >= 100 tracks: 3 digits
  assert.equal(formatTrackPrefix(0, 150), '001');
  assert.equal(formatTrackPrefix(8, 150), '009');
  assert.equal(formatTrackPrefix(99, 150), '100');
});

test('resolveSdRoot: extracts the SD card root from target volume or music dir', () => {
  assert.equal(resolveSdRoot('/Volumes/SD_CARD'), '/Volumes/SD_CARD');
  assert.equal(resolveSdRoot('/Volumes/SD_CARD/Music'), '/Volumes/SD_CARD');
  assert.equal(resolveSdRoot('/Volumes/SD_CARD/Music/'), '/Volumes/SD_CARD');
});

test('syncPlaylistFolders end-to-end lifecycle', async (t) => {
  const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'av-snowflake-test-'));
  const vaultDir = path.join(tmpDir, 'vault');
  const sdRoot = path.join(tmpDir, 'sdcard');
  const sdMusicDir = path.join(sdRoot, 'Music');
  const unrelatedDir = path.join(sdRoot, 'AUDIOBOOKS');

  await fsp.mkdir(vaultDir, { recursive: true });
  await fsp.mkdir(sdMusicDir, { recursive: true });
  await fsp.mkdir(unrelatedDir, { recursive: true });

  // Create dummy audio files in vault
  const track1File = 'Track One.flac';
  const track2File = 'Track Two.flac';
  const track3File = 'Track Three.flac';

  await fsp.writeFile(path.join(vaultDir, track1File), 'AUDIO_DATA_1111');
  await fsp.writeFile(path.join(vaultDir, track2File), 'AUDIO_DATA_222222');
  await fsp.writeFile(path.join(vaultDir, track3File), 'AUDIO_DATA_33333333');

  // Also put a file inside sdMusicDir and unrelatedDir
  await fsp.writeFile(path.join(sdMusicDir, 'library_track.flac'), 'MUSIC_LIB');
  await fsp.writeFile(path.join(unrelatedDir, 'book.mp3'), 'BOOK_DATA');

  // Mock db.getVaultDir, db.getTrackByKey, and db.playlists
  const originalGetVaultDir = db.getVaultDir;
  const originalGetTrackByKey = db.getTrackByKey;
  const originalPlaylists = db.playlists;

  db.getVaultDir = () => vaultDir;
  db.getTrackByKey = (key) => {
    if (key === 'k1') return { filename: track1File, fileSize: 15 };
    if (key === 'k2') return { filename: track2File, fileSize: 17 };
    if (key === 'k3') return { filename: track3File, fileSize: 19 };
    return null;
  };

  db.playlists = {
    pl_1: {
      id: 'pl_1',
      name: 'TRON / Ares',
      trackKeys: ['k1', 'k2'],
    },
    pl_2: {
      id: 'pl_2',
      name: 'FAVS*',
      trackKeys: ['k3'],
    },
  };

  t.after(async () => {
    db.getVaultDir = originalGetVaultDir;
    db.getTrackByKey = originalGetTrackByKey;
    db.playlists = originalPlaylists;
    await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  });

  const events = [];
  const emitSyncEvent = (type, message) => {
    events.push({ type, message });
  };

  // ==========================================
  // PHASE 1: Sync with Snowflake Mode ENABLED
  // ==========================================
  await syncPlaylistFolders({
    sdRoot,
    vaultDir,
    exportPlaylistFolders: true,
    emitSyncEvent,
  });

  // Verify sanitized root folders exist
  const tronDir = path.join(sdRoot, 'TRON  Ares');
  const favsDir = path.join(sdRoot, 'FAVS');

  assert.equal(fs.existsSync(tronDir), true);
  assert.equal(fs.existsSync(favsDir), true);

  // Verify tracks inside TRON are 1-based sequential
  const tronFiles = (await fsp.readdir(tronDir)).sort();
  assert.deepEqual(tronFiles, ['01 - Track One.flac', '02 - Track Two.flac']);

  // Verify tracks inside FAVS
  const favsFiles = await fsp.readdir(favsDir);
  assert.deepEqual(favsFiles, ['01 - Track Three.flac']);

  // Verify manifest exists and lists the generated folders
  const manifestPath = path.join(sdRoot, MANIFEST_FILENAME);
  assert.equal(fs.existsSync(manifestPath), true);
  const manifestData = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  assert.deepEqual(manifestData.folders.sort(), ['FAVS', 'TRON  Ares'].sort());

  // Verify Music and unrelated folders were completely untouched
  assert.equal(fs.existsSync(path.join(sdMusicDir, 'library_track.flac')), true);
  assert.equal(fs.existsSync(path.join(unrelatedDir, 'book.mp3')), true);

  // ==========================================
  // PHASE 2: Reorder tracks in TRON & Re-sync
  // ==========================================
  // Swap k1 and k2
  db.playlists.pl_1.trackKeys = ['k2', 'k1'];

  await syncPlaylistFolders({
    sdRoot,
    vaultDir,
    exportPlaylistFolders: true,
    emitSyncEvent,
  });

  const tronFilesReordered = (await fsp.readdir(tronDir)).sort();
  assert.deepEqual(tronFilesReordered, ['01 - Track Two.flac', '02 - Track One.flac']);

  // Verify contents match the swapped files
  const file1Content = await fsp.readFile(path.join(tronDir, '01 - Track Two.flac'), 'utf8');
  assert.equal(file1Content, 'AUDIO_DATA_222222');
  const file2Content = await fsp.readFile(path.join(tronDir, '02 - Track One.flac'), 'utf8');
  assert.equal(file2Content, 'AUDIO_DATA_1111');

  // ==========================================
  // PHASE 3: Delete a playlist & Re-sync
  // ==========================================
  // Remove FAVS playlist
  delete db.playlists.pl_2;

  await syncPlaylistFolders({
    sdRoot,
    vaultDir,
    exportPlaylistFolders: true,
    emitSyncEvent,
  });

  // FAVS should be removed from SD root
  assert.equal(fs.existsSync(favsDir), false);
  // TRON should still exist
  assert.equal(fs.existsSync(tronDir), true);
  // Manifest should only contain TRON
  const manifestPhase3 = JSON.parse(await fsp.readFile(manifestPath, 'utf8'));
  assert.deepEqual(manifestPhase3.folders, ['TRON  Ares']);

  // ==========================================
  // PHASE 4: Disable Snowflake Mode & Re-sync
  // ==========================================
  await syncPlaylistFolders({
    sdRoot,
    vaultDir,
    exportPlaylistFolders: false,
    emitSyncEvent,
  });

  // TRON should now be removed from SD root
  assert.equal(fs.existsSync(tronDir), false);
  // Manifest should be removed
  assert.equal(fs.existsSync(manifestPath), false);
  // Music directory and unrelated user directory MUST remain completely intact
  assert.equal(fs.existsSync(sdMusicDir), true);
  assert.equal(fs.existsSync(path.join(sdMusicDir, 'library_track.flac')), true);
  assert.equal(fs.existsSync(unrelatedDir), true);
  assert.equal(fs.existsSync(path.join(unrelatedDir, 'book.mp3')), true);
});
