import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
} from 'react';

const PlayerContext = createContext(null);

export function PlayerProvider({ children }) {
  const audioRef = useRef(null);
  if (!audioRef.current && typeof window !== 'undefined') {
    audioRef.current = new Audio();
    audioRef.current.preload = 'metadata';
  }

  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolumeState] = useState(0.85);
  const [isMuted, setIsMuted] = useState(false);
  const [queue, setQueue] = useState([]);
  const [queueIndex, setQueueIndex] = useState(-1);
  const [queueSource, setQueueSource] = useState({
    name: 'All Tracks',
    id: null,
    type: 'library',
  });
  const [isBuffering, setIsBuffering] = useState(false);

  // Ref to track if user is currently dragging timeline slider
  const isScrubbingRef = useRef(false);

  // Sync volume on audio element initialization
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = isMuted;
    }
  }, []);

  const playTrack = useCallback(
    (track, newQueue = null, index = null, sourceContext = null) => {
      if (!track) return;
      const audio = audioRef.current;
      if (!audio) return;

      const activeQueue = newQueue || queue;
      if (newQueue) {
        setQueue(newQueue);
      }

      let activeIndex = index;
      if (activeIndex === null || activeIndex === undefined) {
        const trackIdentifier = track.trackKey || track.filename;
        activeIndex = activeQueue.findIndex(
          (t) => (t.trackKey || t.filename) === trackIdentifier
        );
      }
      setQueueIndex(activeIndex !== -1 ? activeIndex : 0);
      setCurrentTrack(track);

      if (sourceContext) {
        setQueueSource(sourceContext);
      }

      const streamUrl = `/api/stream/${encodeURIComponent(track.filename)}`;
      audio.src = streamUrl;
      audio.currentTime = 0;
      setCurrentTime(0);
      setDuration(track.duration || 0);

      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('[AUDIO PLAYER] Playback prevented or interrupted:', err.message);
          setIsPlaying(false);
        });
      }
    },
    [queue]
  );

  const togglePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (!currentTrack) {
      if (queue.length > 0) {
        playTrack(queue[0], queue, 0);
      }
      return;
    }

    if (audio.paused) {
      const playPromise = audio.play();
      if (playPromise !== undefined) {
        playPromise.catch((err) => {
          console.warn('[AUDIO PLAYER] Play failed:', err.message);
          setIsPlaying(false);
        });
      }
    } else {
      audio.pause();
    }
  }, [currentTrack, queue, playTrack]);

  const seek = useCallback((timeInSeconds) => {
    const audio = audioRef.current;
    if (!audio) return;

    const safeTime = Math.max(0, Math.min(timeInSeconds, audio.duration || 0));
    audio.currentTime = safeTime;
    setCurrentTime(safeTime);
  }, []);

  const setIsScrubbing = useCallback((scrubbing) => {
    isScrubbingRef.current = scrubbing;
  }, []);

  const nextTrack = useCallback(() => {
    if (!queue || queue.length === 0) return;
    const nextIdx = queueIndex + 1;
    if (nextIdx < queue.length) {
      playTrack(queue[nextIdx], queue, nextIdx);
    } else {
      // End of queue: stop playback and reset
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      setIsPlaying(false);
      setCurrentTime(0);
    }
  }, [queue, queueIndex, playTrack]);

  const previousTrack = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    // If more than 3 seconds in, restart track
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }

    if (!queue || queue.length === 0) return;
    const prevIdx = queueIndex - 1;
    if (prevIdx >= 0) {
      playTrack(queue[prevIdx], queue, prevIdx);
    } else {
      audio.currentTime = 0;
      setCurrentTime(0);
    }
  }, [queue, queueIndex, playTrack]);

  const setVolume = useCallback((newVolume) => {
    const audio = audioRef.current;
    const clamped = Math.max(0, Math.min(1, newVolume));
    setVolumeState(clamped);
    if (audio) {
      audio.volume = clamped;
      if (clamped > 0 && audio.muted) {
        audio.muted = false;
        setIsMuted(false);
      }
    }
  }, []);

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const nextMuted = !audio.muted;
    audio.muted = nextMuted;
    setIsMuted(nextMuted);
  }, []);

  // Audio HTML5 event bindings
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => {
      if (!isScrubbingRef.current) {
        setCurrentTime(audio.currentTime);
      }
    };

    const handleLoadedMetadata = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const handleDurationChange = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const handlePlay = () => setIsPlaying(true);
    const handlePause = () => setIsPlaying(false);
    const handleWaiting = () => setIsBuffering(true);
    const handlePlaying = () => setIsBuffering(false);
    const handleEnded = () => {
      nextTrack();
    };
    const handleError = (e) => {
      console.error('[AUDIO PLAYER ERROR]', audio.error || e);
      setIsPlaying(false);
      setIsBuffering(false);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [nextTrack]);

  // Spacebar keyboard shortcut for Play/Pause toggle
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        const tag = document.activeElement?.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          document.activeElement?.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        togglePlayPause();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [togglePlayPause]);

  // MediaSession API integration for native macOS Control Center & desktop media controls
  useEffect(() => {
    if (!('mediaSession' in navigator) || !currentTrack) return;
    try {
      navigator.mediaSession.metadata = new window.MediaMetadata({
        title: currentTrack.title || currentTrack.filename,
        artist: currentTrack.artist || 'Unknown Artist',
        album: currentTrack.album || 'Audiophile Vault',
        artwork: [
          {
            src: `/api/artwork/${encodeURIComponent(currentTrack.baseName)}`,
            sizes: '512x512',
            type: 'image/jpeg',
          },
        ],
      });

      navigator.mediaSession.setActionHandler('play', () => {
        audioRef.current?.play().catch(() => {});
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        audioRef.current?.pause();
      });
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        previousTrack();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        nextTrack();
      });
      navigator.mediaSession.setActionHandler('seekto', (details) => {
        if (details.seekTime != null) seek(details.seekTime);
      });
    } catch {
      // Ignore MediaSession exceptions in restricted environments
    }
  }, [currentTrack, previousTrack, nextTrack, seek]);

  const value = {
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    isMuted,
    queue,
    queueIndex,
    queueSource,
    setQueueSource,
    isBuffering,
    playTrack,
    togglePlayPause,
    seek,
    setIsScrubbing,
    nextTrack,
    previousTrack,
    setVolume,
    toggleMute,
  };

  return (
    <PlayerContext.Provider value={value}>{children}</PlayerContext.Provider>
  );
}

export function useAudioPlayer() {
  const context = useContext(PlayerContext);
  if (!context) {
    throw new Error('useAudioPlayer must be used within a PlayerProvider');
  }
  return context;
}

export default PlayerContext;
