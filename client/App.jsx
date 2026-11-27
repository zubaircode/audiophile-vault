import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import {
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import Header from './components/Header.jsx';
import UnifiedControlBar, { formatBytes } from './components/UnifiedControlBar.jsx';
import SettingsModal from './components/SettingsModal.jsx';
import SyncModeModal from './components/SyncModeModal.jsx';
import Sidebar from './components/Sidebar.jsx';
import TrackTable from './components/TrackTable.jsx';
import LogViewer from './components/LogViewer.jsx';
import ArtworkModal, { findAlbumSiblingTracks } from './components/ArtworkModal.jsx';
import { PlayerProvider, useAudioPlayer } from './context/PlayerContext.jsx';
import { API_BASE } from './utils/api.js';
import {
  annotateCompilationCohorts,
  matchesTrackSearch,
  sortTracksByCompositeKey,
} from './utils/sorting.js';

function cleanPathInput(raw) {
  if (!raw || typeof raw !== 'string') return '';
  let str = raw.trim();
  const mangledMatch = str.match(
    /['"](\/(?:Users|Volumes|System|Library|private|tmp|var|opt)\/[^'"]+)['"]$/
  );
  if (mangledMatch) {
    str = mangledMatch[1].trim();
  }
  while (
    (str.startsWith("'") && str.endsWith("'")) ||
    (str.startsWith('"') && str.endsWith('"'))
  ) {
    str = str.slice(1, -1).trim();
  }
  return str.replace(/\\ /g, ' ');
}

function AppContent() {
  const { currentTrack, queueSource } = useAudioPlayer();
  const [config, setConfig] = useState({
    sourcePath: '~/Music/Music/Media.localized/Music/',
    vaultPath: '~/Music/AudiophileVault/',
    sdCardPath: '',
    exportPlaylistFolders: false,
    stats: {
      totalTracks: 0,
      totalBytes: 0,
      totalSizeGB: 0,
      tracksWithArtwork: 0,
    },
  });

  const [volumes, setVolumes] = useState([]);
  const [selectedVolumePath, setSelectedVolumePath] = useState('');
  const [ftpServices, setFtpServices] = useState([]);
  const [tracks, setTracks] = useState([]);
  const [searchQuery, setSearchQuery] = useState(() => {
    try {
      return localStorage.getItem('av_search_filter') || '';
    } catch {
      return '';
    }
  });
  const [filterMissingArt, setFilterMissingArt] = useState(() => {
    try {
      return localStorage.getItem('av_filter_missing_art') === 'true';
    } catch {
      return false;
    }
  });

  // Playlist state
  const [playlists, setPlaylists] = useState([]);
  const [mostRecentPlaylistId, setMostRecentPlaylistId] = useState(null);
  const [activePlaylistId, setActivePlaylistId] = useState(() => {
    try {
      return localStorage.getItem('av_active_playlist_id') || null;
    } catch {
      return null;
    }
  }); // null = Master Library

  // Selected track state for persistent table selection
  const [selectedTrackKey, setSelectedTrackKey] = useState(() => {
    try {
      return localStorage.getItem('av_selected_track_key') || null;
    } catch {
      return null;
    }
  });

  // Synchronize UI filter and selection states to localStorage
  useEffect(() => {
    try {
      if (searchQuery) {
        localStorage.setItem('av_search_filter', searchQuery);
      } else {
        localStorage.removeItem('av_search_filter');
      }
    } catch {}
  }, [searchQuery]);

  useEffect(() => {
    try {
      localStorage.setItem('av_filter_missing_art', String(filterMissingArt));
    } catch {}
  }, [filterMissingArt]);

  useEffect(() => {
    try {
      if (activePlaylistId) {
        localStorage.setItem('av_active_playlist_id', activePlaylistId);
      } else {
        localStorage.removeItem('av_active_playlist_id');
      }
    } catch {}
  }, [activePlaylistId]);

  useEffect(() => {
    try {
      if (selectedTrackKey) {
        localStorage.setItem('av_selected_track_key', selectedTrackKey);
      } else {
        localStorage.removeItem('av_selected_track_key');
      }
    } catch {}
  }, [selectedTrackKey]);

  // Manual Artwork Inspection & Override Modal state
  const [inspectingTrackKey, setInspectingTrackKey] = useState(null);

  // Pipeline state
  const [isIngesting, setIsIngesting] = useState(false);
  const [isFetchingArtwork, setIsFetchingArtwork] = useState(false);
  const [syncState, setSyncState] = useState({
    isSyncing: false,
    isCanceling: false,
    mode: 'sd',
    phase: 'idle',
    currentFile: null,
    processedCount: 0,
    totalCount: 0,
  });
  const isSyncing = Boolean(syncState.isSyncing);
  const [isEjecting, setIsEjecting] = useState(false);

  // Console & Toast feedback
  const [logs, setLogs] = useState([]);
  const [isConsoleOpen, setIsConsoleOpen] = useState(false);
  const [ toast, setToast ] = useState(null); // { message, type: 'success' | 'error' }
  const toastTimerRef = useRef(null);
  const selectedVolumePathRef = useRef('');
  const logQueueRef = useRef([]);
  const logFlushRafRef = useRef(null);
  const importEventsRef = useRef(null);
  const artworkEventsRef = useRef(null);
  const syncEventsRef = useRef(null);
  const seenIngestEventIdsRef = useRef(new Set());

  useEffect(() => {
    selectedVolumePathRef.current = selectedVolumePath;
  }, [selectedVolumePath]);

  // Settings Modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSyncModeModalOpen, setIsSyncModeModalOpen] = useState(false);

  const showToast = useCallback((message, type = 'success') => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => {
      setToast(null);
    }, 3200);
  }, []);

  // Batched log appender: coalesces rapid SSE lines into at most one React state update per animation frame
  const appendLog = useCallback((entry) => {
    logQueueRef.current.push({
      timestamp: entry.timestamp || new Date().toISOString(),
      type: entry.type || 'INFO',
      message: entry.message || '',
    });

    if (!logFlushRafRef.current) {
      logFlushRafRef.current = window.requestAnimationFrame(() => {
        logFlushRafRef.current = null;
        if (logQueueRef.current.length === 0) return;
        const batch = logQueueRef.current;
        logQueueRef.current = [];
        setLogs((prev) => [...prev, ...batch].slice(-1000));
      });
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/config`);
      if (!res.ok) return;
      const data = await res.json();
      setConfig(data);
      setDraftSourcePath(data.sourcePath || '');
      setDraftVaultPath(data.vaultPath || '');
      if (data.status) {
        setIsIngesting(Boolean(data.status.isIngesting));
        setIsFetchingArtwork(Boolean(data.status.isFetchingArtwork));
        if (typeof data.status.isSyncing === 'boolean') {
          setSyncState((prev) => ({ ...prev, isSyncing: Boolean(data.status.isSyncing) }));
        }
      }
      if (data.sdCardPath) {
        setSelectedVolumePath((prev) => prev || data.sdCardPath);
      }
    } catch (err) {
      console.error('Failed to load config:', err);
    }
  }, []);

  const fetchVolumes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/volumes`);
      if (!res.ok) return;
      const data = await res.json();
      const list = data.volumes || [];

      // Only update `volumes` state if the mounted volume list or free space actually changed
      setVolumes((prev) => {
        if (
          prev.length === list.length &&
          prev.every(
            (v, i) =>
              v.path === list[i].path &&
              v.name === list[i].name &&
              v.freeSpace === list[i].freeSpace &&
              v.totalSpace === list[i].totalSpace
          )
        ) {
          return prev;
        }
        return list;
      });

      if (list.length > 0) {
        const currentSelected = selectedVolumePathRef.current || '';
        const matchedVol = list.find(
          (v) => v.path === currentSelected || currentSelected.startsWith(`${v.path}/`)
        );
        if (matchedVol) {
          if (matchedVol.path !== currentSelected) {
            setSelectedVolumePath(matchedVol.path);
          }
        } else {
          const nextPath = list[0].path;
          if (nextPath !== currentSelected) {
            setSelectedVolumePath(nextPath);
            fetch(`${API_BASE}/api/config`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sdCardPath: nextPath }),
            })
              .then((r) => (r.ok ? r.json() : null))
              .then((updated) => {
                if (updated) {
                  setConfig((prev) => ({ ...prev, ...updated }));
                }
              })
              .catch(() => {});
          }
        }
      } else {
        setSelectedVolumePath((prev) => (prev === '' ? prev : ''));
      }
    } catch (err) {
      console.error('Failed to load volumes:', err);
    }
  }, []);

  const fetchTracks = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/tracks`);
      if (!res.ok) return;
      const data = await res.json();
      setTracks(data.tracks || []);
    } catch (err) {
      console.error('Failed to load tracks:', err);
    }
  }, []);

  const fetchPlaylists = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/playlists`);
      if (!res.ok) return;
      const data = await res.json();
      const list = data.playlists || [];
      setPlaylists(list);
      setMostRecentPlaylistId(data.mostRecentPlaylistId || null);

      // Validate restored activePlaylistId against fetched playlists
      setActivePlaylistId((currentId) => {
        if (!currentId) return null;
        const exists = list.some((p) => p.id === currentId);
        if (!exists) {
          try {
            localStorage.removeItem('av_active_playlist_id');
          } catch {}
          return null;
        }
        return currentId;
      });
    } catch (err) {
      console.error('Failed to load playlists:', err);
    }
  }, []);

  const fetchFtpServices = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/ftp/services`);
      if (!res.ok) return;
      const data = await res.json();
      setFtpServices(Array.isArray(data.services) ? data.services : []);
    } catch {
      // Ignore transient bridge errors
    }
  }, []);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/sync/status`);
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof data === 'object') {
        setSyncState((prev) => ({ ...prev, ...data }));
      }
    } catch {
      // Ignore transient bridge errors
    }
  }, []);

  // Initial load + periodic volume/Bonjour polling (every 8s)
  useEffect(() => {
    (async () => {
      await fetchConfig();
      await fetchSyncStatus();
      await fetchVolumes();
      await fetchFtpServices();
    })();
    fetchTracks();
    fetchPlaylists();

    window.__avNotifyFtpServices = (list) => {
      setFtpServices(Array.isArray(list) ? list : []);
    };
    window.__avNotifySyncState = (next) => {
      if (next && typeof next === 'object') {
        setSyncState((prev) => ({ ...prev, ...next }));
      }
    };

    const handleFocus = () => {
      fetchSyncStatus();
    };
    window.addEventListener('focus', handleFocus);

    const interval = setInterval(() => {
      fetchVolumes();
      fetchFtpServices();
    }, 8000);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
      if (window.__avNotifyFtpServices) {
        delete window.__avNotifyFtpServices;
      }
      if (window.__avNotifySyncState) {
        delete window.__avNotifySyncState;
      }
    };
  }, [fetchConfig, fetchSyncStatus, fetchVolumes, fetchFtpServices, fetchTracks, fetchPlaylists]);

  const connectIngestStream = useCallback(
    ({ replay = false } = {}) => {
      if (importEventsRef.current) {
        try {
          importEventsRef.current.close();
        } catch {
          // Ignore
        }
      }

      const url = replay
        ? `${API_BASE}/api/import/progress?replay=1`
        : `${API_BASE}/api/import/progress`;
      const importEvents = new EventSource(url);
      importEventsRef.current = importEvents;

      importEvents.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          if (payload.type === 'CONNECTED') return;

          if (payload.id) {
            if (seenIngestEventIdsRef.current.has(payload.id)) return;
            seenIngestEventIdsRef.current.add(payload.id);
          }

          appendLog(payload);

          if (payload.type === 'INGEST' && payload.track) {
            setTracks((prev) => [payload.track, ...prev]);
          }
          if (payload.type === 'DONE' || payload.type === 'ERROR') {
            setIsIngesting(false);
            fetchConfig();
            fetchTracks();
          }
        } catch {
          // Ignore malformed SSE lines
        }
      };

      return importEvents;
    },
    [appendLog, fetchConfig, fetchTracks]
  );

  // Connect to SSE streams (/api/import/progress, /api/artwork/progress, and /api/sync/progress)
  useEffect(() => {
    const importEvents = connectIngestStream({ replay: true });

    const artworkEvents = new EventSource(`${API_BASE}/api/artwork/progress`);
    artworkEventsRef.current = artworkEvents;
    artworkEvents.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'CONNECTED') return;
        appendLog(payload);

        // Live-update individual or batch track artwork status as covers are downloaded, uploaded, or removed
        if (Array.isArray(payload.affectedTrackKeys) && payload.affectedTrackKeys.length > 0) {
          const affectedSet = new Set(payload.affectedTrackKeys);
          const nowTs = Date.now();
          setTracks((prev) =>
            prev.map((t) => {
              const key = t.trackKey || t.normalizedKey || t.filename;
              if (affectedSet.has(key)) {
                return {
                  ...t,
                  hasArtwork: Boolean(payload.hasArtwork),
                  artworkUpdatedAt: nowTs,
                };
              }
              return t;
            })
          );
        } else if (payload.trackKey && typeof payload.hasArtwork === 'boolean') {
          const nowTs = Date.now();
          setTracks((prev) =>
            prev.map((t) => {
              const key = t.trackKey || t.normalizedKey || t.filename;
              if (key === payload.trackKey) {
                return {
                  ...t,
                  hasArtwork: payload.hasArtwork,
                  artworkFilename: payload.artworkFilename || t.artworkFilename,
                  artworkUpdatedAt: nowTs,
                };
              }
              return t;
            })
          );
        }

        if (payload.type === 'DONE' || payload.type === 'ERROR') {
          setIsFetchingArtwork(false);
          fetchConfig();
          fetchTracks();
          if (payload.summary) {
            const s = payload.summary;
            showToast(
              s.stopped
                ? `Artwork stopped (${s.downloaded + s.cached} saved, ${s.skipped} skipped)`
                : `Artwork complete (${s.downloaded + s.cached} saved, ${s.skipped} skipped)`
            );
          }
        }
      } catch {
        // Ignore malformed SSE lines
      }
    };

    const syncEvents = new EventSource(`${API_BASE}/api/sync/progress`);
    syncEventsRef.current = syncEvents;
    syncEvents.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'CONNECTED') return;
        appendLog(payload);

        if (payload.type === 'DONE' || payload.type === 'ERROR') {
          setSyncState((prev) => ({
            ...prev,
            isSyncing: false,
            isCanceling: false,
            phase: payload.type === 'ERROR' ? 'error' : 'done',
          }));
          fetchVolumes();
        }
      } catch {
        // Ignore malformed SSE lines
      }
    };

    return () => {
      importEvents.close();
      artworkEvents.close();
      syncEvents.close();
    };
  }, [appendLog, connectIngestStream, fetchConfig, fetchTracks, fetchVolumes, showToast]);

  // Watchdog while background jobs are running so if an SSE socket ever drops across a server reload,
  // buffered logs are replayed and spinner states never get stuck.
  useEffect(() => {
    if (!isIngesting && !isFetchingArtwork && !isSyncing) return undefined;

    const timer = setInterval(async () => {
      try {
        const res = await fetch('/api/config');
        if (!res.ok) return;
        const data = await res.json();
        if (!data.status) return;

        if (isIngesting && !data.status.isIngesting) {
          connectIngestStream({ replay: true });
          setIsIngesting(false);
          fetchTracks();
        }
        if (isFetchingArtwork && !data.status.isFetchingArtwork) {
          setIsFetchingArtwork(false);
          fetchTracks();
        }
        if (isSyncing && !data.status.isSyncing) {
          setIsSyncing(false);
          fetchVolumes();
        }
      } catch {
        // Ignore transient network errors
      }
    }, 2500);

    return () => clearInterval(timer);
  }, [
    isIngesting,
    isFetchingArtwork,
    isSyncing,
    connectIngestStream,
    fetchTracks,
    fetchVolumes,
  ]);

  // ==================================================
  // PLAYLIST CRUD & REORDER HANDLERS
  // ==================================================

  const handleCreatePlaylist = useCallback(
    async (customName) => {
      try {
        const res = await fetch(`${API_BASE}/api/playlists`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(customName ? { name: customName } : {}),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to create playlist');
        }
        setPlaylists(data.playlists || []);
        setMostRecentPlaylistId(data.mostRecentPlaylistId || data.playlist?.id);
        const msg = `[PLAYLIST] Created "${data.playlist.name}" -> ${data.playlist.name}.m3u`;
        appendLog({ type: 'PLAYLIST', message: msg });
        showToast(`Created "${data.playlist.name}"`);
        return data.playlist;
      } catch (err) {
        appendLog({ type: 'ERROR', message: `[ERROR] ${err.message}` });
        showToast(err.message, 'error');
        return null;
      }
    },
    [appendLog, showToast]
  );

  const handleRenamePlaylist = useCallback(
    async (playlistId, newName) => {
      try {
        const res = await fetch(`${API_BASE}/api/playlists/${encodeURIComponent(playlistId)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName }),
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to rename playlist');
        }
        setPlaylists(data.playlists || []);
        setMostRecentPlaylistId(data.mostRecentPlaylistId || playlistId);
        const msg = `[PLAYLIST] Renamed playlist to "${data.playlist.name}"`;
        appendLog({ type: 'PLAYLIST', message: msg });
        showToast(`Renamed to "${data.playlist.name}"`);
      } catch (err) {
        appendLog({ type: 'ERROR', message: `[ERROR] ${err.message}` });
        showToast(err.message, 'error');
      }
    },
    [appendLog, showToast]
  );

  const handleDuplicatePlaylist = useCallback(
    async (playlistId) => {
      try {
        const res = await fetch(
          `${API_BASE}/api/playlists/${encodeURIComponent(playlistId)}/duplicate`,
          { method: 'POST' }
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to duplicate playlist');
        }
        setPlaylists(data.playlists || []);
        setMostRecentPlaylistId(data.mostRecentPlaylistId || data.playlist?.id);
        const msg = `[PLAYLIST] Duplicated as "${data.playlist.name}" (${data.playlist.trackKeys.length} tracks)`;
        appendLog({ type: 'PLAYLIST', message: msg });
        showToast(`Created copy "${data.playlist.name}"`);
      } catch (err) {
        appendLog({ type: 'ERROR', message: `[ERROR] ${err.message}` });
        showToast(err.message, 'error');
      }
    },
    [appendLog, showToast]
  );

  const handleDeletePlaylist = useCallback(
    async (playlistId, playlistName) => {
      try {
        const res = await fetch(`${API_BASE}/api/playlists/${encodeURIComponent(playlistId)}`, {
          method: 'DELETE',
        });
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to delete playlist');
        }
        setPlaylists(data.playlists || []);
        setMostRecentPlaylistId(data.mostRecentPlaylistId || null);
        if (activePlaylistId === playlistId) {
          setActivePlaylistId(null);
        }
        const msg = `[PLAYLIST] Deleted "${playlistName || data.name}" and removed .m3u file`;
        appendLog({ type: 'PLAYLIST', message: msg });
        showToast(`Deleted "${playlistName || data.name}"`);
      } catch (err) {
        appendLog({ type: 'ERROR', message: `[ERROR] ${err.message}` });
        showToast(err.message, 'error');
      }
    },
    [activePlaylistId, appendLog, showToast]
  );

  const handleAddTrackToPlaylist = useCallback(
    async (playlistId, trackKey, trackObj) => {
      try {
        const res = await fetch(
          `${API_BASE}/api/playlists/${encodeURIComponent(playlistId)}/tracks`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackKey }),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to add track to playlist');
        }
        setPlaylists(data.playlists || []);
        setMostRecentPlaylistId(data.mostRecentPlaylistId || playlistId);

        const trackTitle = trackObj?.title || data.track?.title || trackKey;
        const plName = data.playlist?.name || 'Playlist';

        if (data.alreadyExists) {
          const msg = `[PLAYLIST] "${trackTitle}" is already in "${plName}"`;
          appendLog({ type: 'SKIPPED', message: msg });
          showToast(`"${trackTitle}" is already in "${plName}"`);
        } else {
          const msg = `[PLAYLIST] Added "${trackTitle}" to "${plName}"`;
          appendLog({ type: 'PLAYLIST', message: msg });
          showToast(`Added "${trackTitle}" to "${plName}"`);
        }
      } catch (err) {
        appendLog({ type: 'ERROR', message: `[ERROR] ${err.message}` });
        showToast(err.message, 'error');
      }
    },
    [appendLog, showToast]
  );

  const handleRemoveTrackFromPlaylist = useCallback(
    async (playlistId, trackKey, trackObj) => {
      try {
        const res = await fetch(
          `${API_BASE}/api/playlists/${encodeURIComponent(playlistId)}/tracks/${encodeURIComponent(
            trackKey
          )}`,
          { method: 'DELETE' }
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to remove track from playlist');
        }
        setPlaylists(data.playlists || []);
        const trackTitle = trackObj?.title || data.track?.title || trackKey;
        const plName = data.playlist?.name || 'Playlist';
        const msg = `[PLAYLIST] Removed "${trackTitle}" from "${plName}"`;
        appendLog({ type: 'PLAYLIST', message: msg });
        showToast(`Removed "${trackTitle}" from "${plName}"`);
      } catch (err) {
        appendLog({ type: 'ERROR', message: `[ERROR] ${err.message}` });
        showToast(err.message, 'error');
      }
    },
    [appendLog, showToast]
  );

  const handleCreatePlaylistWithTrack = useCallback(
    async (trackObj) => {
      const created = await handleCreatePlaylist();
      if (created && trackObj) {
        const key = trackObj.trackKey || trackObj.normalizedKey || trackObj.filename;
        await handleAddTrackToPlaylist(created.id, key, trackObj);
      }
    },
    [handleCreatePlaylist, handleAddTrackToPlaylist]
  );

  const handleReorderPlaylistTracks = useCallback(
    async (playlistId, nextTrackKeys, fromIndex, toIndex) => {
      let previousPlaylistsSnapshot = null;

      setPlaylists((prev) => {
        previousPlaylistsSnapshot = prev;
        return prev.map((pl) =>
          pl.id === playlistId ? { ...pl, trackKeys: [...nextTrackKeys] } : pl
        );
      });

      try {
        const res = await fetch(
          `${API_BASE}/api/playlists/${encodeURIComponent(playlistId)}/reorder`,
          {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              trackKeys: nextTrackKeys,
              fromIndex,
              toIndex,
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to reorder playlist tracks');
        }
        setPlaylists(data.playlists || []);
        const plName = data.playlist?.name || 'Playlist';
        const msg = `[PLAYLIST] Reordered "${plName}" (#${fromIndex + 1} -> #${toIndex + 1}) & updated .m3u`;
        appendLog({ type: 'PLAYLIST', message: msg });
        showToast(`Updated playback order in "${plName}"`);
      } catch (err) {
        if (previousPlaylistsSnapshot) {
          setPlaylists(previousPlaylistsSnapshot);
        }
        appendLog({
          type: 'ERROR',
          message: `[ERROR] Reorder failed, reverted state: ${err.message}`,
        });
        showToast(`Reorder failed: ${err.message}`, 'error');
      }
    },
    [appendLog, showToast]
  );

  const handleMovePlaylistTrack = useCallback(
    async (playlistId, trackKey, direction, trackObj) => {
      let previousPlaylistsSnapshot = null;

      setPlaylists((prev) => {
        previousPlaylistsSnapshot = prev;
        return prev.map((pl) => {
          if (pl.id !== playlistId) return pl;
          const keys = Array.isArray(pl.trackKeys) ? [...pl.trackKeys] : [];
          const idx = keys.indexOf(trackKey);
          if (idx === -1) return pl;
          const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
          if (targetIdx < 0 || targetIdx >= keys.length) return pl;
          const temp = keys[idx];
          keys[idx] = keys[targetIdx];
          keys[targetIdx] = temp;
          return { ...pl, trackKeys: keys };
        });
      });

      try {
        const res = await fetch(
          `${API_BASE}/api/playlists/${encodeURIComponent(playlistId)}/move`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackKey, direction }),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Failed to move track');
        }
        setPlaylists(data.playlists || []);
        const trackTitle = trackObj?.title || trackKey;
        const plName = data.playlist?.name || 'Playlist';
        const msg = `[PLAYLIST] Moved "${trackTitle}" ${direction} in "${plName}" & updated .m3u`;
        appendLog({ type: 'PLAYLIST', message: msg });
        showToast(`Moved "${trackTitle}" ${direction}`);
      } catch (err) {
        if (previousPlaylistsSnapshot) {
          setPlaylists(previousPlaylistsSnapshot);
        }
        appendLog({
          type: 'ERROR',
          message: `[ERROR] Move track failed, reverted state: ${err.message}`,
        });
        showToast(`Move failed: ${err.message}`, 'error');
      }
    },
    [appendLog, showToast]
  );

  // ==================================================
  // ARTWORK BACKFILL & STOP HANDLERS
  // ==================================================

  const handleStartArtworkFetch = async () => {
    setIsConsoleOpen(true);
    setIsFetchingArtwork(true);
    try {
      const res = await fetch(`${API_BASE}/api/artwork/backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playlistId: activePlaylistId || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        setIsFetchingArtwork(false);
        appendLog({
          type: 'ERROR',
          message: `[ERROR] ${err.error || 'Could not start artwork lookup'}`,
        });
        showToast(err.error || 'Could not start artwork lookup', 'error');
      }
    } catch (err) {
      setIsFetchingArtwork(false);
      appendLog({
        type: 'ERROR',
        message: `[ERROR] Network error starting artwork lookup: ${err.message}`,
      });
    }
  };

  const handleFetchModalArtwork = async ({ track, applyToAlbum }) => {
    if (!track) return;
    const targetTracks = applyToAlbum ? findAlbumSiblingTracks(tracks, track) : [track];
    const targetKeys = targetTracks
      .map((t) => t.trackKey || t.normalizedKey || t.filename)
      .filter(Boolean);
    if (targetKeys.length === 0) return;

    setIsFetchingArtwork(true);
    try {
      const res = await fetch(`${API_BASE}/api/artwork/backfill`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackKeys: targetKeys }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setIsFetchingArtwork(false);
        const msg = err.error || 'Could not start artwork download';
        appendLog({ type: 'ERROR', message: `[ERROR] ${msg}` });
        showToast(msg, 'error');
        throw new Error(msg);
      }
    } catch (err) {
      setIsFetchingArtwork(false);
      throw err;
    }
  };

  const handleStopArtworkFetch = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/artwork/stop`, {
        method: 'POST',
      });
      const data = await res.json();
      if (data.stopped) {
        appendLog({
          type: 'ARTWORK',
          message: '[ARTWORK] Stop requested by user — halting after current item…',
        });
        showToast('Stopping artwork lookup…');
      } else {
        setIsFetchingArtwork(false);
      }
    } catch (err) {
      appendLog({
        type: 'ERROR',
        message: `[ERROR] Failed to stop artwork lookup: ${err.message}`,
      });
    }
  };

  // ==================================================
  // MANUAL ARTWORK OVERRIDE HANDLERS
  // ==================================================

  const handleUploadManualArtwork = useCallback(
    async ({ track, baseName, file, applyToAlbum, scope }) => {
      const targetKey =
        track?.trackKey || track?.normalizedKey || track?.filename || '';
      const resolvedScope = scope || (applyToAlbum ? 'album' : 'single');
      const formData = new FormData();
      formData.append('image', file);
      formData.append('scope', resolvedScope);
      formData.append('applyToAlbum', applyToAlbum ? 'true' : 'false');
      if (targetKey) formData.append('trackKey', targetKey);
      if (track?.artist) formData.append('artist', track.artist);
      if (track?.album) formData.append('album', track.album);

      const res = await fetch(`${API_BASE}/api/artwork/${encodeURIComponent(baseName)}`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        appendLog({
          type: 'ERROR',
          message: `[ERROR] Manual artwork upload failed: ${data.error || 'Unknown error'}`,
        });
        showToast(data.error || 'Failed to upload artwork', 'error');
        throw new Error(data.error || 'Failed to upload artwork');
      }

      const nowTs = data.updatedAt || Date.now();
      const affectedSet = new Set(data.affectedTrackKeys || []);
      if (targetKey) affectedSet.add(targetKey);

      setTracks((prev) => {
        if (applyToAlbum && track) {
          const siblings = findAlbumSiblingTracks(prev, track);
          for (const s of siblings) {
            const sKey = s.trackKey || s.normalizedKey || s.filename;
            if (sKey) affectedSet.add(sKey);
          }
        }
        return prev.map((t) => {
          const key = t.trackKey || t.normalizedKey || t.filename;
          const tBase = t.filename ? t.filename.replace(/\.[^/.]+$/, '') : '';
          if (affectedSet.has(key) || tBase === baseName) {
            return {
              ...t,
              hasArtwork: true,
              artworkEmbedded: true,
              artworkUpdatedAt: nowTs,
              updatedAt: nowTs,
            };
          }
          return t;
        });
      });

      fetchConfig();
      const updatedCount = Math.max(
        data.updatedCount || data.affectedCount || 1,
        affectedSet.size
      );
      showToast(
        updatedCount > 1
          ? `Embedded artwork across ${updatedCount} album tracks`
          : `Embedded artwork for "${track?.title || baseName}"`
      );
      return data;
    },
    [appendLog, fetchConfig, showToast]
  );

  const handleRemoveManualArtwork = useCallback(
    async ({ track, baseName, applyToAlbum = false, scope }) => {
      const targetKey =
        track?.trackKey || track?.normalizedKey || track?.filename || '';
      const resolvedScope = scope || (applyToAlbum ? 'album' : 'single');
      const params = new URLSearchParams();
      if (targetKey) params.set('trackKey', targetKey);
      params.set('scope', resolvedScope);
      if (applyToAlbum) params.set('applyToAlbum', 'true');
      if (track?.artist) params.set('artist', track.artist);
      if (track?.album) params.set('album', track.album);

      const url = `${API_BASE}/api/artwork/${encodeURIComponent(baseName)}?${params.toString()}`;
      let res = await fetch(url, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          baseName,
          trackKey: targetKey,
          scope: resolvedScope,
          applyToAlbum: Boolean(applyToAlbum),
          artist: track?.artist || '',
          album: track?.album || '',
        }),
      });

      // Fallback to POST /api/artwork/:baseName/delete if DELETE was intercepted or returned 404/405
      if (res.status === 404 || res.status === 405) {
        res = await fetch(
          `${API_BASE}/api/artwork/${encodeURIComponent(baseName)}/delete`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              baseName,
              trackKey: targetKey,
              scope: resolvedScope,
              applyToAlbum: Boolean(applyToAlbum),
              artist: track?.artist || '',
              album: track?.album || '',
            }),
          }
        );
      }

      let data = {};
      try {
        data = await res.json();
      } catch {
        data = {};
      }

      if (!res.ok) {
        appendLog({
          type: 'ERROR',
          message: `[ERROR] Remove artwork failed: ${data.error || `HTTP ${res.status}`}`,
        });
        showToast(data.error || 'Failed to remove artwork', 'error');
        throw new Error(data.error || 'Failed to remove artwork');
      }

      const nowTs = data.updatedAt || Date.now();
      const affectedSet = new Set(data.affectedTrackKeys || []);
      if (targetKey) affectedSet.add(targetKey);

      setTracks((prev) => {
        if (applyToAlbum && track) {
          const siblings = findAlbumSiblingTracks(prev, track);
          for (const s of siblings) {
            const sKey = s.trackKey || s.normalizedKey || s.filename;
            if (sKey) affectedSet.add(sKey);
          }
        }
        return prev.map((t) => {
          const key = t.trackKey || t.normalizedKey || t.filename;
          const tBase = t.filename ? t.filename.replace(/\.[^/.]+$/, '') : '';
          if (affectedSet.has(key) || tBase === baseName) {
            return {
              ...t,
              hasArtwork: false,
              artworkEmbedded: false,
              artworkUpdatedAt: nowTs,
              updatedAt: nowTs,
            };
          }
          return t;
        });
      });

      fetchConfig();
      const removedCount = Math.max(
        data.removedCount || data.affectedCount || 1,
        affectedSet.size
      );
      showToast(
        removedCount > 1
          ? `Removed embedded artwork across ${removedCount} album tracks`
          : `Removed embedded artwork for "${track?.title || baseName}"`
      );
      return data;
    },
    [appendLog, fetchConfig, showToast]
  );

  // ==================================================
  // DIRECTORY & SYNC HANDLERS
  // ==================================================

  const handleOpenSettings = () => {
    setIsSettingsOpen(true);
  };

  const handleBrowseFolder = async (targetField) => {
    try {
      if (window.electronAPI?.selectDirectory) {
        const selected = await window.electronAPI.selectDirectory();
        if (selected) {
          return cleanPathInput(selected);
        }
        return null;
      }
      const prompt =
        targetField === 'source'
          ? 'Select Master Music Source Folder'
          : targetField === 'target'
          ? 'Select Target SD Card Folder'
          : 'Select Flat Vault Staging Folder';
      const res = await fetch(`${API_BASE}/api/pick-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.path && !data.cancelled) {
        return cleanPathInput(data.path);
      }
      return null;
    } catch (err) {
      console.error('Folder picker error:', err);
      return null;
    }
  };

  const handleSaveSettings = async (newConfig) => {
    try {
      const cleanedPayload = {
        sourcePath: cleanPathInput(newConfig.sourcePath),
        vaultPath: cleanPathInput(newConfig.vaultPath),
        sdCardPath: cleanPathInput(newConfig.sdCardPath || newConfig.targetPath),
        syncTargetMode: newConfig.syncTargetMode === 'ftp' ? 'ftp' : 'sd',
        ftpServiceName: (newConfig.ftpServiceName || 'WiFiFTP').trim(),
        ftpManualHost: (newConfig.ftpManualHost || '').trim(),
        ftpManualPort: Number(newConfig.ftpManualPort) || 2121,
        ftpUsername: (newConfig.ftpUsername || '').trim(),
        ftpPassword: newConfig.ftpPassword || '',
        ftpRemotePath: (newConfig.ftpRemotePath || '/').trim() || '/',
      };
      const res = await fetch(`${API_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cleanedPayload),
      });
      if (res.ok) {
        const updated = await res.json();
        setConfig((prev) => ({ ...prev, ...updated }));
        if (cleanedPayload.sdCardPath) {
          const matchedVol = volumes.find(
            (v) =>
              v.path === cleanedPayload.sdCardPath ||
              cleanedPayload.sdCardPath.startsWith(`${v.path}/`)
          );
          const nextVolPath = matchedVol ? matchedVol.path : cleanedPayload.sdCardPath;
          if (nextVolPath !== selectedVolumePath) {
            setSelectedVolumePath(nextVolPath);
          }
        }
        appendLog({
          type: 'DONE',
          message: `[CONFIG] Saved settings — Source: ${updated.sourcePath} | Vault: ${updated.vaultPath}`,
        });
        setIsSettingsOpen(false);
        showToast('Settings saved successfully');
        fetchTracks();
        fetchPlaylists();
      } else {
        const errData = await res.json().catch(() => ({}));
        showToast(errData.error || 'Failed to save settings', 'error');
      }
    } catch (err) {
      console.error('Settings save error:', err);
      showToast('Error saving settings', 'error');
    }
  };

  const handleStartIngest = async () => {
    setIsConsoleOpen(true);
    setIsIngesting(true);

    // Ensure a fresh, active SSE connection to the backend before triggering POST /api/import
    connectIngestStream({ replay: false });

    try {
      const res = await fetch(`${API_BASE}/api/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) {
        const err = await res.json();
        setIsIngesting(false);
        appendLog({
          type: 'ERROR',
          message: `[ERROR] ${err.error || 'Could not start ingestion'}`,
        });
      }
    } catch (err) {
      setIsIngesting(false);
      appendLog({
        type: 'ERROR',
        message: `[ERROR] Network error starting ingest: ${err.message}`,
      });
    }
  };

  const handleStartSync = () => {
    if (isSyncing) {
      handleCancelSync();
      return;
    }
    const isFtpMode = config.syncTargetMode === 'ftp';
    if (!isFtpMode && !selectedVolumePath) return;
    setIsSyncModeModalOpen(true);
  };

  const handleConfirmSyncMode = async (layoutMode) => {
    setIsSyncModeModalOpen(false);
    const isMulti = layoutMode === 'multi';
    const isFtpMode = config.syncTargetMode === 'ftp';
    if (!isFtpMode && !selectedVolumePath) return;

    setConfig((prev) => ({ ...prev, exportPlaylistFolders: isMulti }));
    setIsConsoleOpen(true);
    setSyncState((prev) => ({
      ...prev,
      isSyncing: true,
      isCanceling: false,
      mode: isFtpMode ? 'ftp' : 'sd',
      phase: 'scanning',
      processedCount: 0,
      totalCount: 0,
    }));
    try {
      const res = await fetch(`${API_BASE}/api/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isFtpMode
            ? { syncTargetMode: 'ftp', syncLayoutMode: layoutMode, exportPlaylistFolders: isMulti }
            : { syncTargetMode: 'sd', volumePath: selectedVolumePath, syncLayoutMode: layoutMode, exportPlaylistFolders: isMulti }
        ),
      });
      if (!res.ok) {
        const err = await res.json();
        setSyncState((prev) => ({ ...prev, isSyncing: false, isCanceling: false, phase: 'error' }));
        appendLog({
          type: 'ERROR',
          message: `[ERROR] ${err.error || 'Could not start sync'}`,
        });
      }
    } catch (err) {
      setSyncState((prev) => ({ ...prev, isSyncing: false, isCanceling: false, phase: 'error' }));
      appendLog({
        type: 'ERROR',
        message: `[ERROR] Network error starting sync: ${err.message}`,
      });
    }
  };

  const handleCancelSync = async () => {
    if (!isSyncing) return;
    setSyncState((prev) => ({ ...prev, isCanceling: true, phase: 'canceling' }));
    try {
      await fetch(`${API_BASE}/api/sync/cancel`, { method: 'POST' });
    } catch (err) {
      appendLog({
        type: 'ERROR',
        message: `[ERROR] Failed to cancel sync: ${err.message}`,
      });
    }
  };

  const handleEjectVolume = async () => {
    if (!selectedVolumePath) return;
    setIsEjecting(true);
    setIsConsoleOpen(true);
    try {
      const res = await fetch(`${API_BASE}/api/eject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ volumePath: selectedVolumePath }),
      });
      const data = await res.json();
      if (!res.ok) {
        appendLog({
          type: 'ERROR',
          message: `[ERROR] Eject failed: ${data.error || 'Unknown error'}`,
        });
      } else {
        appendLog({
          type: 'DONE',
          message: `[DONE] Safe to remove SD card: ${data.output}`,
        });
        setSelectedVolumePath('');
        await fetchVolumes();
      }
    } catch (err) {
      appendLog({
        type: 'ERROR',
        message: `[ERROR] Eject request failed: ${err.message}`,
      });
    } finally {
      setIsEjecting(false);
    }
  };

  // ==================================================
  // DERIVED VIEW DATA (LIBRARY VS. ACTIVE PLAYLIST)
  // ==================================================

  const activePlaylist = useMemo(
    () => playlists.find((p) => p.id === activePlaylistId) || null,
    [playlists, activePlaylistId]
  );

  // Annotate multi-artist compilation cohorts across the full library so compilation
  // tracks retain `isCompilation: true` even when filtered by search or missing artwork.
  const annotatedLibraryTracks = useMemo(
    () => annotateCompilationCohorts(tracks),
    [tracks]
  );

  // Base track list for the active view (Master Library vs. Selected Playlist)
  const baseScopeTracks = useMemo(() => {
    if (!activePlaylist) return annotatedLibraryTracks;
    const trackByKey = new Map();
    for (const t of annotatedLibraryTracks) {
      const key = t.trackKey || t.normalizedKey || t.filename;
      if (key) trackByKey.set(key, t);
    }
    return (activePlaylist.trackKeys || [])
      .map((k) => trackByKey.get(k))
      .filter(Boolean);
  }, [annotatedLibraryTracks, activePlaylist]);

  // Artwork coverage metric ({X} of {Y} tracks have cover art ({Percentage}%))
  const artworkStats = useMemo(() => {
    const total = baseScopeTracks.length;
    const withArt = baseScopeTracks.filter((t) => Boolean(t.hasArtwork)).length;
    const missing = Math.max(0, total - withArt);
    const pct = total > 0 ? Math.round((withArt / total) * 100) : 0;
    return { withArt, total, missing, pct };
  }, [baseScopeTracks]);

  // Composite filtered track list: Playlist scope -> Missing Artwork toggle -> Tolerant search -> Composite collation
  const visibleTracks = useMemo(() => {
    let list = baseScopeTracks;

    if (filterMissingArt) {
      list = list.filter((t) => !t.hasArtwork);
    }

    const hasSearch = Boolean(searchQuery && searchQuery.trim());
    if (hasSearch) {
      list = list.filter((t) => matchesTrackSearch(t, searchQuery));
    }

    // When in Master Library view or when searching an artist/album, sort using the
    // composite sort key (article-stripped Artist | Album | DiscTrack) so all tracks
    // for each album group together in track sequence order.
    if (!activePlaylist || hasSearch) {
      return sortTracksByCompositeKey(list, 'asc');
    }

    return list;
  }, [baseScopeTracks, filterMissingArt, searchQuery, activePlaylist]);

  // Currently inspected track for the Manual Artwork Modal
  const inspectingTrack = useMemo(() => {
    if (!inspectingTrackKey) return null;
    return (
      tracks.find(
        (t) =>
          (t.trackKey || t.normalizedKey || t.filename) === inspectingTrackKey
      ) || null
    );
  }, [tracks, inspectingTrackKey]);

  const inspectingAlbumTrackCount = useMemo(() => {
    if (!inspectingTrack) return 1;
    const siblings = findAlbumSiblingTracks(tracks, inspectingTrack);
    return Math.max(1, siblings.length);
  }, [tracks, inspectingTrack]);

  const activeVolume =
    volumes.find(
      (v) => v.path === selectedVolumePath || selectedVolumePath.startsWith(`${v.path}/`)
    ) || null;

  const handleSelectVolume = useCallback((val) => {
    setSelectedVolumePath(val);
    fetch(`${API_BASE}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdCardPath: val }),
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((updated) => {
        if (updated) {
          setConfig((prev) => ({ ...prev, ...updated }));
        }
      })
      .catch(() => {});
  }, []);

  const handleSelectLibrary = useCallback(() => {
    setActivePlaylistId(null);
  }, []);

  const handleSelectPlaylist = useCallback((id) => {
    setActivePlaylistId(id);
  }, []);

  const [scrollToTrackKey, setScrollToTrackKey] = useState(null);

  const jumpToNowPlaying = useCallback(() => {
    if (!currentTrack || !queueSource) return;

    if (queueSource.type === 'playlist' && queueSource.id) {
      setActivePlaylistId(queueSource.id);
      setSearchQuery('');
      setFilterMissingArt(false);
    } else if (queueSource.type === 'search' && queueSource.query) {
      setActivePlaylistId(null);
      setSearchQuery(queueSource.query);
      setFilterMissingArt(false);
    } else if (queueSource.type === 'filter') {
      setActivePlaylistId(null);
      setSearchQuery('');
      setFilterMissingArt(true);
    } else {
      setActivePlaylistId(null);
      setSearchQuery('');
      setFilterMissingArt(false);
    }

    const targetKey =
      currentTrack.trackKey || currentTrack.normalizedKey || currentTrack.filename;
    setScrollToTrackKey(null);
    setTimeout(() => {
      setScrollToTrackKey(targetKey);
    }, 50);
  }, [currentTrack, queueSource]);

  const handleInspectArtwork = useCallback((track) => {
    setInspectingTrackKey(
      track.trackKey || track.normalizedKey || track.filename
    );
  }, []);

  const handleScrollToCurrentTrack = useCallback(
    (track) => {
      if (!track && !currentTrack) return;
      jumpToNowPlaying();
    },
    [currentTrack, jumpToNowPlaying]
  );

  const handleClearLogs = useCallback(() => {
    logQueueRef.current = [];
    setLogs([]);
  }, []);

  const handleToggleConsole = useCallback(() => {
    setIsConsoleOpen((prev) => !prev);
  }, []);

  const handleToggleMissingArtFilter = useCallback(() => {
    setFilterMissingArt((prev) => !prev);
  }, []);

  const handleClearMissingArtFilter = useCallback(() => {
    setFilterMissingArt(false);
  }, []);

  const isElectron =
    typeof window !== 'undefined' && Boolean(window.electronAPI?.isElectron);

  return (
    <div className="h-screen w-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 overflow-hidden transition-colors select-none">
      {/* 1. HEADER & UNIFIED STATS BAR (Integrated Window Drag & Traffic Lights) */}
      <Header
        vaultPath={config.vaultPath}
        totalTracks={tracks.length}
        artworkStats={artworkStats}
        filterMissingArt={filterMissingArt}
        onToggleMissingArtFilter={handleToggleMissingArtFilter}
        activePlaylist={activePlaylist}
        vaultBytes={config.stats?.totalBytes || 0}
        activeVolume={activeVolume}
        syncTargetMode={config.syncTargetMode || 'sd'}
        ftpServiceName={config.ftpServiceName || 'WiFiFTP'}
        ftpManualHost={config.ftpManualHost || ''}
        ftpServices={ftpServices}
        isWorking={isIngesting || isFetchingArtwork || isSyncing}
        isSyncing={isSyncing}
        isFetchingArtwork={isFetchingArtwork}
        onStartArtworkFetch={handleStartArtworkFetch}
        onStopArtworkFetch={handleStopArtworkFetch}
        onOpenSettings={handleOpenSettings}
      />

      {/* 2. UNIFIED PLAYBACK & ACTION TOOLBAR */}
      <UnifiedControlBar
        onInspectArtwork={handleInspectArtwork}
        onScrollToCurrentTrack={handleScrollToCurrentTrack}
        onJumpToNowPlaying={jumpToNowPlaying}
        volumes={volumes}
        selectedVolumePath={selectedVolumePath}
        syncTargetMode={config.syncTargetMode || 'sd'}
        ftpServiceName={config.ftpServiceName || 'WiFiFTP'}
        ftpManualHost={config.ftpManualHost || ''}
        ftpServices={ftpServices}
        onStartIngest={handleStartIngest}
        onStartSync={handleStartSync}
        onCancelSync={handleCancelSync}
        onEjectVolume={handleEjectVolume}
        isIngesting={isIngesting}
        isSyncing={isSyncing}
        syncState={syncState}
        isEjecting={isEjecting}
      />

        {/* 3. MAIN CONTENT AREA: LEFT NAVIGATION SIDEBAR + RIGHT TRACK TABLE */}
        <div className="flex-1 flex min-h-0 overflow-hidden">
          <Sidebar
            totalLibraryTracks={tracks.length}
            playlists={playlists}
            activePlaylistId={activePlaylistId}
            onSelectLibrary={handleSelectLibrary}
            onSelectPlaylist={handleSelectPlaylist}
            onCreatePlaylist={handleCreatePlaylist}
            onRenamePlaylist={handleRenamePlaylist}
            onDuplicatePlaylist={handleDuplicatePlaylist}
            onDeletePlaylist={handleDeletePlaylist}
          />

          <TrackTable
            tracks={visibleTracks}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filterMissingArt={filterMissingArt}
            onClearMissingArtFilter={handleClearMissingArtFilter}
            playlists={playlists}
            mostRecentPlaylistId={mostRecentPlaylistId}
            activePlaylist={activePlaylist}
            onAddTrackToPlaylist={handleAddTrackToPlaylist}
            onRemoveTrackFromPlaylist={handleRemoveTrackFromPlaylist}
            onCreatePlaylistWithTrack={handleCreatePlaylistWithTrack}
            onReorderPlaylistTracks={handleReorderPlaylistTracks}
            onMovePlaylistTrack={handleMovePlaylistTrack}
            onInspectArtwork={handleInspectArtwork}
            scrollToTrackKey={scrollToTrackKey}
            selectedTrackKey={selectedTrackKey}
            onSelectTrack={setSelectedTrackKey}
          />
        </div>

      {/* 4. COLLAPSIBLE LIVE CONSOLE DRAWER */}
      <LogViewer
        logs={logs}
        onClearLogs={handleClearLogs}
        isOpen={isConsoleOpen}
        onToggleOpen={handleToggleConsole}
        isStreaming={isIngesting || isFetchingArtwork || isSyncing}
      />

      {/* FLOATING TOAST NOTIFICATION */}
      {toast && (
        <div
          className={`fixed bottom-14 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl border shadow-xl text-xs font-medium backdrop-blur-md transition-all ${
            toast.type === 'error'
              ? 'bg-red-50 dark:bg-red-950/90 border-red-300 dark:border-red-700/80 text-red-800 dark:text-red-200'
              : 'bg-white dark:bg-zinc-900/95 border-amber-500/50 text-zinc-900 dark:text-amber-200'
          }`}
        >
          {toast.type === 'error' ? (
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          ) : (
            <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}

      {/* MANUAL ARTWORK OVERRIDE & INSPECTION MODAL */}
      {inspectingTrack && (
        <ArtworkModal
          track={inspectingTrack}
          albumTrackCount={inspectingAlbumTrackCount}
          onClose={() => setInspectingTrackKey(null)}
          onUploadArtwork={handleUploadManualArtwork}
          onRemoveArtwork={handleRemoveManualArtwork}
          onFetchArtwork={handleFetchModalArtwork}
          isFetchingArtwork={isFetchingArtwork}
        />
      )}

        {/* PRE-SYNC LAYOUT MODE CONFIRMATION MODAL */}
        <SyncModeModal
          isOpen={isSyncModeModalOpen}
          onClose={() => setIsSyncModeModalOpen(false)}
          onConfirm={handleConfirmSyncMode}
          targetName={
            config.syncTargetMode === 'ftp'
              ? config.ftpServiceName || config.ftpManualHost || 'Wi-Fi FTP Player'
              : activeVolume?.name || selectedVolumePath || 'SD Card'
          }
        />

        {/* DIRECTORY & TARGET SD CARD CONFIGURATION MODAL */}
        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
          config={config}
          volumes={volumes}
          ftpServices={ftpServices}
          selectedVolumePath={selectedVolumePath}
          onSelectVolume={handleSelectVolume}
          onSaveSettings={handleSaveSettings}
          onBrowseFolder={handleBrowseFolder}
        />
      </div>
  );
}

export default function App() {
  return (
    <PlayerProvider>
      <AppContent />
    </PlayerProvider>
  );
}
