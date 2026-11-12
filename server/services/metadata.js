import path from 'node:path';
import { parseFile } from 'music-metadata';

export const SUPPORTED_EXTENSIONS = new Set([
  '.mp3',
  '.m4a',
  '.flac',
  '.alac',
  '.wav',
  '.aiff',
  '.aac',
  '.ogg',
]);

export const DRM_EXTENSIONS = new Set(['.m4p']);

/**
 * Sanitizes illegal filesystem characters (/ \ : * ? " < > |) and control chars into clean hyphens.
 */
export function sanitizeSegment(input, fallback = 'Unknown') {
  if (!input || typeof input !== 'string') return fallback;
  const cleaned = input
    .replace(/[/\\:*?"<>|\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[\s.-]+|[\s.-]+$/g, '')
    .trim();
  return cleaned || fallback;
}

/**
 * Normalizes a metadata string for deterministic deduplication keys:
 * "{artist}|{album}|{discTrack}|{title}"
 */
export function buildNormalizedKey(artist, album, discTrack, title) {
  let resolvedDiscTrack = discTrack;
  let resolvedTitle = title;
  if (title === undefined) {
    resolvedDiscTrack = '101';
    resolvedTitle = discTrack;
  }

  const clean = (str = '') =>
    String(str || '')
      .toLowerCase()
      .replace(/[’']/g, "'")
      .replace(/\s+/g, ' ')
      .trim();

  const paddedTrack = String(resolvedDiscTrack || '101').padStart(3, '0');
  return `${clean(artist)}|${clean(album)}|${paddedTrack}|${clean(resolvedTitle)}`;
}

/**
 * Extracts audio metadata via music-metadata, checks for DRM protection,
 * and formats the Full Archive Standard filename:
 * `{Artist} - {Album} - {DiscTrack} - {Title}.{ext}`
 */
export async function extractTrackMetadata(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const rawBasename = path.basename(filePath, path.extname(filePath));

  // 1. Immediate extension-based DRM check (.m4p FairPlay)
  if (DRM_EXTENSIONS.has(ext)) {
    return {
      isDrmProtected: true,
      drmReason: 'Apple FairPlay protected container (.m4p)',
    };
  }

  let metadata;
  try {
    metadata = await Promise.race([
      parseFile(filePath, {
        duration: true,
        skipCovers: true,
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Metadata parse timeout')), 8000)
      ),
    ]);
  } catch (err) {
    // If metadata parsing fails or times out on a corrupt/unreadable header, fall back gracefully
    metadata = { common: {}, format: {} };
  }

  const { common = {}, format = {} } = metadata;

  // 2. Inspect container/codec flags for DRM or encryption
  const containerStr = `${format.container || ''} ${format.codec || ''} ${format.tagTypes?.join(' ') || ''}`.toLowerCase();
  if (
    format.encrypted === true ||
    containerStr.includes('drms') ||
    containerStr.includes('fairplay') ||
    containerStr.includes('protected')
  ) {
    return {
      isDrmProtected: true,
      drmReason: `Encrypted / DRM-flagged stream (${format.codec || format.container || 'unknown'})`,
    };
  }

  // 3. Metadata Fallback Hierarchy per specification:
  // Artist: common.albumartist -> fallback common.artist -> fallback "Unknown Artist"
  const rawAlbumArtist =
    (common.albumartist && common.albumartist.trim()) || null;
  const rawTrackArtist =
    (common.artist && common.artist.trim()) || null;
  const rawArtist = rawAlbumArtist || rawTrackArtist || 'Unknown Artist';

  // Album: common.album -> fallback "Unknown Album"
  const rawAlbum = (common.album && common.album.trim()) || 'Unknown Album';

  // Title: common.title -> fallback raw filename without extension
  const rawTitle = (common.title && common.title.trim()) || rawBasename || 'Unknown Title';

  // Track No: common.track.no (padded to 2 digits, default "01")
  const trackNum =
    typeof common.track?.no === 'number' && common.track.no > 0 ? common.track.no : 1;
  const paddedTrack = String(trackNum).padStart(2, '0');

  // Disc No: common.disk.no (default 1)
  const discNum =
    typeof common.disk?.no === 'number' && common.disk.no > 0 ? common.disk.no : 1;

  // Combined DiscTrack Code: {Disc}{TrackNo} (e.g., Disc 1 Track 3 -> "103", Disc 2 Track 12 -> "212")
  const discTrack = `${discNum}${paddedTrack}`;

  // Sanitize segments for Full Archive Standard naming
  const safeArtist = sanitizeSegment(rawArtist, 'Unknown Artist');
  const safeAlbum = sanitizeSegment(rawAlbum, 'Unknown Album');
  const safeTitle = sanitizeSegment(rawTitle, sanitizeSegment(rawBasename, 'Unknown Title'));
  const cleanExt = ext.replace(/^\./, '');

  const archiveFilename = `${safeArtist} - ${safeAlbum} - ${discTrack} - ${safeTitle}.${cleanExt}`;
  const normalizedKey = buildNormalizedKey(rawArtist, rawAlbum, discTrack, rawTitle);

  return {
    isDrmProtected: false,
    artist: rawArtist,
    albumArtist: rawAlbumArtist,
    trackArtist: rawTrackArtist || rawArtist,
    compilation: Boolean(common.compilation),
    album: rawAlbum,
    title: rawTitle,
    trackNo: paddedTrack,
    discNo: discNum,
    discNumber: discNum,
    discTrack,
    extension: cleanExt,
    filename: archiveFilename,
    normalizedKey,
    duration: format.duration || 0,
    lossless: Boolean(format.lossless),
    sampleRate: format.sampleRate || null,
    bitsPerSample: format.bitsPerSample || null,
  };
}
