import React, { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { API_BASE } from '../utils/api.js';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  flexRender,
} from '@tanstack/react-table';
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  Disc,
  Disc3,
  GripVertical,
  ListMusic,
  Maximize2,
  Music,
  Pencil,
  PlusCircle,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import ContextMenu from './ContextMenu.jsx';
import { useAudioPlayer } from '../context/PlayerContext.jsx';
import {
  cleanAlbumTitle,
  compareTracksByPerformer,
  compareTracksBySmartRelease,
  formatDiscTrackIndex,
  getCompilationBadge,
  getSmartReleaseSortKey,
  getSortArtist,
} from '../utils/sorting.js';

function formatFileSize(bytes) {
  if (!bytes || Number.isNaN(Number(bytes))) return '—';
  const mb = Number(bytes) / (1024 * 1024);
  return `${mb.toFixed(2)} MB`;
}

function formatAddedDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

const ARTWORK_COL_WIDTH = 56; // Fixed constant, never in state
const STORAGE_KEY_COL_WIDTHS = 'av_col_widths_v2';
const LEGACY_STORAGE_KEY_COL_WIDTHS = 'av_column_widths';

const DEFAULT_COLUMN_WIDTHS = {
  sequenceNumber: 64,
  albumTrack: 380,
  artist: 220,
  filename: 320,
  fileSize: 90,
  addedDate: 150,
};

const COLUMN_LIMITS = {
  sequenceNumber: { min: 48, max: 100, resizable: false },
  artwork: { min: 56, max: 56, resizable: false },
  albumTrack: { min: 180, max: 1200, resizable: true },
  artist: { min: 120, max: 800, resizable: true },
  filename: { min: 150, max: 1200, resizable: true },
  fileSize: { min: 70, max: 250, resizable: true },
  addedDate: { min: 90, max: 350, resizable: true },
};

let measureCanvas = null;
function measureTextWidth(text, font) {
  if (typeof document === 'undefined') return 100;
  try {
    if (!measureCanvas) {
      measureCanvas = document.createElement('canvas');
    }
    const ctx = measureCanvas.getContext('2d');
    if (!ctx) return 100;
    ctx.font = font;
    return ctx.measureText(text || '').width;
  } catch {
    return 100;
  }
}

const TrackCoverThumb = memo(
  function TrackCoverThumb({ track, onInspect }) {
    const [imgError, setImgError] = useState(false);

    const baseName =
      track.baseName ||
      (track.filename ? track.filename.replace(/\.[^.]+$/, '') : '');

    // Deterministic & Cached Image URL:
    // Strip dynamic, real-time timestamps from the image src.
    // Use a stable URL key based strictly on persistent metadata,
    // only appending cache-busting timestamp (?v=...) if modified in current session.
    const artworkSrc = baseName
      ? `${API_BASE}/api/artwork/${encodeURIComponent(baseName)}${
          track.artworkUpdatedAt ? `?v=${track.artworkUpdatedAt}` : ''
        }`
      : null;

    useEffect(() => {
      if (track.hasArtwork) {
        setImgError(false);
      }
    }, [track.hasArtwork, track.artworkUpdatedAt, baseName]);

    const showImage = Boolean(track.hasArtwork) && !imgError && Boolean(baseName);

    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onInspect?.(track);
        }}
        title={
          showImage
            ? 'Click to inspect or replace embedded cover artwork'
            : 'Click to embed custom cover artwork'
        }
        className="group/thumb relative w-10 h-10 rounded bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/70 hover:border-amber-500/80 flex items-center justify-center text-zinc-400 dark:text-zinc-500 shrink-0 overflow-hidden transition focus:outline-none focus:ring-2 focus:ring-amber-500/50 cursor-pointer"
      >
        <div className="w-10 h-10 shrink-0 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
          {showImage ? (
            <img
              src={artworkSrc}
              alt={track.album || track.title || 'Cover Art'}
              loading="eager"
              decoding="async"
              onError={() => setImgError(true)}
              className="w-10 h-10 rounded bg-zinc-100 dark:bg-zinc-800 object-cover"
            />
          ) : (
            <Disc className="w-4 h-4 text-zinc-400 dark:text-zinc-500 group-hover/thumb:opacity-20 transition-opacity" />
          )}
        </div>

        {/* Subtle hover overlay with zoom/edit icon */}
        <span className="absolute inset-0 bg-black/65 opacity-0 group-hover/thumb:opacity-100 flex items-center justify-center transition-opacity pointer-events-none">
          {showImage ? (
            <Maximize2 className="w-3.5 h-3.5 text-amber-300" />
          ) : (
            <Pencil className="w-3.5 h-3.5 text-amber-300" />
          )}
        </span>
      </button>
    );
  },
  (prev, next) =>
    prev.onInspect === next.onInspect &&
    prev.track.trackKey === next.track.trackKey &&
    prev.track.filename === next.track.filename &&
    prev.track.baseName === next.track.baseName &&
    prev.track.hasArtwork === next.track.hasArtwork &&
    prev.track.artworkUpdatedAt === next.track.artworkUpdatedAt
);

