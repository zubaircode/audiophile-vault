import React, { useEffect, useRef, useState } from 'react';
import {
  X,
  Upload,
  Download,
  Trash2,
  Image as ImageIcon,
  Loader2,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

export function getTrackBaseName(track) {
  if (!track) return '';
  if (track.baseName) return track.baseName;
  if (track.filename) {
    return track.filename.replace(/\.[^.]+$/, '');
  }
  if (track.artworkFilename) {
    return track.artworkFilename.replace(/\.jpg$/i, '');
  }
  return '';
}

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

export function cleanArtistForGrouping(rawArtist) {
  if (!rawArtist || typeof rawArtist !== 'string') return 'unknown artist';
  const cleaned = rawArtist
    .normalize('NFC')
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s*[\(\[](?:feat\.?|ft\.?|featuring|with)\s+[^)\]]+[\)\]]/gi, '')
    .replace(/\s+\b(?:feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  return cleaned || 'unknown artist';
}

export function cleanAlbumForGrouping(rawAlbum) {
  if (!rawAlbum || typeof rawAlbum !== 'string') return 'unknown album';
  const cleaned = rawAlbum
    .normalize('NFC')
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s*[\(\[](?:disc|cd|disk)\s*\d+[^)\]]*[\)\]]/gi, '')
    .replace(/\s*[-–—:]\s*(?:disc|cd|disk)\s*\d+\b.*$/i, '')
    .replace(
      /\s*[\(\[][^)\]]*\b(?:remaster(?:ed)?|deluxe|expanded|anniversary|special\s+edition|bonus\s+track|reissue|explicit|mono|stereo)\b[^)\]]*[\)\]]/gi,
      ''
    )
    .replace(/\s*[:\-–—]+\s*/g, ' - ')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–—:]+$/g, '')
    .trim()
    .toLowerCase();

  return cleaned || 'unknown album';
}

export function getTrackDiscNumber(track) {
  if (!track || typeof track !== 'object') return 1;
  if (Number.isFinite(Number(track.discNumber)) && Number(track.discNumber) > 0) {
    return Number(track.discNumber);
  }
  if (Number.isFinite(Number(track.discNo)) && Number(track.discNo) > 0) {
    return Number(track.discNo);
  }
  if (track.discTrack && /^\d{3,}$/.test(String(track.discTrack))) {
    const discPart = Math.floor(Number(track.discTrack) / 100);
    if (discPart > 0) return discPart;
  }
  return 1;
}

export function getAlbumGroupKey(track, { includeDisc = false } = {}) {
  if (!track || typeof track !== 'object') return 'unknown artist|unknown album';

  const rawAlbumArtist = String(track.albumArtist || '').trim();
  const isCompilation =
    Boolean(track.compilation) ||
    /^various(\s+artists)?$/i.test(rawAlbumArtist) ||
    /^various(\s+artists)?$/i.test(String(track.artist || '').trim());

  const anchorArtist = isCompilation
    ? 'various artists'
    : cleanArtistForGrouping(rawAlbumArtist || track.artist || '');

  const cleanAlbum = cleanAlbumForGrouping(track.album || '');
  const baseKey = `${anchorArtist}|${cleanAlbum}`;

  if (includeDisc) {
    return `${baseKey}|disc:${getTrackDiscNumber(track)}`;
  }
  return baseKey;
}

export function findAlbumSiblingTracks(
  tracksList,
  referenceTrack,
  { includeDisc = false } = {}
) {
  if (!Array.isArray(tracksList) || !referenceTrack) return [];

  const targetGroupKey = getAlbumGroupKey(referenceTrack, { includeDisc });
  const targetCleanAlbum = cleanAlbumForGrouping(referenceTrack.album || '');
  const targetDisc = getTrackDiscNumber(referenceTrack);
  const isSpecificAlbumTitle =
    targetCleanAlbum.length >= 4 && !GENERIC_ALBUM_TITLES.has(targetCleanAlbum);

  return tracksList.filter((t) => {
    if (!t) return false;
    if (getAlbumGroupKey(t, { includeDisc }) === targetGroupKey) {
      return true;
    }
    if (isSpecificAlbumTitle) {
      const candidateAlbum = cleanAlbumForGrouping(t.album || '');
      if (candidateAlbum === targetCleanAlbum) {
        if (includeDisc && getTrackDiscNumber(t) !== targetDisc) {
          return false;
        }
        return true;
      }
    }
    return false;
  });
}

