import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isSafeExternalVolume } from '../server/services/volume.js';
import { HARDENED_PATH, getHardenedEnv } from '../server/config.js';

const execFileAsync = promisify(execFile);

test('HARDENED_PATH contains essential system binary paths', () => {
  assert.ok(HARDENED_PATH.includes('/opt/homebrew/bin'));
  assert.ok(HARDENED_PATH.includes('/usr/local/bin'));
  assert.ok(HARDENED_PATH.includes('/usr/bin'));
  assert.ok(HARDENED_PATH.includes('/bin'));
  assert.ok(HARDENED_PATH.includes('/usr/sbin'));
  assert.ok(HARDENED_PATH.includes('/sbin'));

  const env = getHardenedEnv({ TEST_VAR: '123' });
  assert.equal(env.TEST_VAR, '123');
  assert.equal(env.PATH, HARDENED_PATH);
});

test('Bundled ffmpeg executes reliably without Homebrew on PATH', async () => {
  const ffmpegPath = path.resolve('resources/bin/ffmpeg');
  assert.ok(fs.existsSync(ffmpegPath), 'resources/bin/ffmpeg must exist');

  // Completely stripped PATH without /opt/homebrew or /usr/local
  const { stdout } = await execFileAsync(ffmpegPath, ['-version'], {
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
  });
  assert.ok(stdout.includes('ffmpeg version'), 'ffmpeg should report version');
});

test('Bundled metaflac executes reliably without Homebrew on PATH', async () => {
  const metaflacPath = path.resolve('resources/bin/metaflac');
  assert.ok(fs.existsSync(metaflacPath), 'resources/bin/metaflac must exist');

  // Stripped PATH without /opt/homebrew or /usr/local
  const { stdout } = await execFileAsync(metaflacPath, ['--version'], {
    env: { PATH: '/usr/bin:/bin:/usr/sbin:/sbin' },
  });
  assert.ok(stdout.includes('metaflac'), 'metaflac should report version');
});

test('Volume safety dynamically resolves /Volumes/{Name} and blocks system paths', async () => {
  const rootCheck = await isSafeExternalVolume('/');
  assert.equal(rootCheck.safe, false);

  const sysCheck = await isSafeExternalVolume('/Volumes/Macintosh HD');
  assert.equal(sysCheck.safe, false);

  const emptyCheck = await isSafeExternalVolume('');
  assert.equal(emptyCheck.safe, false);
});
