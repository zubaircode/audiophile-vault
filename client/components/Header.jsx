import React, { memo } from 'react';
import {
  Disc,
  Settings,
  Database,
  HardDrive,
  Music2,
  Filter,
  Sparkles,
  Loader2,
  Sun,
  Moon,
} from 'lucide-react';
import { formatBytes } from './UnifiedControlBar.jsx';
import { useTheme } from '../context/ThemeContext.jsx';

const Header = memo(function Header({
  totalTracks,
  artworkStats,
  filterMissingArt,
  onToggleMissingArtFilter,
  activePlaylist,
  vaultBytes = 0,
  activeVolume = null,
  isWorking = false,
  isFetchingArtwork = false,
  onStartArtworkFetch,
  onStopArtworkFetch,
  onOpenSettings,
}) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 border-b border-zinc-200 dark:border-zinc-800 px-6 py-2.5 transition-colors">
      <div className="w-full flex flex-wrap items-center justify-between gap-4">
        {/* App Brand Identity (Scaled-up title, no path subtitle) */}
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-amber-500/20 via-zinc-100 dark:via-zinc-900 to-cyan-500/20 border border-amber-500/40 flex items-center justify-center shadow-inner shrink-0">
            <Disc
              className={`w-6 h-6 text-amber-500 dark:text-amber-400 ${
                isWorking ? 'animate-[spin_6s_linear_infinite]' : ''
              }`}
            />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100 whitespace-nowrap">
            Audiophile Vault
          </h1>
        </div>

        {/* Standardized Height (h-14) Stat Cards & Settings Trigger */}
        <div className="flex flex-wrap items-center gap-2.5">
          {/* 0. THEME TOGGLE (Positioned immediately to the left of VAULT TRACKS) */}
          <div className="h-14 px-3.5 flex flex-col justify-center rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xs dark:shadow-none transition-colors">
            <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider leading-none mb-1.5 select-none">
              THEME
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={theme === 'dark'}
              aria-label="Toggle Light and Dark Mode"
              onClick={toggleTheme}
              className="relative inline-flex h-5 w-10 shrink-0 cursor-pointer items-center rounded-full border border-zinc-300 dark:border-zinc-700 bg-zinc-200 dark:bg-zinc-800 transition-colors focus:outline-none focus:ring-2 focus:ring-amber-500/40"
            >
              <span
                className={`pointer-events-none flex h-4 w-4 transform items-center justify-center rounded-full bg-white dark:bg-amber-500 shadow-sm transition-transform duration-200 ${
                  theme === 'dark' ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              >
                {theme === 'dark' ? (
                  <Moon className="h-2.5 w-2.5 text-zinc-950" />
                ) : (
                  <Sun className="h-2.5 w-2.5 text-amber-600" />
                )}
              </span>
            </button>
          </div>

          {/* 1. VAULT TRACKS Stat Card */}
          <div className="h-14 px-3.5 flex flex-col justify-center rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xs dark:shadow-none transition-colors">
            <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider leading-none mb-1.5 select-none">
              Vault Tracks
            </span>
            <div className="flex items-center gap-2 leading-none">
              <Music2 className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
              <span className="text-sm font-mono font-bold text-zinc-900 dark:text-zinc-100">
                {totalTracks}
              </span>
            </div>
          </div>

          {/* 2. LIBRARY COVER ART Stat / Action Card */}
          <div className="h-14 px-3.5 flex flex-col justify-center rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xs dark:shadow-none transition-colors">
            <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider leading-none mb-1.5 select-none">
              {activePlaylist ? 'Playlist Cover Art' : 'Library Cover Art'}
            </span>
            <div className="flex items-center gap-2 leading-none">
              <span className="font-mono text-sm text-zinc-900 dark:text-zinc-100 font-bold">
                {artworkStats.withArt}/{artworkStats.total}
              </span>
              {artworkStats.total > 0 && (
                <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                  ({artworkStats.pct}%)
                </span>
              )}

              <div className="h-3.5 w-px bg-zinc-200 dark:bg-zinc-800 mx-0.5" />

              {/* Filter Missing Art Icon Toggle Button */}
              <button
                type="button"
                onClick={onToggleMissingArtFilter}
                aria-pressed={filterMissingArt}
                title={
                  filterMissingArt
                    ? `Filtering: ${artworkStats.missing} missing — click to clear filter`
                    : 'Show tracks missing artwork'
                }
                className={`p-1 rounded-md border transition cursor-pointer ${
                  filterMissingArt
                    ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300 border-amber-500/50 shadow-sm shadow-amber-500/10'
                    : 'bg-zinc-100 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
              </button>

              {/* Fetch Missing Art Compact Icon Button */}
              {isFetchingArtwork ? (
                <button
                  type="button"
                  onClick={onStopArtworkFetch}
                  title="Stop artwork lookup"
                  className="p-1 rounded-md border border-red-500/50 bg-red-500/20 text-red-600 dark:text-red-300 hover:bg-red-500/30 transition cursor-pointer"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500 dark:text-red-400" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onStartArtworkFetch}
                  disabled={isWorking}
                  title={
                    activePlaylist
                      ? 'Fetch missing artwork for playlist'
                      : 'Fetch missing artwork for library'
                  }
                  className="p-1 rounded-md border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-950 hover:border-zinc-300 dark:hover:border-zinc-700 text-zinc-600 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 transition disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* 3. VAULT SIZE Stat Card */}
          <div className="h-14 px-3.5 flex flex-col justify-center rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xs dark:shadow-none transition-colors">
            <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider leading-none mb-1.5 select-none">
              Vault Size
            </span>
            <div className="flex items-center gap-2 leading-none">
              <Database className="w-4 h-4 text-cyan-600 dark:text-cyan-400 shrink-0" />
              <span className="text-sm font-mono font-bold text-zinc-900 dark:text-zinc-100">
                {formatBytes(vaultBytes)}
              </span>
            </div>
          </div>

          {/* 4. TARGET SD Stat Card */}
          <div className="h-14 px-3.5 flex flex-col justify-center rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xs dark:shadow-none transition-colors">
            <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider leading-none mb-1.5 select-none">
              Target SD
            </span>
            <div className="flex items-center gap-2 leading-none">
              <HardDrive
                className={`w-4 h-4 shrink-0 ${
                  activeVolume ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-400 dark:text-zinc-600'
                }`}
              />
              {activeVolume ? (
                <div className="flex items-baseline gap-1.5 font-mono">
                  <span className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
                    {activeVolume.name}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400 font-normal">
                    ({formatBytes(activeVolume.freeSpace)} free)
                  </span>
                </div>
              ) : (
                <span className="text-xs text-zinc-500 dark:text-zinc-400 italic font-normal">
                  No SD Detected
                </span>
              )}
            </div>
          </div>

          {/* 5. Settings Trigger Button (h-14 matching block) */}
          <button
            type="button"
            onClick={onOpenSettings}
            title="Configure Directories & Target SD Card Settings"
            className="h-14 w-14 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-amber-500/50 dark:hover:border-amber-500/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 hover:text-amber-600 dark:hover:text-amber-400 flex items-center justify-center transition-colors shadow-xs dark:shadow-none shrink-0 cursor-pointer"
          >
            <Settings className="w-5 h-5 text-amber-500 dark:text-amber-400" />
          </button>
        </div>
      </div>
    </header>
  );
});

export default Header;
