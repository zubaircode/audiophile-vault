import React, { memo, useState, useEffect } from 'react';
import {
  Settings,
  Database,
  HardDrive,
  Music2,
  Filter,
  Sparkles,
  Loader2,
  Sun,
  Moon,
  Wifi,
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
  syncTargetMode = 'sd',
  ftpServiceName = 'WiFiFTP',
  ftpManualHost = '',
  ftpServices = [],
  isWorking = false,
  isSyncing = false,
  isFetchingArtwork = false,
  onStartArtworkFetch,
  onStopArtworkFetch,
  onOpenSettings,
}) {
  const { theme, toggleTheme } = useTheme();

  const isElectron = typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);
  const [isFullScreen, setIsFullScreen] = useState(false);

  useEffect(() => {
    if (!isElectron || !window.electronAPI) return;

    if (window.electronAPI.isFullScreen) {
      window.electronAPI
        .isFullScreen()
        .then((fs) => setIsFullScreen(Boolean(fs)))
        .catch(() => {});
    }

    if (window.electronAPI.onFullScreenChange) {
      const cleanup = window.electronAPI.onFullScreenChange((val) => {
        setIsFullScreen(Boolean(val));
      });
      return cleanup;
    }
  }, [isElectron]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(display-mode: fullscreen)');
    const handleMediaChange = (e) => {
      setIsFullScreen((prev) => (e.matches ? true : prev));
    };
    if (mediaQuery.matches) setIsFullScreen(true);
    mediaQuery.addEventListener?.('change', handleMediaChange);
    return () => mediaQuery.removeEventListener?.('change', handleMediaChange);
  }, []);

  const isNonDragTarget = (target) => {
    if (!target || typeof target.closest !== 'function') return false;
    return Boolean(
      target.closest('button, input, a, select, textarea, [role="switch"], [data-no-drag]')
    );
  };

  const handleHeaderMouseDown = (e) => {
    if (e.button !== 0) return;
    if (isNonDragTarget(e.target)) return;
    window.webkit?.messageHandlers?.avBridge?.postMessage({ type: 'windowDrag' });
  };

  const handleHeaderDoubleClick = (e) => {
    if (isNonDragTarget(e.target)) return;
    window.webkit?.messageHandlers?.avBridge?.postMessage({ type: 'windowZoom' });
  };

  return (
    <header
      data-window-drag="true"
      onMouseDown={handleHeaderMouseDown}
      onDoubleClick={handleHeaderDoubleClick}
      style={{ WebkitAppRegion: 'drag' }}
      className={`bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 border-b border-zinc-200 dark:border-zinc-800 pr-6 py-2.5 transition-all duration-150 select-none ${
        isElectron && !isFullScreen ? 'pl-20' : 'pl-4'
      }`}
    >
      <div className="w-full flex flex-wrap items-center justify-end gap-4">
        {/* Draggable grab area spanning the left section */}
        <div
          data-window-drag="true"
          style={{ WebkitAppRegion: 'drag' }}
          className="flex-1 min-w-8 h-14"
        />

        {/* Standardized Height (h-14) Stat Cards & Settings Trigger */}
        <div
          data-no-drag="true"
          style={{ WebkitAppRegion: 'no-drag' }}
          className="flex flex-wrap items-center gap-2.5"
        >
          {/* 0. THEME TOGGLE (Positioned immediately to the left of VAULT TRACKS) */}
          <div
            data-no-drag="true"
            style={{ WebkitAppRegion: 'no-drag' }}
            className="h-14 px-3.5 flex flex-col justify-center rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xs dark:shadow-none transition-colors"
          >
            <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider leading-none mb-1.5 select-none">
              THEME
            </span>
            <button
              type="button"
              role="switch"
              data-no-drag="true"
              style={{ WebkitAppRegion: 'no-drag' }}
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
                data-no-drag="true"
                style={{ WebkitAppRegion: 'no-drag' }}
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
                  data-no-drag="true"
                  style={{ WebkitAppRegion: 'no-drag' }}
                  onClick={onStopArtworkFetch}
                  title="Stop artwork lookup"
                  className="p-1 rounded-md border border-red-500/50 bg-red-500/20 text-red-600 dark:text-red-300 hover:bg-red-500/30 transition cursor-pointer"
                >
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-red-500 dark:text-red-400" />
                </button>
              ) : (
                <button
                  type="button"
                  data-no-drag="true"
                  style={{ WebkitAppRegion: 'no-drag' }}
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

          {/* 4. TARGET Stat Card (SD Card or Wi-Fi FTP) */}
          {(() => {
            const isFtp = syncTargetMode === 'ftp';
            const preferredName = ftpServiceName || 'WiFiFTP';
            const matchedSvc = ftpServices.find(
              (s) => s.instanceName?.toLowerCase() === preferredName.toLowerCase()
            );
            const ftpReady = Boolean(ftpManualHost?.trim()) || Boolean(matchedSvc?.resolved);
            const displayName = matchedSvc?.instanceName || ftpServiceName?.trim() || 'FTP';

            return (
              <div className="h-14 px-3.5 flex flex-col justify-center rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-xs dark:shadow-none transition-colors">
                <span className="text-[10px] font-semibold text-zinc-500 dark:text-zinc-500 uppercase tracking-wider leading-none mb-1.5 select-none">
                  {isFtp ? 'Target FTP' : 'Target SD'}
                </span>
                {isFtp ? (
                  <div
                    className="flex items-center gap-2 leading-none"
                    title={ftpReady ? `${displayName} (Online)` : `${displayName} (Offline)`}
                  >
                    <Wifi
                      className={`w-4 h-4 shrink-0 ${
                        ftpReady
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-zinc-400 dark:text-zinc-600'
                      }`}
                    />
                    <span className="text-sm font-mono font-bold text-zinc-900 dark:text-zinc-100">
                      {displayName}
                    </span>
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        ftpReady ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-600'
                      }`}
                    />
                  </div>
                ) : (
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
                )}
              </div>
            );
          })()}

          {/* 5. Settings Trigger Button (h-14 matching block) */}
          <button
            type="button"
            data-no-drag="true"
            style={{ WebkitAppRegion: 'no-drag' }}
            disabled={isSyncing}
            onClick={onOpenSettings}
            title={
              isSyncing
                ? 'Unavailable while sync is in progress'
                : 'Configure Directories & Target SD Card Settings'
            }
            className="h-14 w-14 rounded-lg bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-amber-500/50 dark:hover:border-amber-500/50 hover:bg-zinc-50 dark:hover:bg-zinc-800/80 text-zinc-700 dark:text-zinc-300 hover:text-amber-600 dark:hover:text-amber-400 flex items-center justify-center transition-colors shadow-xs dark:shadow-none shrink-0 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
          >
            <Settings className="w-5 h-5 text-amber-500 dark:text-amber-400" />
          </button>
        </div>
      </div>
    </header>
  );
});

export default Header;
