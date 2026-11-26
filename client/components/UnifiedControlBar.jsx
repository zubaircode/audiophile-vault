import React, { useState, useEffect, memo } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  Volume1,
  VolumeX,
  Disc,
  LocateFixed,
  Maximize2,
  FolderInput,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import { useAudioPlayer } from '../context/PlayerContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { API_BASE } from '../utils/api.js';

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0.0 GB';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(1)} MB`;
}

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function EjectIcon({ className = 'w-5 h-5' }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <polygon points="12 4 4 14 20 14" />
      <rect x="4" y="18" width="16" height="2" rx="1" />
    </svg>
  );
}

const UnifiedControlBar = memo(function UnifiedControlBar({
  onInspectArtwork,
  onScrollToCurrentTrack,
  onJumpToNowPlaying,
  volumes = [],
  selectedVolumePath = '',
  syncTargetMode = 'sd',
  ftpServiceName = 'WiFiFTP',
  ftpManualHost = '',
  onStartIngest,
  onStartSync,
  onCancelSync,
  onEjectVolume,
  isIngesting = false,
  isSyncing = false,
  syncState = null,
  isEjecting = false,
}) {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    queue = [],
    queueIndex = -1,
    queueSource = { name: 'All Tracks', id: null, type: 'library' },
    togglePlayPause,
    seek,
    setIsScrubbing,
    nextTrack,
    previousTrack,
    setVolume,
    toggleMute,
  } = useAudioPlayer();
  const { theme } = useTheme();

  const [hasArtworkError, setHasArtworkError] = useState(false);
  const [scrubValue, setScrubValue] = useState(null);

  useEffect(() => {
    setHasArtworkError(false);
  }, [currentTrack?.baseName, currentTrack?.artworkUpdatedAt]);

  const selectedVol =
    volumes.find(
      (v) => v.path === selectedVolumePath || selectedVolumePath.startsWith(`${v.path}/`)
    ) || null;
  const isMounted = Boolean(selectedVol);
  const isFtpMode = syncTargetMode === 'ftp';
  const ftpDisplayLabel = ftpManualHost?.trim() || ftpServiceName || 'WiFiFTP';
  const canSync = isFtpMode ? true : isMounted;
  const busy = isIngesting || isSyncing || isEjecting;

  const currentNumber = queueIndex >= 0 ? queueIndex + 1 : 0;
  const totalNumber = Array.isArray(queue) ? queue.length : 0;
  const sourceLabel = queueSource?.name || 'All Tracks';

  const effectiveDuration = duration > 0 ? duration : currentTrack?.duration || 0;
  const displayedTime = scrubValue !== null ? scrubValue : currentTime;
  const progressPct =
    effectiveDuration > 0
      ? Math.min(100, Math.max(0, (displayedTime / effectiveDuration) * 100))
      : 0;

  const trackBg = theme === 'dark' ? 'rgb(39 39 42)' : 'rgb(212 212 216)';

  const handleSliderChange = (e) => {
    const val = parseFloat(e.target.value);
    setScrubValue(val);
  };

  const handleSliderPointerDown = () => {
    setIsScrubbing(true);
  };

  const handleSliderPointerUp = (e) => {
    const val = parseFloat(e.target.value);
    seek(val);
    setScrubValue(null);
    setIsScrubbing(false);
  };

  const artworkSrc = currentTrack?.baseName
    ? `${API_BASE}/api/artwork/${encodeURIComponent(currentTrack.baseName)}${
        currentTrack.artworkUpdatedAt ? `?v=${currentTrack.artworkUpdatedAt}` : ''
      }`
    : '';

  return (
    <section
      role="region"
      aria-label="Playback and Sync Control Bar"
      className="relative flex items-start justify-between px-6 pt-2.5 pb-2.5 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 backdrop-blur-md h-[5.5rem] select-none z-20 transition-colors"
    >
      <div className="relative flex items-start justify-between w-full h-full">
        {/* ================================================== */}
        {/* LEFT: Now Playing Display */}
        {/* ================================================== */}
        <div className="flex items-center gap-3 min-w-0 z-10 max-w-[28%] sm:max-w-[30%]">
          {currentTrack ? (
            <>
              {/* Clickable Square Artwork Thumbnail */}
              <div
                role="button"
                tabIndex={0}
                onClick={() => onInspectArtwork?.(currentTrack)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onInspectArtwork?.(currentTrack);
                  }
                }}
                title="Click to inspect or change artwork"
                className="group relative w-12 h-12 rounded-lg overflow-hidden bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-700/60 shadow-md shrink-0 cursor-pointer transition hover:border-amber-500/60"
              >
                {!hasArtworkError ? (
                  <img
                    src={artworkSrc}
                    alt={`${currentTrack.title} Cover`}
                    onError={() => setHasArtworkError(true)}
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-zinc-100 dark:bg-zinc-900 text-zinc-400 dark:text-zinc-600">
                    <Disc className="w-5 h-5" />
                  </div>
                )}
                <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Maximize2 className="w-3.5 h-3.5 text-zinc-100 drop-shadow" />
                </div>
              </div>

              {/* Text Metadata */}
              <div className="min-w-0 flex-1">
                <h2
                  title={currentTrack.title || currentTrack.filename}
                  className="text-zinc-900 dark:text-zinc-100 font-semibold text-xs sm:text-sm truncate leading-snug"
                >
                  {currentTrack.title || currentTrack.filename}
                </h2>
                <p
                  title={`${currentTrack.artist} — ${currentTrack.album}`}
                  className="text-zinc-500 dark:text-zinc-400 text-[11px] truncate mt-0.5"
                >
                  <span className="text-zinc-800 dark:text-zinc-300 font-medium">
                    {currentTrack.artist || 'Unknown Artist'}
                  </span>
                  <span className="mx-1 text-zinc-400 dark:text-zinc-600">•</span>
                  <span>{currentTrack.album || 'Unknown Album'}</span>
                </p>
              </div>
            </>
          ) : (
            <div className="flex items-center gap-2.5 text-xs text-zinc-400 dark:text-zinc-500 min-w-0">
              <div className="w-10 h-10 rounded-lg bg-zinc-100 dark:bg-zinc-950/80 border border-zinc-200 dark:border-zinc-800/80 flex items-center justify-center shrink-0">
                <Disc className="w-4 h-4 text-zinc-400 dark:text-zinc-600" />
              </div>
              <div className="truncate">
                <span className="text-zinc-700 dark:text-zinc-400 font-medium">No track playing</span>
                <span className="mx-1.5 text-zinc-400 dark:text-zinc-600">•</span>
                <span className="text-zinc-500">Double-click a song to play</span>
              </div>
            </div>
          )}
        </div>

        {/* ================================================== */}
        {/* CENTER: Strict Center Anchor for Transport Controls */}
        {/* ================================================== */}
        <div className="absolute left-1/2 -translate-x-1/2 top-0 flex flex-col items-center justify-center z-20 pointer-events-auto">
          {/* Transport Buttons */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={previousTrack}
              title="Previous track / Restart (Left Arrow / SkipBack)"
              className="p-1 rounded-full text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition active:scale-95 cursor-pointer"
              aria-label="Previous track"
            >
              <SkipBack className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={togglePlayPause}
              title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
              className="w-9 h-9 rounded-full bg-amber-500 hover:bg-amber-400 text-zinc-950 flex items-center justify-center transition shadow-md shadow-amber-500/20 active:scale-95 cursor-pointer"
              aria-label={isPlaying ? 'Pause' : 'Play'}
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current translate-x-0.5" />
              )}
            </button>

            <button
              type="button"
              onClick={nextTrack}
              title="Next track (Right Arrow / SkipForward)"
              className="p-1 rounded-full text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800/80 transition active:scale-95 cursor-pointer"
              aria-label="Next track"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          {/* Scrub Bar & Timestamps */}
          <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 dark:text-zinc-400 mt-1">
            <span className="w-8 text-right tabular-nums">
              {formatTime(displayedTime)}
            </span>

            <div className="w-48 sm:w-64 md:w-80 flex items-center">
              <input
                type="range"
                min={0}
                max={effectiveDuration || 100}
                step={0.1}
                value={displayedTime}
                onChange={handleSliderChange}
                onPointerDown={handleSliderPointerDown}
                onPointerUp={handleSliderPointerUp}
                title={`Seek (${formatTime(displayedTime)})`}
                aria-label="Seek track position"
                className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-zinc-300 dark:bg-zinc-800 focus:outline-none accent-amber-500 transition"
                style={{
                  background: `linear-gradient(to right, rgb(245 158 11) 0%, rgb(245 158 11) ${progressPct}%, ${trackBg} ${progressPct}%, ${trackBg} 100%)`,
                }}
              />
            </div>

            <span className="w-8 text-left tabular-nums text-zinc-400 dark:text-zinc-500">
              {formatTime(effectiveDuration)}
            </span>
          </div>

          {/* Queue Status Readout / Jump to Now Playing Button */}
          <button
            type="button"
            onClick={() => {
              if (onJumpToNowPlaying) {
                onJumpToNowPlaying();
              } else if (onScrollToCurrentTrack) {
                onScrollToCurrentTrack(currentTrack);
              }
            }}
            disabled={!currentTrack}
            title={
              currentTrack
                ? `Jump to playing track in "${sourceLabel}" (${currentNumber} of ${totalNumber})`
                : 'No queue active'
            }
            className="group flex items-center justify-center text-[11px] font-medium text-zinc-600 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 tracking-wide select-none mt-1 truncate max-w-xs sm:max-w-md text-center transition-colors cursor-pointer disabled:cursor-default disabled:hover:text-zinc-400 dark:disabled:hover:text-zinc-500"
          >
            {currentTrack ? (
              <span className="inline-flex items-center truncate">
                <span className="text-zinc-800 dark:text-zinc-300 group-hover:text-amber-600 dark:group-hover:text-amber-300 font-semibold underline decoration-zinc-300 dark:decoration-zinc-700 group-hover:decoration-amber-500/60 underline-offset-2 transition-colors truncate">
                  {sourceLabel}
                </span>
                <span className="mx-1 text-zinc-400 dark:text-zinc-600 shrink-0">•</span>
                <span className="shrink-0 text-zinc-500 dark:text-zinc-400 group-hover:text-amber-700 dark:group-hover:text-amber-200/90 transition-colors">
                  Track {currentNumber} of {totalNumber}
                </span>
              </span>
            ) : (
              <span className="text-zinc-400 dark:text-zinc-500 italic">No queue active</span>
            )}
          </button>
        </div>

        {/* ================================================== */}
        {/* RIGHT: Volume + Divider + Matching Height Icon Actions */}
        {/* ================================================== */}
        <div className="flex items-center gap-3 z-10 shrink-0">
          {/* Locate Song Button */}
          {(onJumpToNowPlaying || onScrollToCurrentTrack) && currentTrack && (
            <button
              type="button"
              onClick={() => {
                if (onJumpToNowPlaying) {
                  onJumpToNowPlaying();
                } else if (onScrollToCurrentTrack) {
                  onScrollToCurrentTrack(currentTrack);
                }
              }}
              title="Jump to playing track in active queue"
              className="p-1.5 rounded-lg bg-white dark:bg-zinc-950/80 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 transition cursor-pointer shadow-xs dark:shadow-none"
              aria-label="Scroll to currently playing track"
            >
              <LocateFixed className="w-3.5 h-3.5" />
            </button>
          )}

          {/* Volume Control */}
          <div className="flex items-center gap-1.5 bg-zinc-100/90 dark:bg-zinc-950/70 border border-zinc-200 dark:border-zinc-800/80 rounded-xl px-2.5 py-1">
            <button
              type="button"
              onClick={toggleMute}
              title={isMuted ? 'Unmute' : 'Mute'}
              className="text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition cursor-pointer"
              aria-label={isMuted ? 'Unmute' : 'Mute'}
            >
              {isMuted || volume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-red-500 dark:text-red-400" />
              ) : volume < 0.5 ? (
                <Volume1 className="w-3.5 h-3.5 text-zinc-600 dark:text-zinc-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-zinc-700 dark:text-zinc-300" />
              )}
            </button>

            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={isMuted ? 0 : volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              title={`Volume: ${Math.round((isMuted ? 0 : volume) * 100)}%`}
              aria-label="Adjust volume"
              className="w-16 sm:w-20 h-1.5 rounded-lg appearance-none cursor-pointer bg-zinc-300 dark:bg-zinc-800 focus:outline-none accent-amber-500"
              style={{
                background: `linear-gradient(to right, rgb(245 158 11) 0%, rgb(245 158 11) ${
                  (isMuted ? 0 : volume) * 100
                }%, ${trackBg} ${(isMuted ? 0 : volume) * 100}%, ${trackBg} 100%)`,
              }}
            />
          </div>

          {/* Scaled Vertical Partition Divider */}
          <div className="h-10 w-px bg-zinc-200 dark:bg-zinc-800 mx-1.5 shrink-0" />

          {/* Matching Height (h-14 w-14) Icon-Only Action Buttons */}
          <div className="flex items-center gap-2.5 shrink-0">
            {/* 1. Ingest Button */}
            <button
              type="button"
              onClick={onStartIngest}
              disabled={busy}
              title="Scan & Ingest from Music Library"
              className="h-14 w-14 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:text-amber-600 dark:hover:text-amber-400 flex items-center justify-center transition-colors shadow-xs dark:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed shrink-0 cursor-pointer"
              aria-label="Scan & Ingest from Music Library"
            >
              {isIngesting ? (
                <Loader2 className="w-5 h-5 text-amber-500 dark:text-amber-400 animate-spin" />
              ) : (
                <FolderInput className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              )}
            </button>

            {/* 2. Sync / Stop Sync Button */}
            {isSyncing ? (
              <button
                type="button"
                onClick={onCancelSync}
                disabled={Boolean(syncState?.isCanceling)}
                title={
                  syncState?.isCanceling
                    ? 'Stopping sync…'
                    : syncState?.totalCount > 0
                    ? `Syncing (${syncState.processedCount}/${syncState.totalCount}) — Click to Stop Sync`
                    : 'Syncing — Click to Stop Sync'
                }
                className="h-14 w-14 rounded-lg bg-red-500/15 border border-red-500/50 hover:bg-red-500/25 text-red-600 dark:text-red-400 flex flex-col items-center justify-center gap-0.5 transition-colors shadow-xs dark:shadow-sm disabled:opacity-50 disabled:cursor-not-allowed shrink-0 cursor-pointer"
                aria-label="Stop Sync"
              >
                <Loader2 className="w-4 h-4 animate-spin text-red-500 dark:text-red-400" />
                <span className="text-[9px] font-bold uppercase tracking-wider leading-none">
                  {syncState?.isCanceling ? 'Stopping' : 'Stop'}
                </span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onStartSync}
                disabled={!canSync || busy}
                title={
                  isFtpMode
                    ? `Sync via Wi-Fi FTP (${ftpDisplayLabel})`
                    : isMounted
                    ? `Sync to SD Card (${selectedVol.name})`
                    : 'Sync to SD Card'
                }
                className="h-14 w-14 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-amber-500/50 hover:bg-amber-500/10 text-zinc-700 dark:text-zinc-300 hover:text-amber-600 dark:hover:text-amber-400 flex items-center justify-center transition-colors shadow-xs dark:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed shrink-0 cursor-pointer"
                aria-label={isFtpMode ? 'Sync via Wi-Fi FTP' : 'Sync to SD Card'}
              >
                <RefreshCw className="w-5 h-5 text-amber-500 dark:text-amber-400" />
              </button>
            )}

            {/* 3. Eject SD Card Button */}
            <button
              type="button"
              onClick={onEjectVolume}
              disabled={isSyncing || isFtpMode || !isMounted || busy}
              title={
                isSyncing
                  ? 'Unavailable while sync is in progress'
                  : isFtpMode
                  ? 'Not applicable for Wi-Fi FTP target'
                  : isMounted
                  ? `Eject SD Card (${selectedVol.name})`
                  : 'Eject SD Card'
              }
              className="h-14 w-14 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-red-500/40 hover:bg-red-500/10 text-zinc-500 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 flex items-center justify-center transition-colors shadow-xs dark:shadow-sm disabled:opacity-40 disabled:cursor-not-allowed shrink-0 cursor-pointer"
              aria-label="Eject SD Card"
            >
              {isEjecting ? (
                <Loader2 className="w-5 h-5 animate-spin text-red-500 dark:text-red-400" />
              ) : (
                <EjectIcon className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
});

export default UnifiedControlBar;