export default function ArtworkModal({
  track,
  albumTracksCount,
  albumTrackCount,
  onClose,
  onUploadArtwork,
  onRemoveArtwork,
}) {
  const totalAlbumTracks = albumTracksCount ?? albumTrackCount ?? 1;

  const [applyToAlbum, setApplyToAlbum] = useState(true);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [localError, setLocalError] = useState('');

  const fileInputRef = useRef(null);

  const baseName = getTrackBaseName(track);
  const cacheBuster = track?.artworkUpdatedAt || track?.updatedAt || 1;
  const hasArt = Boolean(track?.hasArtwork) && !imgError;
  const canRemoveArt = Boolean(track?.hasArtwork) || hasArt;

  const artworkUrl = baseName
    ? `/api/artwork/${encodeURIComponent(baseName)}?t=${cacheBuster}`
    : '';

  const downloadUrl = baseName
    ? `/api/artwork/${encodeURIComponent(baseName)}/download`
    : '';

  // Reset error states when track or its artwork timestamp changes
  useEffect(() => {
    setImgError(false);
    setLocalError('');
  }, [track?.trackKey, track?.hasArtwork, track?.artworkUpdatedAt, track?.updatedAt, baseName]);

  // Dismiss on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!track) return null;

  const handleFileSelected = async (file) => {
    if (!file) return;
    setLocalError('');

    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (file.type && !validTypes.includes(file.type.toLowerCase())) {
      setLocalError('Please choose a valid JPEG, PNG, or WebP image file.');
      return;
    }

    setIsUploading(true);
    try {
      await onUploadArtwork({
        track,
        baseName,
        file,
        applyToAlbum,
        scope: applyToAlbum ? 'album' : 'single',
      });
      setImgError(false);
    } catch (err) {
      setLocalError(err.message || 'Failed to embed artwork.');
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);

    const droppedFile = e.dataTransfer?.files?.[0];
    if (droppedFile) {
      await handleFileSelected(droppedFile);
    }
  };

  const handleRemoveClick = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (isDeleting || isUploading) return;

    setIsDeleting(true);
    setLocalError('');
    try {
      await onRemoveArtwork({
        track,
        baseName,
        applyToAlbum,
        scope: applyToAlbum ? 'album' : 'single',
      });
      setImgError(false);
    } catch (err) {
      setLocalError(err.message || 'Failed to remove embedded artwork.');
    } finally {
      setIsDeleting(false);
    }
  };

  const busy = isUploading || isDeleting;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      className="fixed inset-0 z-50 bg-black/60 dark:bg-black/75 backdrop-blur-md flex items-center justify-center p-4 select-none animate-in fade-in duration-150"
    >
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700/90 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col">
        {/* 1. MODAL HEADER */}
        <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-900/90 border-b border-zinc-200 dark:border-zinc-800 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-amber-500 shrink-0" />
              <span className="text-[10px] font-mono uppercase tracking-widest text-amber-600 dark:text-amber-400/90 font-semibold">
                Embedded Container Artwork Inspector
              </span>
            </div>
            <h2
              className="text-base font-bold text-zinc-900 dark:text-zinc-100 truncate mt-1"
              title={track.title}
            >
              {track.title}
            </h2>
            <p
              className="text-xs text-zinc-600 dark:text-zinc-400 truncate mt-0.5"
              title={`${track.artist} — ${track.album}`}
            >
              <span className="text-zinc-900 dark:text-zinc-200 font-medium">{track.artist}</span>{' '}
              <span className="text-zinc-400 dark:text-zinc-600">•</span>{' '}
              <span className="text-sky-600 dark:text-cyan-300/90 font-medium">{track.album}</span>
            </p>
            <p
              className="text-[11px] font-mono text-zinc-500 dark:text-zinc-500 truncate mt-1"
              title={track.filename || `${baseName}.m4a`}
            >
              Container: {track.filename || baseName}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition"
            aria-label="Close modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2. LARGE ARTWORK VIEWPORT + DRAG & DROP ZONE */}
        <div className="p-6 flex flex-col items-center space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFileSelected(f);
            }}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!isDraggingOver) setIsDraggingOver(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingOver(false);
            }}
            onDrop={handleDrop}
            onClick={() => {
              if (!hasArt && !busy) {
                fileInputRef.current?.click();
              }
            }}
            className={`relative w-full max-w-[440px] aspect-square rounded-2xl overflow-hidden transition-all flex items-center justify-center ${
              isDraggingOver
                ? 'border-2 border-dashed border-amber-500 bg-amber-500/10 ring-4 ring-amber-500/20'
                : hasArt
                ? 'border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 shadow-inner'
                : 'border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-amber-500/70 bg-zinc-50 dark:bg-zinc-950/80 hover:bg-zinc-100 dark:hover:bg-zinc-900/60 cursor-pointer'
            }`}
          >
            {hasArt ? (
              <>
                <img
                  src={artworkUrl}
                  alt={track.album || track.title}
                  onError={() => setImgError(true)}
                  className="w-full h-full object-contain bg-zinc-100 dark:bg-zinc-950"
                />
                {/* Drag-over overlay on top of existing image */}
                {isDraggingOver && (
                  <div className="absolute inset-0 bg-zinc-950/85 backdrop-blur-sm flex flex-col items-center justify-center text-amber-300 p-6 text-center">
                    <Upload className="w-10 h-10 mb-2 animate-bounce" />
                    <p className="text-sm font-semibold">
                      Drop image to embed replacement cover art
                    </p>
                    <p className="text-xs text-zinc-400 mt-1">
                      Losslessly embeds into audio container (APIC / PICTURE / covr)
                    </p>
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center justify-center text-center p-8">
                <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center mb-3 shadow-inner">
                  <Upload className="w-7 h-7 text-amber-500" />
                </div>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  No embedded artwork found. Drag an image here or click to browse.
                </p>
                <p className="text-xs text-zinc-500 mt-1.5 max-w-xs">
                  Embeds <code className="text-zinc-700 dark:text-zinc-300">.jpg</code>,{' '}
                  <code className="text-zinc-700 dark:text-zinc-300">.png</code>, or{' '}
                  <code className="text-zinc-700 dark:text-zinc-300">.webp</code> directly into the audio container without re-encoding audio.
                </p>
              </div>
            )}

            {/* Uploading / Deleting Spinner Overlay */}
            {(isUploading || isDeleting) && (
              <div className="absolute inset-0 bg-zinc-950/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2 text-amber-300">
                <Loader2 className="w-8 h-8 animate-spin" />
                <span className="text-xs font-mono uppercase tracking-wider">
                  {isDeleting
                    ? 'Stripping embedded picture tags…'
                    : 'Embedding artwork into audio container…'}
                </span>
              </div>
            )}
          </div>

          {localError && (
            <div className="w-full max-w-[440px] flex items-center gap-2 px-3.5 py-2 rounded-xl bg-red-50 dark:bg-red-950/70 border border-red-200 dark:border-red-800/80 text-xs text-red-700 dark:text-red-200">
              <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
              <span>{localError}</span>
            </div>
          )}

          {/* 3. BATCH ALBUM TOGGLE */}
          <label className="w-full max-w-[440px] flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl bg-zinc-50 dark:bg-zinc-950/90 border border-zinc-200 dark:border-zinc-800/90 cursor-pointer hover:border-zinc-300 dark:hover:border-zinc-700 transition">
            <div className="flex items-center gap-2.5 min-w-0">
              <input
                type="checkbox"
                checked={applyToAlbum}
                onChange={(e) => setApplyToAlbum(e.target.checked)}
                disabled={busy}
                className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-amber-500 focus:ring-amber-500/40 bg-white dark:bg-zinc-900"
              />
              <span className="text-xs text-zinc-700 dark:text-zinc-200 truncate">
                Apply to all tracks on this album (
                <strong className="text-amber-600 dark:text-amber-300">{track.album}</strong>)
              </span>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-400 shrink-0">
              {totalAlbumTracks} {totalAlbumTracks === 1 ? 'track' : 'tracks'}
            </span>
          </label>
        </div>

        {/* 4. ACTION CONTROLS BAR */}
        <div className="px-6 py-4 bg-zinc-50 dark:bg-zinc-950/90 border-t border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-3">
          {/* Left: Remove Art */}
          <div>
            <button
              type="button"
              onClick={handleRemoveClick}
              disabled={!canRemoveArt || busy}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-white dark:bg-zinc-900 hover:bg-red-50 dark:hover:bg-red-950/60 text-zinc-700 dark:text-zinc-200 hover:text-red-600 dark:hover:text-red-200 border border-zinc-200 dark:border-zinc-700 hover:border-red-300 dark:hover:border-red-700/80 transition disabled:opacity-40 disabled:cursor-not-allowed shadow-xs"
            >
              {isDeleting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500" />
              ) : (
                <Trash2 className="w-3.5 h-3.5 text-red-500" />
              )}
              <span>
                {isDeleting
                  ? 'Removing…'
                  : applyToAlbum && totalAlbumTracks > 1
                  ? `Remove Art (${totalAlbumTracks})`
                  : 'Remove Art'}
              </span>
            </button>
          </div>

          {/* Right: Download Art & Replace / Upload Art */}
          <div className="flex items-center gap-2.5">
            {hasArt ? (
              <a
                href={downloadUrl}
                download={`${baseName}.jpg`}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 transition shadow-xs"
              >
                <Download className="w-3.5 h-3.5 text-sky-500 dark:text-cyan-400" />
                <span>Download Art</span>
              </a>
            ) : (
              <button
                type="button"
                disabled
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600 border border-zinc-200 dark:border-zinc-800 cursor-not-allowed"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Download Art</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-400 hover:to-orange-400 text-zinc-950 shadow-md shadow-amber-500/10 transition disabled:opacity-50"
            >
              {isUploading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>{hasArt ? 'Replace / Upload Art…' : 'Browse Image…'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
