/**
 * Smart Release Grouping, Compilation Unification, and Collation Engine
 * for Audiophile Vault (AV).
 */

const COLLATOR_OPTIONS = {
  sensitivity: 'base',
  numeric: true,
};

const GENERIC_ALBUM_TITLES = new Set([
  '',
  'unknown album',
  'unknown',
  'greatest hits',
  'the greatest hits',
  'best of',
  'the best of',
  'the very best of',
  'live',
  'unplugged',
  'anthology',
  'collection',
  'platinum & gold collection',
  '20th century masters',
]);

const COMPILATION_ARTIST_REGEX =
  /^(various(\s+artists)?|soundtrack|original\s+soundtrack|motion\s+picture\s+soundtrack|v\/a|va|v\.a\.|ost)$/i;

const COMPILATION_ALBUM_REGEX =
  /music from the motion picture|original soundtrack|\bost\b|dj mix|compiled by|excursions in ambience|a collection of/i;

const SOUNDTRACK_REGEX =
  /music from the motion picture|original soundtrack|\bost\b|soundtrack/i;

/**
 * Strips guest feature credits from a track artist string so tracks with
 * "Artist feat. Guest" stay anchored to the primary release artist when `albumArtist` is absent.
 *
 * @param {string} rawArtist
 * @returns {string}
 */
