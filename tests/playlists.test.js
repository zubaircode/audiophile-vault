import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveRelativeTrackPath,
  buildM3u8Content,
  writePlaylistM3u8,
  getPlaylistFilename,
} from '../server/playlists.js';
import { db } from '../server/db.js';

test('resolveRelativeTrackPath: enforces forward slashes, zero leading slashes, and relative resolution', () => {
  // Scenario 1: Direct siblings in the same directory
  const sibling = resolveRelativeTrackPath(
    '/Volumes/SD/Music',
    'Queen - Greatest Hits - 101 - Bohemian Rhapsody.m4a',
    '/Volumes/SD/Music'
  );
  assert.equal(sibling, 'Queen - Greatest Hits - 101 - Bohemian Rhapsody.m4a');
  assert.ok(!sibling.startsWith('/'), 'Must not start with leading slash');
  assert.ok(!sibling.startsWith('./'), 'Must not start with ./');

  // Scenario 2: Playlist in root /Volumes/SD and audio in /Volumes/SD/Music
  const fromRoot = resolveRelativeTrackPath(
    '/Volumes/SD',
    'Queen - Bohemian Rhapsody.m4a',
    '/Volumes/SD/Music'
  );
  assert.equal(fromRoot, 'Music/Queen - Bohemian Rhapsody.m4a');
  assert.ok(!fromRoot.startsWith('/'));

  // Scenario 3: Playlist in /Volumes/SD/Playlists and audio in /Volumes/SD/Music
  const fromPlaylistsSubdir = resolveRelativeTrackPath(
    '/Volumes/SD/Playlists',
    'Queen - Bohemian Rhapsody.m4a',
    '/Volumes/SD/Music'
  );
  assert.equal(fromPlaylistsSubdir, '../Music/Queen - Bohemian Rhapsody.m4a');
  assert.ok(!fromPlaylistsSubdir.startsWith('/'));
  assert.ok(fromPlaylistsSubdir.includes('/'));

  // Scenario 4: Absolute path given as trackFilenameOrPath
  const fromAbsPath = resolveRelativeTrackPath(
    '/Volumes/SD/Playlists',
    '/Volumes/SD/Music/Rock/Queen - Bohemian Rhapsody.m4a',
    '/Volumes/SD/Music'
  );
  assert.equal(fromAbsPath, '../Music/Rock/Queen - Bohemian Rhapsody.m4a');
  assert.ok(!fromAbsPath.startsWith('/'));
});

test('buildM3u8Content: universal CRLF line endings, structure, and UTF-8 encoding without BOM', () => {
  // Mock track retrieval
  const originalGetTrackByKey = db.getTrackByKey;
  db.getTrackByKey = (key) => {
    if (key === 'track_1') {
      return {
        trackKey: 'track_1',
        filename: 'Queen - Greatest Hits - 101 - Bohemian Rhapsody.m4a',
        artist: 'Queen',
        title: 'Bohemian Rhapsody',
      };
    }
    if (key === 'track_2') {
      return {
        trackKey: 'track_2',
        filename: 'Daft Punk - Discovery - 101 - One More Time.flac',
        artist: 'Daft Punk',
        title: 'One More Time',
      };
    }
    return null;
  };

  try {
    const playlist = {
      name: 'Road Trip',
      trackKeys: ['track_1', 'track_2'],
    };

    const content = buildM3u8Content(playlist, {
      targetPlaylistDir: '/Volumes/SD/Music',
      audioDir: '/Volumes/SD/Music',
    });

    // 1. CRLF verification
    assert.ok(content.includes('\r\n'), 'Must contain CRLF line endings');
    // Ensure there are no naked \n without preceding \r
    const nakedLf = content.replace(/\r\n/g, '').includes('\n');
    assert.equal(nakedLf, false, 'Must not contain any naked LF line endings');

    // 2. Line-by-line structure verification
    const lines = content.split('\r\n');
    // split by \r\n will produce an empty string at the end because of trailing \r\n
    assert.equal(lines[0], '#EXTM3U');
    assert.equal(lines[1], '#EXTINF:-1,Queen - Bohemian Rhapsody');
    assert.equal(lines[2], 'Queen - Greatest Hits - 101 - Bohemian Rhapsody.m4a');
    assert.equal(lines[3], '#EXTINF:-1,Daft Punk - One More Time');
    assert.equal(lines[4], 'Daft Punk - Discovery - 101 - One More Time.flac');
    assert.equal(lines[5], '');

    // 3. UTF-8 without BOM verification
    const buffer = Buffer.from(content, 'utf8');
    const hasBom =
      buffer.length >= 3 &&
      buffer[0] === 0xef &&
      buffer[1] === 0xbb &&
      buffer[2] === 0xbf;
    assert.equal(hasBom, false, 'Must not contain UTF-8 Byte Order Mark (BOM)');
  } finally {
    db.getTrackByKey = originalGetTrackByKey;
  }
});

test('writePlaylistM3u8: writes universal .m3u and cleans up legacy .m3u8 files', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av-m3u-test-'));

  const originalGetTrackByKey = db.getTrackByKey;
  db.getTrackByKey = () => ({
    filename: 'Test Artist - 01 - Test Song.flac',
    artist: 'Test Artist',
    title: 'Test Song',
  });

  try {
    const playlist = {
      name: 'Favorites',
      trackKeys: ['k1'],
    };

    const m3uFile = path.join(tmpDir, 'Favorites.m3u');
    const m3u8File = path.join(tmpDir, 'Favorites.m3u8');

    // Simulate a legacy .m3u8 file present on disk
    fs.writeFileSync(m3u8File, '#EXTM3U\r\n', 'utf8');
    assert.ok(fs.existsSync(m3u8File), 'Legacy .m3u8 exists prior to write');

    writePlaylistM3u8(playlist, {
      targetPlaylistDir: tmpDir,
      audioDir: tmpDir,
    });

    assert.ok(fs.existsSync(m3uFile), 'Primary .m3u file must exist');
    assert.ok(!fs.existsSync(m3u8File), 'Legacy .m3u8 file must be cleaned up');

    const m3uBytes = fs.readFileSync(m3uFile);
    // Check no BOM
    assert.notEqual(m3uBytes[0], 0xef);
    // Check CRLF
    const text = m3uBytes.toString('utf8');
    assert.ok(text.includes('\r\n'));
    assert.ok(!text.replace(/\r\n/g, '').includes('\n'));
    assert.ok(!text.replace(/\r\n/g, '').includes('\r'));
  } finally {
    db.getTrackByKey = originalGetTrackByKey;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
