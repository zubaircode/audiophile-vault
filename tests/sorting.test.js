import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getSortArtist,
  cleanAlbumTitle,
  isCompilationRelease,
  getCompilationBadge,
  formatDiscTrackIndex,
  getSmartReleaseSortKey,
  sortTracksBySmartRelease,
  matchesTrackSearch,
} from '../client/utils/sorting.js';

test('getSortArtist strips leading "The " and accents for A-Z collation', () => {
  assert.equal(getSortArtist('The Cure'), 'Cure');
  assert.equal(getSortArtist('The Beatles'), 'Beatles');
  assert.equal(getSortArtist('The Velvet Underground'), 'Velvet Underground');
  assert.equal(getSortArtist('Sigur Rós'), 'Sigur Ros');
  assert.equal(getSortArtist('Aerosmith'), 'Aerosmith');
});

test('cleanAlbumTitle strips (Disc 1), [Disc 2], and - CD 1 suffixes', () => {
  assert.equal(cleanAlbumTitle('The Wall (Disc 1)'), 'The Wall');
  assert.equal(cleanAlbumTitle('The Wall [Disc 2]'), 'The Wall');
  assert.equal(cleanAlbumTitle('London Calling - CD 2'), 'London Calling');
  assert.equal(cleanAlbumTitle('Mellon Collie Disc 1'), 'Mellon Collie');
  assert.equal(
    cleanAlbumTitle('Pulp Fiction (Music from the Motion Picture)'),
    'Pulp Fiction (Music from the Motion Picture)'
  );
});

test('isCompilationRelease and getCompilationBadge detect VA compilations, DJ mixes, and OST soundtracks', () => {
  const ostTrack = {
    artist: 'Dick Dale',
    album: 'Pulp Fiction (Music from the Motion Picture)',
  };
  assert.equal(isCompilationRelease(ostTrack), true);
  assert.equal(getCompilationBadge(ostTrack), 'OST');

  const djMixTrack = {
    artist: '6AM Feat. Boedekka',
    album: 'A Night Out With Boy George: A DJ Mix',
  };
  assert.equal(isCompilationRelease(djMixTrack), true);
  assert.equal(getCompilationBadge(djMixTrack), 'VA');

  const vaTrack = {
    artist: 'Coolio',
    album: "Now That's What I Call Music",
    albumArtist: 'Various Artists',
  };
  assert.equal(isCompilationRelease(vaTrack), true);
  assert.equal(getCompilationBadge(vaTrack), 'VA');

  const standardTrack = {
    artist: 'Fleetwood Mac',
    album: 'Rumours',
  };
  assert.equal(isCompilationRelease(standardTrack), false);
  assert.equal(getCompilationBadge(standardTrack), null);
});

test('formatDiscTrackIndex formats D{disc} • T{trackNo} from discTrack or discNumber/trackNumber', () => {
  assert.deepEqual(formatDiscTrackIndex({ discTrack: '104' }), {
    disc: 1,
    trackNo: '04',
    formatted: 'D1 • T04',
  });
  assert.deepEqual(
    formatDiscTrackIndex({ discNumber: 2, trackNumber: 12 }),
    {
      disc: 2,
      trackNo: '12',
      formatted: 'D2 • T12',
    }
  );
});

test('getSmartReleaseSortKey prevents homonym collisions, unifies multi-disc sets, and groups compilations by album title', () => {
  // 1. Multi-disc album unification: "(Disc 1)" and "[Disc 2]" produce identical releaseId and order D1 -> D2
  const wallD2T1 = {
    artist: 'Pink Floyd',
    album: 'The Wall [Disc 2]',
    discNumber: 2,
    trackNumber: 1,
    title: 'Hey You',
  };
  const wallD1T2 = {
    artist: 'Pink Floyd',
    album: 'The Wall (Disc 1)',
    discNumber: 1,
    trackNumber: 2,
    title: 'The Thin Ice',
  };
  const wallD1T1 = {
    artist: 'Pink Floyd',
    album: 'The Wall (Disc 1)',
    discNumber: 1,
    trackNumber: 1,
    title: 'In the Flesh?',
  };

  // 2. Homonym releases ("Greatest Hits" by Queen vs. Tom Petty) must never interleave
  const queenGH2 = {
    artist: 'Queen',
    album: 'Greatest Hits',
    discNumber: 1,
    trackNumber: 2,
    title: 'Another One Bites the Dust',
  };
  const pettyGH1 = {
    artist: 'Tom Petty',
    album: 'Greatest Hits',
    discNumber: 1,
    trackNumber: 1,
    title: 'American Girl',
  };
  const queenGH1 = {
    artist: 'Queen',
    album: 'Greatest Hits',
    discNumber: 1,
    trackNumber: 1,
    title: 'Bohemian Rhapsody',
  };

  // 3. Compilation tracks by different performers stay contiguous under the album title
  const pulpT8 = {
    artist: 'Urge Overkill',
    album: 'Pulp Fiction (Music from the Motion Picture)',
    discNumber: 1,
    trackNumber: 8,
    title: 'Girl, You’ll Be a Woman Soon',
  };
  const pulpT1 = {
    artist: 'Dick Dale',
    album: 'Pulp Fiction (Music from the Motion Picture)',
    discNumber: 1,
    trackNumber: 1,
    title: 'Misirlou',
  };

  const sorted = sortTracksBySmartRelease(
    [wallD2T1, queenGH2, pulpT8, pettyGH1, wallD1T2, pulpT1, queenGH1, wallD1T1],
    'asc'
  );

  assert.deepEqual(
    sorted.map((t) => `${cleanAlbumTitle(t.album)}:${t.artist}:D${t.discNumber}T${t.trackNumber}`),
    [
      'The Wall:Pink Floyd:D1T1',
      'The Wall:Pink Floyd:D1T2',
      'The Wall:Pink Floyd:D2T1',
      'Pulp Fiction (Music from the Motion Picture):Dick Dale:D1T1',
      'Pulp Fiction (Music from the Motion Picture):Urge Overkill:D1T8',
      'Greatest Hits:Queen:D1T1',
      'Greatest Hits:Queen:D1T2',
      'Greatest Hits:Tom Petty:D1T1',
    ]
  );
});

test('matchesTrackSearch supports artist, clean album, formatted D1 • T04, and [OST]/[VA] badges', () => {
  const track = {
    artist: 'Massive Attack ft. Horace Andy',
    album: 'Mezzanine (Disc 1)',
    discTrack: '104',
    title: 'Angel',
  };

  assert.equal(matchesTrackSearch(track, 'Massive Attack'), true);
  assert.equal(matchesTrackSearch(track, 'Horace Andy'), true);
  assert.equal(matchesTrackSearch(track, 'Mezzanine'), true);
  assert.equal(matchesTrackSearch(track, 'D1 • T04'), true);
});
