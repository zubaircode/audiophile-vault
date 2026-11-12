import React, { useState, useEffect, useCallback, memo } from 'react';
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
  Music,
} from 'lucide-react';
import { useAudioPlayer } from '../context/PlayerContext.jsx';

function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function getFormatBadge(track) {
  if (!track) return null;
  const ext = (track.extension || '').toUpperCase().replace(/^\./, '');
  const isLossless = ['FLAC', 'ALAC', 'WAV', 'AIFF'].includes(ext);
  return `${ext || 'AUDIO'}${isLossless ? ' • LOSSLESS' : ''}`;
}

const NowPlayingBar = memo(function NowPlayingBar({
  onInspectArtwork,
  onScrollToCurrentTrack,
}) {
  const {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    togglePlayPause,
    seek,
    setIsScrubbing,
    nextTrack,
    previousTrack,
    setVolume,
    toggleMute,
    queue,
    queueIndex,
  } = useAudioPlayer();

  const [hasArtworkError, setHasArtworkError] = useState(false);
  const [scrubValue, setScrubValue] = useState(null);

  // Reset artwork error when track changes
  useEffect(() => {
    setHasArtworkError(false);
  }, [currentTrack?.baseName, currentTrack?.artworkUpdatedAt]);

  const effectiveDuration = duration > 0 ? duration : currentTrack?.duration || 0;
  const displayedTime = scrubValue !== null ? scrubValue : currentTime;
  const progressPct =
    effectiveDuration > 0
      ? Math.min(100, Math.max(0, (displayedTime / effectiveDuration) * 100))
      : 0;

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

  // If no track is currently playing or selected, show low-profile placeholder
  if (!currentTrack) {
    return (
      <div className="bg-zinc-900/90 border-b border-zinc-800 backdrop-blur-md px-6 py-2.5 flex items-center justify-between gap-4 text-xs select-none">
        <div className="flex items-center gap-3 text-zinc-500">
          <div className="w-8 h-8 rounded-lg bg-zinc-950/80 border border-zinc-800/80 flex items-center justify-center">
            <Disc className="w-4 h-4 text-zinc-600" />
          </div>
          <div>
            <span className="text-zinc-400 font-medium">No track playing</span>
            <span className="mx-2 text-zinc-600">•</span>
            <span className="text-zinc-500">Double-click any row to start listening</span>
          </div>
        </div>

        <div className="hidden sm:flex items-center gap-3 text-zinc-600 font-mono text-[11px]">
          <span>Space: Play/Pause</span>
        </div>
      </div>
    );
  }

  const artworkSrc = `/api/artwork/${encodeURIComponent(currentTrack.baseName)}?t=${
    currentTrack.artworkUpdatedAt || 0
  }`;

  return (
    <div
      role="region"
      aria-label="Now Playing Audio Transport"
      className="bg-zinc-900/95 border-b border-zinc-800 backdrop-blur-md px-6 py-2.5 flex flex-col md:flex-row items-center justify-between gap-4 select-none z-20 shadow-md"
    >
      {/* LEFT SECTION: Artwork & Track Metadata */}
      <div className="flex items-center gap-3.5 min-w-0 w-full md:w-1/3">
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
          className="group relative w-14 h-14 rounded-lg overflow-hidden bg-zinc-950 border border-zinc-700/60 shadow-md shrink-0 cursor-pointer transition hover:border-amber-500/60"
        >
          {!hasArtworkError ? (
            <img
              src={artworkSrc}
              alt={`${currentTrack.title} Cover`}
              onError={() => setHasArtworkError(true)}
              className="w-full h-full object-cover transition-transform group-hover:scale-105"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-900 text-zinc-600">
              <Disc className="w-7 h-7" />
            </div>
          )}
          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
            <Maximize2 className="w-4 h-4 text-zinc-100 drop-shadow" />
          </div>
        </div>

        {/* Text Metadata */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2
              title={currentTrack.title || currentTrack.filename}
              className="text-zinc-100 font-semibold text-sm truncate leading-snug"
            >
              {currentTrack.title || currentTrack.filename}
            </h2>
            {/* Format / Lossless pill */}
            <span className="shrink-0 text-[10px] font-mono uppercase px-1.5 py-0.5 rounded bg-zinc-800/90 text-zinc-300 border border-zinc-700/70 tracking-wider">
              {getFormatBadge(currentTrack)}
            </span>
          </div>

          <p
            title={`${currentTrack.artist} — ${currentTrack.album}`}
            className="text-zinc-400 text-xs truncate mt-0.5"
          >
            <span className="text-zinc-300 font-medium">
              {currentTrack.artist || 'Unknown Artist'}
            </span>
            <span className="mx-1.5 text-zinc-600">•</span>
            <span>{currentTrack.album || 'Unknown Album'}</span>
          </p>

          {queue.length > 0 && queueIndex >= 0 && (
            <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
              Track {queueIndex + 1} of {queue.length}
            </div>
          )}
        </div>
      </div>

      {/* CENTER SECTION: Transport Controls & Scrubbable Timeline */}
      <div className="flex flex-col items-center justify-center w-full md:w-5/12 max-w-xl">
        {/* Buttons cluster */}
        <div className="flex items-center gap-4 mb-1.5">
          <button
            type="button"
            onClick={previousTrack}
            title="Previous track / Restart (Left Arrow / SkipBack)"
            className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition active:scale-95"
            aria-label="Previous track"
          >
            <SkipBack className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={togglePlayPause}
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
            className="w-10 h-10 rounded-full bg-amber-500 hover:bg-amber-400 text-zinc-950 flex items-center justify-center transition shadow-md shadow-amber-500/20 active:scale-95"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current translate-x-0.5" />
            )}
          </button>

          <button
            type="button"
            onClick={nextTrack}
            title="Next track (Right Arrow / SkipForward)"
            className="p-1.5 rounded-full text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 transition active:scale-95"
            aria-label="Next track"
          >
            <SkipForward className="w-4 h-4" />
          </button>
        </div>

        {/* Scrub Timeline */}
        <div className="w-full flex items-center gap-2.5 text-[11px] font-mono text-zinc-400">
          <span className="w-10 text-right tabular-nums">
            {formatTime(displayedTime)}
          </span>

          <div className="relative flex-1 flex items-center">
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
              className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-zinc-800 focus:outline-none accent-amber-500 transition"
              style={{
                background: `linear-gradient(to right, rgb(245 158 11) 0%, rgb(245 158 11) ${progressPct}%, rgb(63 63 70) ${progressPct}%, rgb(63 63 70) 100%)`,
              }}
            />
          </div>

          <span className="w-10 text-left tabular-nums text-zinc-500">
            {formatTime(effectiveDuration)}
          </span>
        </div>
      </div>

      {/* RIGHT SECTION: Secondary Controls (Volume & Locate Song) */}
      <div className="flex items-center justify-end gap-3 w-full md:w-1/3">
        {/* Scroll To Playing Track Button */}
        {onScrollToCurrentTrack && (
          <button
            type="button"
            onClick={() => onScrollToCurrentTrack(currentTrack)}
            title="Scroll library to currently playing track"
            className="p-2 rounded-lg bg-zinc-950/80 border border-zinc-800 hover:border-zinc-700 text-zinc-400 hover:text-amber-400 transition"
            aria-label="Scroll to currently playing track"
          >
            <LocateFixed className="w-4 h-4" />
          </button>
        )}

        {/* Volume Slider with Mute Icon */}
        <div className="flex items-center gap-2 bg-zinc-950/70 border border-zinc-800/80 rounded-xl px-3 py-1.5">
          <button
            type="button"
            onClick={toggleMute}
            title={isMuted ? 'Unmute' : 'Mute'}
            className="text-zinc-400 hover:text-zinc-200 transition"
            aria-label={isMuted ? 'Unmute' : 'Mute'}
          >
            {isMuted || volume === 0 ? (
              <VolumeX className="w-4 h-4 text-red-400" />
            ) : volume < 0.5 ? (
              <Volume1 className="w-4 h-4" />
            ) : (
              <Volume2 className="w-4 h-4 text-zinc-300" />
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
            className="w-20 sm:w-24 h-1.5 rounded-lg appearance-none cursor-pointer bg-zinc-800 focus:outline-none accent-amber-500"
            style={{
              background: `linear-gradient(to right, rgb(245 158 11) 0%, rgb(245 158 11) ${
                (isMuted ? 0 : volume) * 100
              }%, rgb(63 63 70) ${(isMuted ? 0 : volume) * 100}%, rgb(63 63 70) 100%)`,
            }}
          />
        </div>
      </div>
    </div>
  );
});

export default NowPlayingBar;