const TrackRow = memo(function TrackRow({
  row,
  idx,
  isBeingDragged,
  isDropTarget,
  isContextSelected,
  isCurrentActive,
  isFlashActive,
  isSelected,
  isReorderEnabled,
  dropIndicatorClass,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onClick,
  onDoubleClick,
  onContextMenu,
}) {
  const track = row.original;
  const trackKey = track.trackKey || track.normalizedKey || track.filename;

  return (
    <tr
      key={row.id}
      data-track-key={trackKey}
      draggable={isReorderEnabled}
      onDragStart={(e) => onDragStart(e, idx)}
      onDragOver={(e) => onDragOver(e, idx)}
      onDragEnd={onDragEnd}
      onDrop={(e) => onDrop(e, idx)}
      onClick={(e) => onClick?.(track, idx, e)}
      onDoubleClick={() => onDoubleClick(row.original, idx)}
      onContextMenu={(e) => onContextMenu(e, row.original, idx)}
      className={`group ${
        isBeingDragged
          ? 'opacity-40 bg-zinc-200 dark:bg-zinc-900/80'
          : isFlashActive
          ? 'bg-amber-500/25 ring-2 ring-inset ring-amber-400 animate-pulse border-l-4 border-amber-400 shadow-md shadow-amber-500/20'
          : isContextSelected
          ? 'bg-amber-500/15 dark:bg-amber-500/20 ring-1 ring-inset ring-amber-500/40'
          : isSelected
          ? 'bg-amber-500/15 dark:bg-amber-500/20 ring-1 ring-inset ring-amber-500/40 border-l-2 border-amber-500'
          : isCurrentActive
          ? 'bg-amber-500/10 dark:bg-amber-500/15 border-l-2 border-amber-500 shadow-sm shadow-amber-500/10'
          : idx % 2 === 0
          ? 'bg-white dark:bg-zinc-950'
          : 'bg-zinc-50 dark:bg-zinc-900/40'
      } ${dropIndicatorClass} hover:bg-zinc-100 dark:hover:bg-zinc-800/70 border-b border-zinc-200 dark:border-zinc-800/70 cursor-pointer select-none`}
    >
      {row.getVisibleCells().map((cell) => {
        const colId = cell.column.id;
        const isArt = colId === 'artwork';
        return (
          <td
            key={cell.id}
            className={`whitespace-nowrap overflow-hidden ${
              isArt
                ? 'w-[56px] min-w-[56px] max-w-[56px] shrink-0 px-2 py-1.5 text-center'
                : 'px-4 py-2'
            }`}
          >
            {flexRender(
              cell.column.columnDef.cell,
              cell.getContext()
            )}
          </td>
        );
      })}
    </tr>
  );
});

const ROW_HEIGHT = 53;
const OVERSCAN_ROWS = 15;

const STORAGE_KEY_SCROLL = 'av_scroll_positions';

function loadSavedScrollPositions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_SCROLL);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    }
  } catch (err) {
    console.warn('Failed to load saved scroll positions:', err);
  }
  return {};
}