export function stripFeaturingCredits(rawArtist = '') {
  if (!rawArtist || typeof rawArtist !== 'string') return '';
  return rawArtist
    .replace(/\s*[\(\[](?:feat\.?|ft\.?|featuring|with)\s+[^)\]]+[\)\]]/gi, '')
    .replace(/\s+\b(?:feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes artist string by stripping leading 'The ' for A-Z collation
 * and folding diacritics/accents.
 *
 * @param {string} artist
 * @returns {string}
 */
export function getSortArtist(artist = '') {
  const raw = String(artist ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();

  if (!raw) return 'Unknown Artist';

  const stripped = raw.replace(/^the\s+/i, '').trim();
  return stripped || raw;
}

/**
 * Alias for `getSortArtist` for compatibility.
 */
export function getSortArtistKey(artist = '') {
  return getSortArtist(artist);
}

/**
 * Strips disc suffixes, edition tags, and trailing disc indicators from album titles
 * so multi-disc sets like "(Disc 1)" and "[Disc 2]" unify under one cohesive release.
 *
 * @param {string} album
 * @returns {string}
 */
export function cleanAlbumTitle(album = '') {
  const cleaned = String(album ?? '')
    .replace(/\s+[-–—:]\s*(?:disc|cd|disk)\s*\d+\b.*$/i, '')
    .replace(/\s*[\(\[](?:disc|cd|disk)\s*\d+[^)\]]*[\)\]]/gi, '')
    .replace(/\s*[\(\[]?(?:disc|cd|disk)\s*\d+[\)\]]?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned || 'Unknown Album';
}

/**
 * Lowercased version of `cleanAlbumTitle` for key comparisons.
 *
 * @param {string} rawAlbum
 * @returns {string}
 */
export function normalizeAlbumTitle(rawAlbum = '') {
  return cleanAlbumTitle(rawAlbum).toLowerCase();
}

/**
 * Determines if a track belongs to a compilation, soundtrack, or DJ mix.
 *
 * @param {object} track
 * @returns {boolean}
 */
export function isCompilationRelease(track) {
  if (!track || typeof track !== 'object') return false;
  if (
    track.compilation === true ||
    Boolean(track.isCompilation) ||
    Number(track.itunescompilation) === 1
  ) {
    return true;
  }

  const albumArtist = String(track.albumArtist || '').trim().toLowerCase();
  const artist = String(track.artist || '').trim().toLowerCase();
  const album = String(track.album || '').trim().toLowerCase();

  if (albumArtist && COMPILATION_ARTIST_REGEX.test(albumArtist)) return true;
  if (artist && COMPILATION_ARTIST_REGEX.test(artist)) return true;
  if (album && COMPILATION_ALBUM_REGEX.test(album)) return true;

  return false;
}

/**
 * Returns the badge label (`"OST"` or `"VA"`) for a compilation/soundtrack track, or `null` for standard releases.
 *
 * @param {object} track
 * @returns {'OST'|'VA'|null}
 */
export function getCompilationBadge(track) {
  if (!isCompilationRelease(track)) return null;
  const combined = `${track?.album || ''} ${track?.albumArtist || ''}`;
  if (SOUNDTRACK_REGEX.test(combined)) {
    return 'OST';
  }
  return 'VA';
}

/**
 * Resolves the effective Album Artist for a track.
 *
 * @param {object} track
 * @returns {string}
 */
export function getEffectiveAlbumArtist(track) {
  if (!track || typeof track !== 'object') return 'Unknown Artist';
  if (isCompilationRelease(track)) {
    return 'Various Artists';
  }
  const rawAlbumArtist = String(track.albumArtist || '').trim();
  if (rawAlbumArtist) return rawAlbumArtist;

  const rawTrackArtist = String(track.artist || '').trim();
  if (rawTrackArtist) {
    return stripFeaturingCredits(rawTrackArtist) || rawTrackArtist;
  }

  return 'Unknown Artist';
}

/**
 * Extracts a numeric disc number from a track (`discNumber`, `disc`, `discNo`, or `discTrack` hundreds digit).
 *
 * @param {object} track
 * @returns {number}
 */
export function resolveDiscNumber(track) {
  if (!track || typeof track !== 'object') return 1;
  if (
    track.discNumber !== undefined &&
    track.discNumber !== null &&
    String(track.discNumber).trim() !== ''
  ) {
    const n = Number(track.discNumber);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  if (
    track.disc !== undefined &&
    track.disc !== null &&
    String(track.disc).trim() !== ''
  ) {
    const n = Number(track.disc);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  if (
    track.discNo !== undefined &&
    track.discNo !== null &&
    String(track.discNo).trim() !== ''
  ) {
    const n = Number(track.discNo);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }
  if (track.discTrack && /^\d{3,}$/.test(String(track.discTrack).trim())) {
    const discPart = Math.floor(Number(track.discTrack) / 100);
    if (discPart > 0) return discPart;
  }
  return 1;
}

/**
 * Extracts the 2-digit display track number within a disc (e.g. "04" from `trackNumber: 4` or `discTrack: "104"`).
 *
 * @param {object} track
 * @returns {string}
 */
export function resolveDisplayTrackNumber(track) {
  if (!track || typeof track !== 'object') return '01';
  if (
    track.trackNumber !== undefined &&
    track.trackNumber !== null &&
    String(track.trackNumber).trim() !== ''
  ) {
    const n = Number(track.trackNumber);
    if (Number.isFinite(n) && n > 0) return String(n).padStart(2, '0');
    return String(track.trackNumber).trim().padStart(2, '0');
  }
  if (
    track.trackNo !== undefined &&
    track.trackNo !== null &&
    String(track.trackNo).trim() !== ''
  ) {
    const n = Number(track.trackNo);
    if (Number.isFinite(n) && n > 0) return String(n).padStart(2, '0');
    return String(track.trackNo).trim().padStart(2, '0');
  }
  if (track.discTrack !== undefined && track.discTrack !== null) {
    const raw = String(track.discTrack).trim();
    if (/^\d{3,}$/.test(raw)) {
      const trk = Number(raw) % 100;
      return String(trk > 0 ? trk : 1).padStart(2, '0');
    }
    if (/^\d+$/.test(raw)) {
      return raw.padStart(2, '0');
    }
  }
  return '01';
}

/**
 * Formats the disc/track index for display in Column 2 (`D{disc} • T{trackNo}`).
 *
 * @param {object} track
 * @returns {{ disc: number, trackNo: string, formatted: string }}
 */
export function formatDiscTrackIndex(track) {
  const disc = resolveDiscNumber(track);
  const trackNo = resolveDisplayTrackNumber(track);
  return {
    disc,
    trackNo,
    formatted: `D${disc} • T${trackNo}`,
  };
}

/**
 * Produces a deterministic compound key that:
 * 1. Groups by Release Entity (preventing homonym collisions like two artists' "Greatest Hits")
 * 2. Unifies multi-artist compilations together under their clean album title
 * 3. Collates leading "The" properly
 * 4. Preserves Disc and Track sequence within each album
 *
 * @param {object} track
 * @returns {string}
 */
export function getSmartReleaseSortKey(track) {
  const isComp = isCompilationRelease(track);
  const cleanAlbum = cleanAlbumTitle(track?.album || 'Unknown Album').toLowerCase();

  // 1. Anchor Group:
  // For compilations: anchor by clean album name so all tracks stay together under the album title
  // For regular albums: anchor by Album Artist (or guest-stripped Track Artist) stripped of 'The '
  const rawRegularArtist =
    (track?.albumArtist && String(track.albumArtist).trim()) ||
    stripFeaturingCredits(track?.artist || '') ||
    track?.artist ||
    'Unknown Artist';

  const anchorArtist = isComp
    ? '__compilation__'
    : getSortArtist(rawRegularArtist).toLowerCase();

  // 2. Disambiguator: Ensure different artists with identically named albums ("Greatest Hits") never collide
  const releaseId = `${anchorArtist}:::${cleanAlbum}`;

  // 3. Sequence within the release
  const disc = String(resolveDiscNumber(track)).padStart(2, '0');
  const trackNo = String(
    track?.trackNumber || track?.trackNo || track?.discTrack || 1
  )
    .trim()
    .padStart(4, '0');

  // Master Collation Key
  // When sorted by Release: Compilations group by album title; regular artists group by artist then album
  const primaryBucket = isComp ? cleanAlbum : `${anchorArtist}|${cleanAlbum}`;
  return `${primaryBucket}|${releaseId}|${disc}|${trackNo}`;
}

/**
 * Legacy/compatibility sort key helpers.
 */
export function getAlbumGroupSortKey(track) {
  const effectiveArtist = getEffectiveAlbumArtist(track);
  const sortArtist = getSortArtistKey(effectiveArtist);
  const albumTitle = normalizeAlbumTitle(track?.album || 'Unknown Album');
  const disc = String(resolveDiscNumber(track)).trim().padStart(3, '0');
  const trackNo = String(
    track?.trackNumber || track?.trackNo || track?.discTrack || 1
  )
    .trim()
    .padStart(4, '0');

  return `${sortArtist}|${albumTitle}|${disc}|${trackNo}`;
}

export function getCompositeSortKey(track) {
  return getSmartReleaseSortKey(track);
}

/**
 * Detects multi-artist compilation cohorts across a track list while protecting homonym
 * albums by different artists (e.g., two different bands having an album titled "Greatest Hits" or "Blue").
 *
 * A shared non-generic album title across >= 2 artists is marked as a compilation cohort if:
 * - Any track in the album cohort is already flagged by `isCompilationRelease(t)`, OR
 * - The tracks across the different artists form a non-overlapping disc/track sequence
 *   (no duplicate `D{disc}T{trackNo}` slot shared by two different artists).
 *
 * @param {Array<object>} tracks
 * @returns {Array<object>}
 */
export function annotateCompilationCohorts(tracks) {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];

  const cohortsByAlbum = new Map();

  for (const t of tracks) {
    if (!t) continue;
    const cleanAlbum = cleanAlbumTitle(t.album || '').toLowerCase();
    if (cleanAlbum.length < 3 || GENERIC_ALBUM_TITLES.has(cleanAlbum)) continue;

    let cohort = cohortsByAlbum.get(cleanAlbum);
    if (!cohort) {
      cohort = {
        artists: new Set(),
        slotArtists: new Map(), // "disc:track" -> Set of artists
        hasExplicitComp: false,
      };
      cohortsByAlbum.set(cleanAlbum, cohort);
    }

    if (isCompilationRelease(t)) {
      cohort.hasExplicitComp = true;
    }

    const baseArtist = getSortArtist(
      (t.albumArtist && String(t.albumArtist).trim()) ||
        stripFeaturingCredits(t.artist || '') ||
        t.artist ||
        'Unknown Artist'
    ).toLowerCase();
    cohort.artists.add(baseArtist);

    const slotKey = `${resolveDiscNumber(t)}:${resolveDisplayTrackNumber(t)}`;
    let slotSet = cohort.slotArtists.get(slotKey);
    if (!slotSet) {
      slotSet = new Set();
      cohort.slotArtists.set(slotKey, slotSet);
    }
    slotSet.add(baseArtist);
  }

  const compilationAlbums = new Set();
  for (const [cleanAlbum, cohort] of cohortsByAlbum.entries()) {
    if (cohort.artists.size < 2) continue;

    if (cohort.hasExplicitComp) {
      compilationAlbums.add(cleanAlbum);
      continue;
    }

    // Check if two different artists share the exact same disc+track slot (homonym collision like two "Blue" albums)
    let hasSlotCollision = false;
    for (const slotSet of cohort.slotArtists.values()) {
      if (slotSet.size > 1) {
        hasSlotCollision = true;
        break;
      }
    }

    if (!hasSlotCollision) {
      compilationAlbums.add(cleanAlbum);
    }
  }

  if (compilationAlbums.size === 0) {
    return tracks;
  }

  return tracks.map((t) => {
    if (!t || t.compilation === true || t.isCompilation === true) return t;
    const cleanAlbum = cleanAlbumTitle(t.album || '').toLowerCase();
    if (compilationAlbums.has(cleanAlbum) && !t.albumArtist) {
      return {
        ...t,
        isCompilation: true,
      };
    }
    return t;
  });
}

/**
 * Comparator for sorting tracks by `getSmartReleaseSortKey`:
 * 1. Primary collation bucket (Compilations by clean album title; regular releases by article-stripped artist + clean album)
 * 2. Release ID disambiguator (`${anchorArtist}:::${cleanAlbum}`)
 * 3. Disc number (`01`, `02`, ...)
 * 4. Track number (`0001`, `0002`, ...)
 * 5. Track title tie-breaker
 *
 * @param {object} trackA
 * @param {object} trackB
 * @returns {number}
 */
export function compareTracksBySmartRelease(trackA, trackB) {
  const keyA = getSmartReleaseSortKey(trackA);
  const keyB = getSmartReleaseSortKey(trackB);
  const cmp = keyA.localeCompare(keyB, undefined, COLLATOR_OPTIONS);
  if (cmp !== 0) return cmp;

  const titleA = String(trackA?.title || '').trim();
  const titleB = String(trackB?.title || '').trim();
  return titleA.localeCompare(titleB, undefined, COLLATOR_OPTIONS);
}

/**
 * Alias for `compareTracksBySmartRelease`.
 */
export function compareTracksByCompositeKey(trackA, trackB) {
  return compareTracksBySmartRelease(trackA, trackB);
}

/**
 * Comparator for sorting by the Performer / Artist column (Column 3):
 * Sorts by article-stripped `track.artist` first, then falls back to `getSmartReleaseSortKey(track)`
 * so each artist's releases and tracks stay ordered.
 *
 * @param {object} trackA
 * @param {object} trackB
 * @returns {number}
 */
export function compareTracksByPerformer(trackA, trackB) {
  const perfA = getSortArtist(trackA?.artist || 'Unknown Artist');
  const perfB = getSortArtist(trackB?.artist || 'Unknown Artist');
  const cmp = perfA.localeCompare(perfB, undefined, COLLATOR_OPTIONS);
  if (cmp !== 0) return cmp;
  return compareTracksBySmartRelease(trackA, trackB);
}

/**
 * Sorts an array of tracks using the Smart Release Sort Key after unifying multi-artist compilation cohorts.
 *
 * @param {Array<object>} tracks
 * @param {'asc'|'desc'} [direction='asc']
 * @returns {Array<object>}
 */
export function sortTracksBySmartRelease(tracks, direction = 'asc') {
  if (!Array.isArray(tracks)) return [];
  const enriched = annotateCompilationCohorts(tracks);
  const factor = direction === 'desc' ? -1 : 1;
  return [...enriched].sort((a, b) => factor * compareTracksBySmartRelease(a, b));
}

/**
 * Alias for `sortTracksBySmartRelease`.
 */
export function sortTracksByCompositeKey(tracks, direction = 'asc') {
  return sortTracksBySmartRelease(tracks, direction);
}

/**
 * Tolerant search matcher across Track Artist, Album Artist, article-stripped Artist,
 * Clean Album Title, Raw Album Title, Song Title, Filename, and Disc/Track badge (`D1 • T04` or `104`).
 *
 * @param {object} track
 * @param {string} rawQuery
 * @returns {boolean}
 */
export function matchesTrackSearch(track, rawQuery) {
  if (!rawQuery || typeof rawQuery !== 'string') return true;
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  const qWithoutThe = q.replace(/^the\s+/i, '').trim();

  const artistRaw = String(track?.artist || '').toLowerCase();
  const albumArtistRaw = String(track?.albumArtist || '').toLowerCase();
  const artistSort = getSortArtist(track?.artist || '').toLowerCase();
  const albumRaw = String(track?.album || '').toLowerCase();
  const albumClean = cleanAlbumTitle(track?.album || '').toLowerCase();
  const titleRaw = String(track?.title || '').toLowerCase();
  const filenameRaw = String(track?.filename || '').toLowerCase();
  const discTrackRaw = String(track?.discTrack || '').toLowerCase();
  const { formatted: dtFormatted } = formatDiscTrackIndex(track);
  const dtFormattedLower = dtFormatted.toLowerCase();
  const badge = (getCompilationBadge(track) || '').toLowerCase();

  if (
    artistRaw.includes(q) ||
    albumArtistRaw.includes(q) ||
    artistSort.includes(q) ||
    albumRaw.includes(q) ||
    albumClean.includes(q) ||
    titleRaw.includes(q) ||
    filenameRaw.includes(q) ||
    discTrackRaw.includes(q) ||
    dtFormattedLower.includes(q) ||
    (badge && (`[${badge}]` === q || badge === q))
  ) {
    return true;
  }

  if (
    qWithoutThe &&
    (artistSort.includes(qWithoutThe) || artistRaw.includes(qWithoutThe))
  ) {
    return true;
  }

  return false;
}
