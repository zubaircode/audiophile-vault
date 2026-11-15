import test from 'node:test';
import assert from 'node:assert/strict';
import { db, isSnowskyVolumePath } from '../server/db.js';

test('isSnowskyVolumePath detects SNOWSKY volume names case-insensitively', () => {
  assert.equal(isSnowskyVolumePath('/Volumes/SD SNOWSKY'), true);
  assert.equal(isSnowskyVolumePath('/Volumes/SD SNOWSKY/Music'), true);
  assert.equal(isSnowskyVolumePath('/Volumes/my_snowsky_card/Music/'), true);
  assert.equal(isSnowskyVolumePath('/Volumes/SD MUSIC'), false);
  assert.equal(isSnowskyVolumePath('/Volumes/SD MUSIC/Music'), false);
  assert.equal(isSnowskyVolumePath(''), false);
});

test('db.updateConfig auto-detects SNOWSKY volume and supports manual override', () => {
  const prevConfig = db.getConfig();

  try {
    // 1. Switching to a SNOWSKY volume auto-enables Snowsky Mode
    const snowskyCfg = db.updateConfig({ sdCardPath: '/Volumes/SD SNOWSKY/Music' });
    assert.equal(snowskyCfg.exportPlaylistFolders, true);

    // 2. Manual override off on the same SNOWSKY volume
    const overriddenOff = db.updateConfig({ exportPlaylistFolders: false });
    assert.equal(overriddenOff.exportPlaylistFolders, false);

    // 3. Updating unrelated settings while keeping the same volume preserves manual override
    const sameVolCfg = db.updateConfig({ sdCardPath: '/Volumes/SD SNOWSKY/Music' });
    assert.equal(sameVolCfg.exportPlaylistFolders, false);

    // 4. Switching to a different SNOWSKY volume re-applies auto-detect
    const anotherSnowsky = db.updateConfig({ sdCardPath: '/Volumes/SNOWSKY 2/Music' });
    assert.equal(anotherSnowsky.exportPlaylistFolders, true);

    // 5. Switching to a non-SNOWSKY volume auto-disables Snowsky Mode
    const nonSnowskyCfg = db.updateConfig({ sdCardPath: '/Volumes/SD MUSIC/Music' });
    assert.equal(nonSnowskyCfg.exportPlaylistFolders, false);

    // 6. Manual override on non-SNOWSKY volume
    const overriddenOn = db.updateConfig({ exportPlaylistFolders: true });
    assert.equal(overriddenOn.exportPlaylistFolders, true);
  } finally {
    // Restore original config
    db.updateConfig({
      sdCardPath: prevConfig.sdCardPath,
      exportPlaylistFolders: prevConfig.exportPlaylistFolders,
    });
  }
});