const TrackTable = memo(function TrackTable({
  tracks,
  searchQuery,
  onSearchChange,
  filterMissingArt = false,
  onClearMissingArtFilter,
  playlists = [],
  mostRecentPlaylistId = null,
  activePlaylist = null,
  onAddTrackToPlaylist,
  onRemoveTrackFromPlaylist,
  onCreatePlaylistWithTrack,
  onReorderPlaylistTracks,
  onMovePlaylistTrack,
  onInspectArtwork,
  scrollToTrackKey = null,
  selectedTrackKey = null,
  onSelectTrack,
}) {
  const { currentTrack, isPlaying, playTrack, togglePlayPause } = useAudioPlayer();
  const [sorting, setSorting] = useState(() =>
    activePlaylist ? [] : [{ id: 'albumTrack', desc: false }]
  );
  const [rowContextMenu, setRowContextMenu] = useState(null); // { x, y, track, index }

  // Drag-and-Drop state (active in Playlist view)
  const [draggedIndex, setDraggedIndex] = useState(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);

  // Viewport windowing state for smooth scrolling on 1,000+ track vaults
  const scrollContainerRef = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);
  const [flashTrackKey, setFlashTrackKey] = useState(null);
  const flashTimerRef = useRef(null);

  useEffect(() => {
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    };
  }, []);

  // Persistent column widths loaded from localStorage
  const [colWidths, setColWidths] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_COL_WIDTHS);
      if (saved) {
        return { ...DEFAULT_COLUMN_WIDTHS, ...JSON.parse(saved) };
      }
      const legacy = localStorage.getItem(LEGACY_STORAGE_KEY_COL_WIDTHS);
      if (legacy) {
        return { ...DEFAULT_COLUMN_WIDTHS, ...JSON.parse(legacy) };
      }
    } catch (err) {
      console.warn('Failed to parse saved column widths:', err);
    }
    return { ...DEFAULT_COLUMN_WIDTHS };
  });

  const saveColWidths = useCallback((newWidths) => {
    try {
      localStorage.setItem(STORAGE_KEY_COL_WIDTHS, JSON.stringify(newWidths));
    } catch (err) {
      console.warn('Failed to save column widths:', err);
    }
  }, []);

  // Resizing mouse interaction
  const resizingColRef = useRef(null);

  const handleResizeStart = useCallback(
    (colKey, e) => {
      e.preventDefault();
      e.stopPropagation();

      if (colKey === 'artwork') return;
      const limits = COLUMN_LIMITS[colKey];
      if (!limits || !limits.resizable) return;

      const startX = e.clientX;
      const startWidth = colWidths[colKey] || DEFAULT_COLUMN_WIDTHS[colKey] || 150;
      resizingColRef.current = { colKey, startX, startWidth };

      const handleMouseMove = (moveEvent) => {
        if (!resizingColRef.current) return;
        const deltaX = moveEvent.clientX - resizingColRef.current.startX;
        const rawWidth = resizingColRef.current.startWidth + deltaX;
        const clampedWidth = Math.max(limits.min, Math.min(limits.max, Math.round(rawWidth)));

        setColWidths((prev) => {
          if (prev[colKey] === clampedWidth) return prev;
          // ONLY update this column; all other keys remain untouched
          return {
            ...prev,
            [colKey]: clampedWidth,
          };
        });
      };

      const handleMouseUp = () => {
        if (resizingColRef.current) {
          setColWidths((latest) => {
            saveColWidths(latest);
            return latest;
          });
          resizingColRef.current = null;
        }
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    },
    [colWidths, saveColWidths]
  );

  // Double-click auto-fit handler
  const handleResizeDoubleClick = useCallback(
    (e, colKey) => {
      e.preventDefault();
      e.stopPropagation();

      if (colKey === 'artwork') return;
      const limits = COLUMN_LIMITS[colKey];
      if (!limits || !limits.resizable) return;

      const headerTitleMap = {
        albumTrack: 'Album / Track',
        artist: 'Artist',
        filename: 'Vault Archive Filename',
        fileSize: 'Size',
        addedDate: 'Added',
      };
      const headerTitle = headerTitleMap[colKey] || colKey;
      const headerFont = '600 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      const headerWidth = measureTextWidth(headerTitle, headerFont) + 64;

      let maxContentWidth = 0;
      const sampleTracks = tracks.slice(0, 200);

      if (colKey === 'albumTrack') {
        const albumFont = '600 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        const trackFont = '500 12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        for (const t of sampleTracks) {
          const rawAlbum = t.album || 'Unknown Album';
          const displayAlbum = cleanAlbumTitle(rawAlbum);
          const compBadge = getCompilationBadge(t);
          const line1 = compBadge ? `${displayAlbum} [${compBadge}]` : displayAlbum;
          const w1 = measureTextWidth(line1, albumFont);

          const { disc, trackNo } = formatDiscTrackIndex(t);
          const line2 = `D${disc} • T${trackNo} — ${t.title || 'Unknown Title'}`;
          const w2 = measureTextWidth(line2, trackFont) + 24;

          if (w1 > maxContentWidth) maxContentWidth = w1;
          if (w2 > maxContentWidth) maxContentWidth = w2;
        }
        maxContentWidth += 48;
      } else if (colKey === 'artist') {
        const artistFont = '500 14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        for (const t of sampleTracks) {
          const name = t.artist || 'Unknown Artist';
          const w = measureTextWidth(name, artistFont);
          if (w > maxContentWidth) maxContentWidth = w;
        }
        maxContentWidth += 48;
      } else if (colKey === 'filename') {
        const monoFont = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        for (const t of sampleTracks) {
          const fn = t.filename || '';
          const w = measureTextWidth(fn, monoFont);
          if (w > maxContentWidth) maxContentWidth = w;
        }
        maxContentWidth += 48;
      } else if (colKey === 'fileSize') {
        const monoFont = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace';
        for (const t of sampleTracks) {
          const fs = formatFileSize(t.fileSize);
          const w = measureTextWidth(fs, monoFont);
          if (w > maxContentWidth) maxContentWidth = w;
        }
        maxContentWidth += 48;
      } else if (colKey === 'addedDate') {
        const dateFont = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        for (const t of sampleTracks) {
          const dt = formatAddedDate(t.addedDate);
          const w = measureTextWidth(dt, dateFont);
          if (w > maxContentWidth) maxContentWidth = w;
        }
        maxContentWidth += 48;
      }

      const targetWidth = Math.max(headerWidth, maxContentWidth);
      const clampedWidth = Math.max(limits.min, Math.min(limits.max, Math.round(targetWidth)));

      setColWidths((prev) => {
        // ONLY update this column; all other keys remain untouched
        const next = { ...prev, [colKey]: clampedWidth };
        saveColWidths(next);
        return next;
      });
    },
    [tracks, saveColWidths]
  );

  // Scroll position cache across view contexts persisted in localStorage under 'av_scroll_positions'
  const scrollCacheRef = useRef(loadSavedScrollPositions());
  const saveScrollTimeoutRef = useRef(null);
  const isRestoringScrollRef = useRef(false);

  // Compute a unique key representing the current browsing view context
  const currentViewKey = useMemo(() => {
    const base = activePlaylist ? `playlist_${activePlaylist.id}` : 'library';
    if (!filterMissingArt && (!searchQuery || !searchQuery.trim())) {
      return base;
    }
    const art = filterMissingArt ? 'missing_art' : 'all_art';
    const query = searchQuery?.trim()
      ? `search_${encodeURIComponent(searchQuery.trim().toLowerCase())}`
      : 'no_search';
    return `${base}::${art}::${query}`;
  }, [activePlaylist?.id, filterMissingArt, searchQuery]);

  const persistScrollPositions = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY_SCROLL, JSON.stringify(scrollCacheRef.current));
    } catch (e) {
      // ignore
    }
  }, []);

  const debouncedSaveScroll = useCallback(() => {
    if (saveScrollTimeoutRef.current) {
      clearTimeout(saveScrollTimeoutRef.current);
    }
    saveScrollTimeoutRef.current = setTimeout(() => {
      persistScrollPositions();
    }, 200);
  }, [persistScrollPositions]);

  // Flush scroll positions on beforeunload and component unmount
  useEffect(() => {
    const handleBeforeUnload = () => {
      persistScrollPositions();
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (saveScrollTimeoutRef.current) {
        clearTimeout(saveScrollTimeoutRef.current);
      }
      persistScrollPositions();
    };
  }, [persistScrollPositions]);

  // Restore scroll position whenever view context changes or data loads
  useLayoutEffect(() => {
    // CRITICAL ASYNC TIMING GATE: Do NOT restore or clamp scroll when tracks array is empty
    // (initial render before server data arrives). Restoring scroll against empty tracks would clamp to 0!
    if (!tracks || tracks.length === 0) return;

    const container = scrollContainerRef.current;
    if (!container) return;

    isRestoringScrollRef.current = true;

    const savedTop = scrollCacheRef.current[currentViewKey] ?? 0;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const clamped = Math.min(savedTop, maxScroll);

    container.scrollTop = clamped;
    setScrollTop(clamped);

    const rafId = requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        const refreshedMax = Math.max(
          0,
          scrollContainerRef.current.scrollHeight - scrollContainerRef.current.clientHeight
        );
        const refreshedClamped = Math.min(savedTop, refreshedMax);
        if (Math.abs(scrollContainerRef.current.scrollTop - refreshedClamped) > 1) {
          scrollContainerRef.current.scrollTop = refreshedClamped;
          setScrollTop(refreshedClamped);
        }
      }
      isRestoringScrollRef.current = false;
    });

    return () => {
      cancelAnimationFrame(rafId);
      isRestoringScrollRef.current = false;
    };
  }, [currentViewKey, tracks.length]);

  const handleScroll = useCallback(
    (e) => {
      const top = e.currentTarget.scrollTop;
      setScrollTop(top);
      if (!isRestoringScrollRef.current) {
        scrollCacheRef.current[currentViewKey] = top;
        debouncedSaveScroll();
      }
    },
    [currentViewKey, debouncedSaveScroll]
  );

  // Keep latest callbacks in refs so `columns` useMemo stays referentially stable
  const onInspectArtworkRef = useRef(onInspectArtwork);
  useEffect(() => {
    onInspectArtworkRef.current = onInspectArtwork;
  }, [onInspectArtwork]);

  const onSearchChangeRef = useRef(onSearchChange);
  useEffect(() => {
    onSearchChangeRef.current = onSearchChange;
  }, [onSearchChange]);

  const handleInspectTrack = useCallback((track) => {
    onInspectArtworkRef.current?.(track);
  }, []);

  const handleFilterByArtist = useCallback((artistName) => {
    if (!artistName) return;
    onSearchChangeRef.current?.(artistName);
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const updateHeight = () => {
      setViewportHeight(el.clientHeight || 800);
    };
    updateHeight();
    window.addEventListener('resize', updateHeight);
    return () => window.removeEventListener('resize', updateHeight);
  }, []);

  // Reset column sorting when switching into a playlist so playback order (1, 2, 3...) is shown;
  // in Master Library view, default to ascending Smart Release ("Album / Track") collation.
  useEffect(() => {
    setSorting(activePlaylist ? [] : [{ id: 'albumTrack', desc: false }]);
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, [activePlaylist?.id]);

  const isPlaylistView = Boolean(activePlaylist);
  const isCustomSortedOrFiltered =
    sorting.length > 0 ||
    Boolean(searchQuery && searchQuery.trim()) ||
    Boolean(filterMissingArt);
  const isReorderEnabled = isPlaylistView && !isCustomSortedOrFiltered;

  // Map trackKey -> 1-based playback sequence index inside activePlaylist.trackKeys
  const playlistOrderMap = useMemo(() => {
    const map = new Map();
    if (activePlaylist && Array.isArray(activePlaylist.trackKeys)) {
      activePlaylist.trackKeys.forEach((key, idx) => {
        map.set(key, idx + 1);
      });
    }
    return map;
  }, [activePlaylist]);

  const columns = useMemo(() => {
    const baseColumns = [
      {
        id: 'artwork',
        header: '',
        size: 56,
        enableSorting: false,
        cell: ({ row }) => (
          <TrackCoverThumb
            track={row.original}
            onInspect={handleInspectTrack}
          />
        ),
      },
      {
        id: 'albumTrack',
        accessorFn: (row) => getSmartReleaseSortKey(row),
        header: 'Album / Track',
        size: 380,
        sortingFn: (rowA, rowB) =>
          compareTracksBySmartRelease(rowA.original, rowB.original),
        cell: ({ row }) => {
          const track = row.original;
          const rawAlbum = track.album || 'Unknown Album';
          const displayAlbum = cleanAlbumTitle(rawAlbum);
          const compBadge = getCompilationBadge(track);
          const { disc, trackNo } = formatDiscTrackIndex(track);
          const songTitle = track.title || 'Unknown Title';
          const isRowActive =
            currentTrack &&
            (currentTrack.trackKey || currentTrack.filename) ===
              (track.trackKey || track.filename);

          return (
            <div className="flex flex-col justify-center leading-tight w-full min-w-0 overflow-hidden">
              {/* Line 1 (Bold / Primary): Clean Album Title + [VA] / [OST] badge */}
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className={`truncate ${
                    isRowActive
                      ? 'font-bold text-amber-600 dark:text-amber-400'
                      : 'font-semibold text-zinc-900 dark:text-zinc-100'
                  }`}
                  title={rawAlbum}
                >
                  {displayAlbum}
                </span>
                {compBadge && (
                  <span
                    className="shrink-0 px-1.5 py-0 rounded text-[10px] font-mono font-semibold bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30"
                    title={
                      compBadge === 'OST'
                        ? 'Original Soundtrack — grouped contiguously by release'
                        : 'Multi-Artist Compilation — grouped contiguously by release'
                    }
                  >
                    [{compBadge}]
                  </span>
                )}
              </div>

              {/* Line 2 (Secondary / Subtle): D{disc} • T{trackNo} — {track.title} */}
              <div
                className="text-xs truncate w-full min-w-0 mt-0.5 flex items-center"
                title={`D${disc} • T${trackNo} — ${songTitle}`}
              >
                {isRowActive && (
                  <span
                    className="inline-flex items-end gap-0.5 h-3 mr-1.5 shrink-0"
                    title={isPlaying ? 'Now Playing' : 'Paused'}
                  >
                    {isPlaying ? (
                      <>
                        <span className="w-0.5 bg-amber-500 dark:bg-amber-400 rounded-full h-2 animate-[pulse_0.7s_ease-in-out_infinite]" />
                        <span className="w-0.5 bg-amber-500 dark:bg-amber-400 rounded-full h-3 animate-[pulse_0.5s_ease-in-out_infinite_0.15s]" />
                        <span className="w-0.5 bg-amber-500 dark:bg-amber-400 rounded-full h-1.5 animate-[pulse_0.8s_ease-in-out_infinite_0.3s]" />
                      </>
                    ) : (
                      <Volume2 className="w-3.5 h-3.5 text-amber-500/70" />
                    )}
                  </span>
                )}
                <span
                  className={
                    isRowActive
                      ? 'font-mono text-amber-600 dark:text-amber-400 font-semibold'
                      : 'font-mono text-zinc-500 dark:text-zinc-400'
                  }
                >
                  D{disc} • T{trackNo}
                </span>
                <span className="text-zinc-300 dark:text-zinc-600 mx-1.5">—</span>
                <span
                  className={
                    isRowActive
                      ? 'text-amber-600 dark:text-amber-400 font-medium'
                      : 'text-zinc-900 dark:text-zinc-100 font-medium'
                  }
                >
                  {songTitle}
                </span>
              </div>
            </div>
          );
        },
      },
      {
        id: 'artist',
        accessorFn: (row) => getSortArtist(row.artist || 'Unknown Artist'),
        header: 'Artist',
        size: 220,
        sortingFn: (rowA, rowB) =>
          compareTracksByPerformer(rowA.original, rowB.original),
        cell: ({ row }) => {
          const track = row.original;
          const artistName = track.artist || 'Unknown Artist';

          return (
            <div className="flex items-center w-full min-w-0 overflow-hidden">
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  handleFilterByArtist(artistName);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    e.stopPropagation();
                    handleFilterByArtist(artistName);
                  }
                }}
                title="Filter by this artist"
                className="font-medium text-zinc-600 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 cursor-pointer truncate transition-colors"
              >
                {artistName}
              </span>
            </div>
          );
        },
      },
      {
        accessorKey: 'filename',
        header: 'Vault Archive Filename',
        size: 320,
        cell: (info) => (
          <div
            className="font-mono text-xs text-cyan-700 dark:text-cyan-300/90 truncate w-full min-w-0"
            title={info.getValue()}
          >
            {info.getValue()}
          </div>
        ),
      },
      {
        accessorKey: 'fileSize',
        header: 'Size',
        size: 90,
        cell: (info) => (
          <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">
            {formatFileSize(info.getValue())}
          </span>
        ),
      },
      {
        accessorKey: 'addedDate',
        header: 'Added',
        size: 150,
        cell: (info) => (
          <span className="text-xs text-zinc-400 dark:text-zinc-500">
            {formatAddedDate(info.getValue())}
          </span>
        ),
      },
    ];

    if (!isPlaylistView) {
      return baseColumns;
    }

    // In Playlist View, prepend the `#` sequence indicator + Drag Handle column
    const sequenceColumn = {
      id: 'sequenceNumber',
      header: '#',
      size: 64,
      enableSorting: false,
      cell: ({ row }) => {
        const key =
          row.original.trackKey ||
          row.original.normalizedKey ||
          row.original.filename;
        const seqNum = playlistOrderMap.get(key) ?? row.index + 1;

        return (
          <div className="flex items-center gap-1.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
            <GripVertical
              className={`w-3.5 h-3.5 shrink-0 transition-colors ${
                isReorderEnabled
                  ? 'text-zinc-400 dark:text-zinc-600 group-hover:text-amber-600 dark:group-hover:text-amber-400 cursor-grab active:cursor-grabbing'
                  : 'text-zinc-300 dark:text-zinc-800 cursor-not-allowed'
              }`}
            />
            <span className="w-5 text-right text-amber-600 dark:text-amber-400/90 font-semibold">
              {seqNum}
            </span>
          </div>
        );
      },
    };

    return [sequenceColumn, ...baseColumns];
  }, [
    isPlaylistView,
    isReorderEnabled,
    playlistOrderMap,
    handleInspectTrack,
    handleFilterByArtist,
    currentTrack,
    isPlaying,
  ]);

  const table = useReactTable({
    data: tracks,
    columns,
    state: {
      sorting,
    },
    enableSortingRemoval: false,
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const visibleColumns = table.getVisibleLeafColumns();
  const totalTableWidth = useMemo(() => {
    return visibleColumns.reduce((acc, col) => {
      const width =
        col.id === 'artwork'
          ? ARTWORK_COL_WIDTH
          : colWidths[col.id] || col.columnDef.size || 150;
      return acc + width;
    }, 0);
  }, [visibleColumns, colWidths]);

  const allRows = table.getRowModel().rows;
  const shouldWindow = allRows.length > 80 && draggedIndex === null;
  const startIndex = shouldWindow
    ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN_ROWS)
    : 0;
  const endIndex = shouldWindow
    ? Math.min(
        allRows.length,
        Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN_ROWS
      )
    : allRows.length;
  const visibleRows = shouldWindow
    ? allRows.slice(startIndex, endIndex)
    : allRows;
  const topPaddingHeight = shouldWindow ? startIndex * ROW_HEIGHT : 0;
  const bottomPaddingHeight = shouldWindow
    ? Math.max(0, (allRows.length - endIndex) * ROW_HEIGHT)
    : 0;

  // Smoothly scroll table to targeted track (centered) and flash highlight
  useEffect(() => {
    if (!scrollToTrackKey || !scrollContainerRef.current) return;
    const targetIdx = allRows.findIndex(
      (r) =>
        (r.original.trackKey || r.original.normalizedKey || r.original.filename) ===
        scrollToTrackKey
    );
    if (targetIdx !== -1) {
      const vh = scrollContainerRef.current.clientHeight || viewportHeight || 500;
      const centeredTop = Math.max(
        0,
        targetIdx * ROW_HEIGHT - Math.floor(vh / 2) + Math.floor(ROW_HEIGHT / 2)
      );
      scrollContainerRef.current.scrollTo({
        top: centeredTop,
        behavior: 'smooth',
      });

      setFlashTrackKey(scrollToTrackKey);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => {
        setFlashTrackKey(null);
      }, 1600);
    }
  }, [scrollToTrackKey, allRows, viewportHeight]);

  const handleRowClick = useCallback(
    (track) => {
      const key = track.trackKey || track.normalizedKey || track.filename;
      onSelectTrack?.(key);
    },
    [onSelectTrack]
  );

  const handleRowContextMenu = useCallback((e, track, rowIndex) => {
    e.preventDefault();
    const key = track.trackKey || track.normalizedKey || track.filename;
    onSelectTrack?.(key);
    setRowContextMenu({
      x: e.clientX,
      y: e.clientY,
      track,
      index: rowIndex,
    });
  }, [onSelectTrack]);

  const handleRowDoubleClick = useCallback(
    (track, idx) => {
      const key = track.trackKey || track.normalizedKey || track.filename;
      onSelectTrack?.(key);
      const trimmedQuery = searchQuery ? searchQuery.trim() : '';
      const sourceContext = activePlaylist
        ? { name: activePlaylist.name, id: activePlaylist.id, type: 'playlist' }
        : trimmedQuery
        ? { name: `Search: "${trimmedQuery}"`, id: null, type: 'search', query: trimmedQuery }
        : filterMissingArt
        ? { name: 'Missing Artwork', id: null, type: 'filter' }
        : { name: 'All Tracks', id: null, type: 'library' };

      playTrack(
        track,
        allRows.map((r) => r.original),
        idx,
        sourceContext
      );
    },
    [playTrack, allRows, activePlaylist, searchQuery, filterMissingArt, onSelectTrack]
  );

  // Drag-and-Drop Handlers
  const handleDragStart = useCallback((e, index) => {
    if (!isReorderEnabled) {
      e.preventDefault();
      return;
    }
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(index));
  }, [isReorderEnabled]);

  const handleDragOver = useCallback((e, index) => {
    if (!isReorderEnabled || draggedIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  }, [isReorderEnabled, draggedIndex, dragOverIndex]);

  const handleDragEnd = useCallback(() => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  }, []);

  const handleDrop = useCallback((e, dropIndex) => {
    e.preventDefault();
    if (!isReorderEnabled || !activePlaylist || draggedIndex === null) {
      handleDragEnd();
      return;
    }

    const fromIndex = draggedIndex;
    const toIndex = dropIndex;
    handleDragEnd();

    if (fromIndex === toIndex) return;

    const currentKeys = Array.isArray(activePlaylist.trackKeys)
      ? [...activePlaylist.trackKeys]
      : tracks.map((t) => t.trackKey || t.normalizedKey || t.filename);

    if (
      fromIndex < 0 ||
      fromIndex >= currentKeys.length ||
      toIndex < 0 ||
      toIndex >= currentKeys.length
    ) {
      return;
    }

    const [movedKey] = currentKeys.splice(fromIndex, 1);
    currentKeys.splice(toIndex, 0, movedKey);

    onReorderPlaylistTracks?.(activePlaylist.id, currentKeys, fromIndex, toIndex);
  }, [isReorderEnabled, activePlaylist, draggedIndex, handleDragEnd, tracks, onReorderPlaylistTracks]);

  // Build Context Menu Items for right-clicked track row
  const rowMenuItems = useMemo(() => {
    if (!rowContextMenu?.track) return [];
    const { track } = rowContextMenu;
    const trackKey = track.trackKey || track.normalizedKey || track.filename;

    // Determine exact index in activePlaylist.trackKeys when in Playlist view
    const playlistKeys = Array.isArray(activePlaylist?.trackKeys)
      ? activePlaylist.trackKeys
      : [];
    const playlistIdx = activePlaylist
      ? playlistKeys.indexOf(trackKey)
      : rowContextMenu.index;
    const totalInPlaylist = activePlaylist ? playlistKeys.length : tracks.length;

    const isThisTrackActive =
      currentTrack &&
      (currentTrack.trackKey || currentTrack.filename) === (track.trackKey || track.filename);

    const playItem = {
      key: 'play-now',
      label: isThisTrackActive && isPlaying ? 'Pause Playback' : 'Play Now',
      icon: isThisTrackActive && isPlaying ? Pause : Play,
      highlight: true,
      onClick: () => {
        if (isThisTrackActive) {
          togglePlayPause();
        } else {
          const trimmedQuery = searchQuery ? searchQuery.trim() : '';
          const sourceContext = activePlaylist
            ? { name: activePlaylist.name, id: activePlaylist.id, type: 'playlist' }
            : trimmedQuery
            ? { name: `Search: "${trimmedQuery}"`, id: null, type: 'search', query: trimmedQuery }
            : filterMissingArt
            ? { name: 'Missing Artwork', id: null, type: 'filter' }
            : { name: 'All Tracks', id: null, type: 'library' };

          playTrack(
            track,
            table.getRowModel().rows.map((r) => r.original),
            rowContextMenu.index,
            sourceContext
          );
        }
      },
    };

    // If no playlists exist yet (in Master Library view)
    if (!playlists || playlists.length === 0) {
      return [
        playItem,
        { type: 'separator' },
        {
          key: 'inspect-artwork',
          label: 'Inspect / Edit Artwork…',
          icon: Pencil,
          onClick: () => onInspectArtwork?.(track),
        },
        { type: 'separator' },
        {
          label: 'Create New Playlist...',
          icon: PlusCircle,
          highlight: true,
          onClick: () => onCreatePlaylistWithTrack?.(track),
        },
      ];
    }

    const items = [
      playItem,
      { type: 'separator' },
      {
        key: 'inspect-artwork',
        label: 'Inspect / Edit Artwork…',
        icon: Pencil,
        onClick: () => onInspectArtwork?.(track),
      },
      { type: 'separator' },
    ];

    // 1. When in a Playlist view, prepend "Move up" / "Move down" in playback order
    if (activePlaylist) {
      const canMoveUp = playlistIdx > 0;
      const canMoveDown =
        playlistIdx !== -1 && playlistIdx < totalInPlaylist - 1;

      items.push({
        key: 'move-up',
        label: 'Move up in playback order',
        icon: ArrowUp,
        disabled: !canMoveUp,
        onClick: () =>
          onMovePlaylistTrack?.(activePlaylist.id, trackKey, 'up', track),
      });

      items.push({
        key: 'move-down',
        label: 'Move down in playback order',
        icon: ArrowDown,
        disabled: !canMoveDown,
        onClick: () =>
          onMovePlaylistTrack?.(activePlaylist.id, trackKey, 'down', track),
      });

      items.push({ type: 'separator' });
    }

    // 2. Top Quick Action: Add to playlist: {Most Recent Playlist Name}
    const mostRecentPlaylist =
      playlists.find((p) => p.id === mostRecentPlaylistId) || playlists[0];

    if (mostRecentPlaylist) {
      items.push({
        key: `recent-${mostRecentPlaylist.id}`,
        label: `Add to playlist: ${mostRecentPlaylist.name}`,
        icon: Sparkles,
        highlight: true,
        onClick: () =>
          onAddTrackToPlaylist?.(mostRecentPlaylist.id, trackKey, track),
      });
    }

    // 3. Alphabetical list of playlists
    const targetPlaylists = activePlaylist
      ? playlists.filter((p) => p.id !== activePlaylist.id)
      : playlists;

    if (targetPlaylists.length > 0) {
      if (!activePlaylist) {
        items.push({ type: 'separator' });
      }
      for (const pl of targetPlaylists) {
        items.push({
          key: `add-${pl.id}`,
          label: `Add to: ${pl.name}`,
          icon: PlusCircle,
          badge: Array.isArray(pl.trackKeys) ? pl.trackKeys.length : 0,
          onClick: () => onAddTrackToPlaylist?.(pl.id, trackKey, track),
        });
      }
    }

    // 4. When viewing a specific Playlist, append Remove action at bottom
    if (activePlaylist) {
      items.push({ type: 'separator' });
      items.push({
        key: `remove-${activePlaylist.id}`,
        label: `Remove from "${activePlaylist.name}"`,
        icon: Trash2,
        danger: true,
        onClick: () =>
          onRemoveTrackFromPlaylist?.(activePlaylist.id, trackKey, track),
      });
    }

    return items;
  }, [
    rowContextMenu,
    playlists,
    mostRecentPlaylistId,
    activePlaylist,
    tracks.length,
    onAddTrackToPlaylist,
    onRemoveTrackFromPlaylist,
    onCreatePlaylistWithTrack,
    onMovePlaylistTrack,
    onInspectArtwork,
    currentTrack,
    isPlaying,
    playTrack,
    togglePlayPause,
    table,
    searchQuery,
    filterMissingArt,
  ]);

  return (
    <div className="flex-1 flex flex-col min-w-0 min-h-0 bg-white dark:bg-zinc-950 transition-colors">
      {/* Sub-toolbar: View Context & Instant Search */}
      <div className="px-6 py-3 bg-zinc-50 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 flex flex-wrap items-center justify-between gap-4 transition-colors">
        <div className="flex flex-wrap items-center gap-2.5 text-xs text-zinc-600 dark:text-zinc-400 font-mono">
          {activePlaylist ? (
            <>
              <ListMusic className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
              <span>
                PLAYLIST:{' '}
                <strong className="text-amber-600 dark:text-amber-300">{activePlaylist.name}</strong>{' '}
                • <strong className="text-zinc-800 dark:text-zinc-200">{tracks.length}</strong>{' '}
                {tracks.length === 1 ? 'TRACK' : 'TRACKS'}
              </span>
              <span className="hidden sm:inline-block px-2 py-0.5 rounded bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 text-[10px] text-cyan-600 dark:text-cyan-400">
                {activePlaylist.name}.m3u
              </span>
              {isCustomSortedOrFiltered ? (
                <button
                  type="button"
                  onClick={() => {
                    setSorting([]);
                    onSearchChange('');
                    onClearMissingArtFilter?.();
                  }}
                  className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 text-[10px] hover:bg-amber-500/25 transition cursor-pointer"
                >
                  Reset Sort/Filter to Reorder
                </button>
              ) : (
                <span className="hidden md:inline-block text-[10px] text-zinc-400 dark:text-zinc-500">
                  Drag rows or right-click to reorder playback
                </span>
              )}
            </>
          ) : (
            <>
              <Disc3 className="w-4 h-4 text-amber-500 dark:text-amber-400 shrink-0" />
              <span>
                MASTER LIBRARY •{' '}
                <strong className="text-zinc-800 dark:text-zinc-200">{tracks.length}</strong>{' '}
                {tracks.length === 1 ? 'TRACK' : 'TRACKS'} SHOWN
              </span>
            </>
          )}

          {filterMissingArt && (
            <button
              type="button"
              onClick={() => onClearMissingArtFilter?.()}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-700 dark:text-amber-300 hover:bg-amber-500/25 text-[11px] font-mono transition cursor-pointer"
              title="Clear missing artwork filter"
            >
              <span>Filter: Missing Artwork</span>
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        <div className="relative w-full max-w-md">
          <Search className="w-4 h-4 text-zinc-400 dark:text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={
              activePlaylist
                ? `Filter "${activePlaylist.name}" by Artist, Album, Title…`
                : 'Filter Library by Artist, Album, Title, or DiscTrack (e.g. 103)…'
            }
            className="w-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border border-zinc-300 dark:border-zinc-700 focus:border-amber-500 dark:focus:border-amber-500 rounded-full pl-9 pr-8 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/20 transition"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => onSearchChange('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 cursor-pointer"
              aria-label="Clear search"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Table Scroll Container */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 w-full overflow-x-auto overflow-y-auto min-h-0 bg-white dark:bg-zinc-950"
      >
        {tracks.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-12 text-zinc-400 dark:text-zinc-500">
            {filterMissingArt && !searchQuery ? (
              <>
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mb-3 shadow-inner">
                  <CheckCircle2 className="w-7 h-7 text-emerald-500 dark:text-emerald-400" />
                </div>
                <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  All tracks in this view have album artwork!
                </p>
                <p className="text-xs text-zinc-500 mt-1 max-w-md">
                  Every track in{' '}
                  {activePlaylist
                    ? `playlist "${activePlaylist.name}"`
                    : 'your Master Library'}{' '}
                  already has embedded cover art.
                </p>
                <button
                  type="button"
                  onClick={() => onClearMissingArtFilter?.()}
                  className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 shadow-sm transition cursor-pointer"
                >
                  <span>Clear Filter</span>
                </button>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-2xl bg-zinc-100 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 flex items-center justify-center mb-3 shadow-inner">
                  {activePlaylist ? (
                    <ListMusic className="w-7 h-7 text-amber-500 dark:text-amber-500/60" />
                  ) : (
                    <Music className="w-7 h-7 text-zinc-400 dark:text-zinc-600" />
                  )}
                </div>
                <p className="text-sm font-medium text-zinc-800 dark:text-zinc-300">
                  {searchQuery
                    ? 'No matching tracks found'
                    : activePlaylist
                    ? `Playlist "${activePlaylist.name}" has no tracks yet`
                    : 'Your Flat Audiophile Vault is currently empty'}
                </p>
                <p className="text-xs text-zinc-500 mt-1 max-w-md">
                  {searchQuery
                    ? 'Try clearing the search filter above.'
                    : activePlaylist
                    ? 'Switch to "Library" in the left sidebar and right-click any track row to add tracks to this playlist.'
                    : 'Click "Scan & Ingest" in the control bar to recursively parse DRM-free tracks from your Master Music Source.'}
                </p>
                {(searchQuery || filterMissingArt) && (
                  <button
                    type="button"
                    onClick={() => {
                      onSearchChange('');
                      onClearMissingArtFilter?.();
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 transition cursor-pointer"
                  >
                    <span>Clear Filter</span>
                  </button>
                )}
              </>
            )}
          </div>
        ) : (
          <div style={{ minWidth: `${totalTableWidth}px`, width: 'max-content' }}>
            <table
              className="text-left border-collapse select-text table-fixed"
              style={{ width: `${totalTableWidth}px`, minWidth: `${totalTableWidth}px` }}
            >
              <colgroup>
                {visibleColumns.map((col) => {
                  const width =
                    col.id === 'artwork'
                      ? ARTWORK_COL_WIDTH
                      : colWidths[col.id] || col.columnDef.size || 150;
                  return <col key={col.id} style={{ width: `${width}px` }} />;
                })}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-zinc-100 dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-800 text-[11px] font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400">
                {table.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => {
                      const canSort = header.column.getCanSort();
                      const sorted = header.column.getIsSorted();
                      const colId = header.column.id;
                      const isArtworkCol = colId === 'artwork';
                      const limits = COLUMN_LIMITS[colId];
                      const isResizable = limits ? limits.resizable : false;
                      const width = isArtworkCol
                        ? ARTWORK_COL_WIDTH
                        : colWidths[colId] || header.column.columnDef.size || 150;

                      if (isArtworkCol) {
                        return (
                          <th
                            key={header.id}
                            style={{
                              width: `${ARTWORK_COL_WIDTH}px`,
                              minWidth: `${ARTWORK_COL_WIDTH}px`,
                              maxWidth: `${ARTWORK_COL_WIDTH}px`,
                            }}
                            aria-label="Cover Art"
                            className="w-[56px] min-w-[56px] max-w-[56px] shrink-0 p-0 select-none pointer-events-none overflow-hidden"
                          >
                            <span className="sr-only">Cover Art</span>
                          </th>
                        );
                      }

                      return (
                        <th
                          key={header.id}
                          style={{ width: `${width}px`, minWidth: `${width}px` }}
                          onClick={
                            canSort
                              ? header.column.getToggleSortingHandler()
                              : undefined
                          }
                          className={`relative px-4 py-2.5 select-none whitespace-nowrap overflow-hidden ${
                            canSort
                              ? 'cursor-pointer hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-200 transition'
                              : ''
                          }`}
                        >
                          <div className="flex items-center gap-1.5 pr-2 min-w-0">
                            <span className="truncate">
                              {flexRender(
                                header.column.columnDef.header,
                                header.getContext()
                              )}
                            </span>
                            {canSort &&
                              (sorted === 'asc' ? (
                                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 shrink-0">
                                  <ArrowUp className="w-3 h-3" />
                                  {(colId === 'albumTrack' || colId === 'artist') && (
                                    <span className="text-[10px] font-mono">A→Z</span>
                                  )}
                                </span>
                              ) : sorted === 'desc' ? (
                                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400 shrink-0">
                                  <ArrowDown className="w-3 h-3" />
                                  {(colId === 'albumTrack' || colId === 'artist') && (
                                    <span className="text-[10px] font-mono">Z→A</span>
                                  )}
                                </span>
                              ) : (
                                <ArrowUpDown className="w-3 h-3 opacity-30 shrink-0" />
                              ))}
                          </div>

                          {/* Interactive Drag & Double-Click Auto-Fit Resize Handle */}
                          {isResizable && (
                            <div
                              role="separator"
                              aria-orientation="vertical"
                              onMouseDown={(e) => handleResizeStart(colId, e)}
                              onDoubleClick={(e) => handleResizeDoubleClick(e, colId)}
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-0 bottom-0 w-3 cursor-col-resize select-none flex items-center justify-center group/resizer z-20 hover:bg-amber-500/20"
                              title="Drag to resize • Double-click to auto-fit"
                            >
                              <div className="w-[2px] h-3.5 bg-zinc-300 dark:bg-zinc-700 hover:bg-amber-500 rounded-full group-hover/resizer:bg-amber-500 dark:group-hover/resizer:bg-amber-400 group-hover/resizer:h-full group-active/resizer:bg-amber-500 dark:group-active/resizer:bg-amber-400 transition-all" />
                            </div>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                ))}
              </thead>
              <tbody className="text-sm">
                {topPaddingHeight > 0 && (
                  <tr aria-hidden="true">
                    <td
                      colSpan={columns.length}
                      style={{ height: `${topPaddingHeight}px`, padding: 0, border: 0 }}
                    />
                  </tr>
                )}
                {visibleRows.map((row, localIdx) => {
                  const idx = startIndex + localIdx;
                  const isContextSelected =
                    rowContextMenu?.track &&
                    (rowContextMenu.track.trackKey || rowContextMenu.track.filename) ===
                      (row.original.trackKey || row.original.filename);

                  const isBeingDragged = draggedIndex === idx;
                  const isDropTarget =
                    dragOverIndex === idx &&
                    draggedIndex !== null &&
                    draggedIndex !== idx;
                  const dropIndicatorClass = isDropTarget
                    ? draggedIndex > idx
                      ? 'border-t-2 border-amber-500 bg-amber-500/10'
                      : 'border-b-2 border-amber-500 bg-amber-500/10'
                    : '';

                  const rowKey =
                    row.original.trackKey ||
                    row.original.normalizedKey ||
                    row.original.filename;
                  const isCurrentActive =
                    currentTrack &&
                    (currentTrack.trackKey ||
                      currentTrack.normalizedKey ||
                      currentTrack.filename) === rowKey;
                  const isFlashActive = flashTrackKey && rowKey === flashTrackKey;
                  const isSelected = selectedTrackKey && selectedTrackKey === rowKey;

                  return (
                    <TrackRow
                      key={row.id}
                      row={row}
                      idx={idx}
                      isBeingDragged={isBeingDragged}
                      isDropTarget={isDropTarget}
                      isContextSelected={isContextSelected}
                      isCurrentActive={isCurrentActive}
                      isFlashActive={Boolean(isFlashActive)}
                      isSelected={Boolean(isSelected)}
                      isReorderEnabled={isReorderEnabled}
                      dropIndicatorClass={dropIndicatorClass}
                      onDragStart={handleDragStart}
                      onDragOver={handleDragOver}
                      onDragEnd={handleDragEnd}
                      onDrop={handleDrop}
                      onClick={handleRowClick}
                      onDoubleClick={handleRowDoubleClick}
                      onContextMenu={handleRowContextMenu}
                    />
                  );
                })}
                {bottomPaddingHeight > 0 && (
                  <tr aria-hidden="true">
                    <td
                      colSpan={columns.length}
                      style={{ height: `${bottomPaddingHeight}px`, padding: 0, border: 0 }}
                    />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Floating Track Row Context Menu */}
      {rowContextMenu && (
        <ContextMenu
          x={rowContextMenu.x}
          y={rowContextMenu.y}
          items={rowMenuItems}
          onClose={() => setRowContextMenu(null)}
        />
      )}
    </div>
  );
});

export default TrackTable;
