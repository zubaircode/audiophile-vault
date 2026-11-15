import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs, { promises as fsp } from 'node:fs';
import express from 'express';
import cors from 'cors';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db, expandTilde, getCompanionJpgFilename } from './db.js';
import { listMountedVolumes, ejectVolume, isSafeExternalVolume } from './services/volume.js';
import { resolveTargetMusicDir, getHardenedEnv } from './config.js';
import {
  ingestEmitter,
  runIngestionPipeline,
  getIngestState,
  getRecentIngestEvents,
} from './services/scanner.js';
import {
  syncEmitter,
  runRsyncToSdCard,
  getSyncState,
  killActiveRsync,
} from './services/sync.js';
import {
  listPlaylists,
  createPlaylist,
  renamePlaylist,
  duplicatePlaylist,
  deletePlaylist,
  addTrackToPlaylist,
  removeTrackFromPlaylist,
  reorderPlaylistTracks,
  movePlaylistTrack,
  syncAllPlaylistsM3u8,
} from './playlists.js';
import {
  artworkEmitter,
  runArtworkBackfill,
  stopArtworkBackfill,
  getArtworkState,
  getEmbeddedArtworkForBaseName,
  parseMultipartArtworkRequest,
  saveManualArtwork,
  deleteManualArtwork,
} from './artwork.js';
import { embedderEmitter } from './embedder.js';

// Bridge embedder warnings to the Activity Console artwork/sync log stream
embedderEmitter.on('warning', (warningMsg) => {
  artworkEmitter.emit('progress', {
    timestamp: new Date().toISOString(),
    type: 'SKIPPED',
    message: warningMsg,
  });
});

const execFileAsync = promisify(execFile);

const app = express();

app.use(cors());
app.use(express.json({ limit: '25mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve packaged/built Vite client static assets when available
const clientDistCandidates = [
  path.resolve(__dirname, '../client/dist'),
  path.resolve(__dirname, '../../client/dist'),
  path.join(process.resourcesPath || '', 'client/dist'),
  path.join(process.resourcesPath || '', 'app.asar/client/dist'),
];
const clientDistDir = clientDistCandidates.find((d) => fs.existsSync(d));
if (clientDistDir) {
  app.use(express.static(clientDistDir));
}

// Initialize database registry & synchronize .m3u files on startup
db.init();
syncAllPlaylistsM3u8();

function safeDecodeParam(value) {
  if (!value || typeof value !== 'string') return '';
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Legacy /covers/:filename route redirected to extract embedded container artwork
app.get('/covers/:filename', async (req, res) => {
  try {
    const rawName = safeDecodeParam(req.params.filename || '');
    const art = await getEmbeddedArtworkForBaseName(rawName);
    if (!art || !art.buffer) {
      return res.status(404).end();
    }
    res.setHeader('Content-Type', art.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    return res.send(art.buffer);
  } catch {
    return res.status(404).end();
  }
});

/**
 * GET /api/tracks/:filename/cover
 * Extracts and serves a track's embedded cover artwork directly from its audio container.
 */
app.get('/api/tracks/:filename/cover', async (req, res) => {
  try {
    const rawName = safeDecodeParam(req.params.filename || '');
    const art = await getEmbeddedArtworkForBaseName(rawName);
    if (!art || !art.buffer) {
      return res.status(404).end();
    }
    res.setHeader('Content-Type', art.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    return res.send(art.buffer);
  } catch {
    return res.status(404).end();
  }
});

/**
 * GET /api/config
 * Returns paths (`sourcePath`, `vaultPath`, `sdCardPath`), library stats (total tracks, total size in GB, tracksWithArtwork),
 * and active job status flags.
 */
app.get('/api/config', async (_req, res) => {
  await db.syncVaultOnDisk();
  const config = db.getConfig();
  res.json({
    ...config,
    status: {
      ...getIngestState(),
      ...getSyncState(),
      ...getArtworkState(),
    },
  });
});

/**
 * POST /api/config
 * Updates configurable directory paths (`sourcePath`, `vaultPath`, `sdCardPath`) and `exportPlaylistFolders`.
 */
app.post('/api/config', async (req, res) => {
  try {
    const {
      sourcePath,
      vaultPath,
      sdCardPath,
      targetPath,
      exportPlaylistFolders,
    } = req.body || {};
    db.updateConfig({
      sourcePath,
      vaultPath,
      sdCardPath: targetPath !== undefined ? targetPath : sdCardPath,
      exportPlaylistFolders,
    });
    await db.syncVaultOnDisk({ force: true });
    syncAllPlaylistsM3u8();
    res.json(db.getConfig());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/settings/target
 * Updates the active sync target path (e.g. /Volumes/{SelectedVolume}/Music/ or custom directory).
 */
app.post('/api/settings/target', async (req, res) => {
  try {
    const rawTarget =
      req.body?.targetPath ||
      req.body?.sdCardPath ||
      req.body?.volumePath ||
      '';
    if (!rawTarget || typeof rawTarget !== 'string') {
      return res.status(400).json({ error: 'Target path is required.' });
    }
    const cleanTarget = expandTilde(rawTarget.trim());
    const safety = await isSafeExternalVolume(cleanTarget);
    if (!safety.safe) {
      return res.status(400).json({ error: safety.reason });
    }
    db.updateConfig({ sdCardPath: cleanTarget });
    res.json({
      success: true,
      targetPath: cleanTarget,
      config: db.getConfig(),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/pick-folder
 * Opens native macOS Finder folder chooser dialog via `/usr/bin/osascript`.
 */
app.post('/api/pick-folder', async (req, res) => {
  try {
    const promptText =
      typeof req.body?.prompt === 'string'
        ? req.body.prompt.replace(/"/g, '')
        : 'Select Folder';
    const script = `POSIX path of (choose folder with prompt "${promptText}")`;
    const { stdout } = await execFileAsync('/usr/bin/osascript', ['-e', script], {
      env: getHardenedEnv(),
    });
    const selectedPath = expandTilde(stdout.trim());
    res.json({ path: selectedPath });
  } catch (err) {
    // User canceled native dialog (-128) or osascript error
    res.status(200).json({ cancelled: true, error: err.message });
  }
});

/**
 * GET /api/volumes
 * Reads `/Volumes/`, filters out `Macintosh HD` and system partitions,
 * returns array of `{ name, path, freeSpace, totalSpace }`.
 */
app.get('/api/volumes', async (_req, res) => {
  try {
    const volumes = await listMountedVolumes();
    res.json({ volumes });
  } catch (err) {
    res.status(500).json({ error: err.message, volumes: [] });
  }
});

/**
 * GET /api/tracks
 * Returns list of all tracks in the Flat Vault with columns:
 * Filename, Artist, Album, Title, DiscTrack, FileSize, AddedDate, hasArtwork, artworkFilename.
 */
app.get('/api/tracks', async (req, res) => {
  await db.syncVaultOnDisk();
  const search = typeof req.query.search === 'string' ? req.query.search : '';
  const tracks = db.getTracks(search);
  res.json({
    total: tracks.length,
    tracks,
  });
});

// ==================================================
// PLAYLIST REST ENDPOINTS
// ==================================================

app.get('/api/playlists', (_req, res) => {
  try {
    const data = listPlaylists();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/playlists', (req, res) => {
  try {
    const playlist = createPlaylist(req.body?.name);
    const { playlists, mostRecentPlaylistId } = listPlaylists();
    res.status(201).json({
      playlist,
      playlists,
      mostRecentPlaylistId,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/playlists/:id', (req, res) => {
  try {
    const playlist = renamePlaylist(req.params.id, req.body?.name);
    const { playlists, mostRecentPlaylistId } = listPlaylists();
    res.json({
      playlist,
      playlists,
      mostRecentPlaylistId,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/playlists/:id/duplicate', (req, res) => {
  try {
    const playlist = duplicatePlaylist(req.params.id);
    const { playlists, mostRecentPlaylistId } = listPlaylists();
    res.status(201).json({
      playlist,
      playlists,
      mostRecentPlaylistId,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/playlists/:id', (req, res) => {
  try {
    const result = deletePlaylist(req.params.id);
    const { playlists, mostRecentPlaylistId } = listPlaylists();
    res.json({
      ...result,
      playlists,
      mostRecentPlaylistId,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/playlists/:id/tracks', (req, res) => {
  try {
    const { trackKey } = req.body || {};
    const result = addTrackToPlaylist(req.params.id, trackKey);
    const { playlists, mostRecentPlaylistId } = listPlaylists();
    res.json({
      ...result,
      playlists,
      mostRecentPlaylistId,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/playlists/:id/tracks/:trackKey', (req, res) => {
  try {
    const decodedTrackKey = decodeURIComponent(req.params.trackKey);
    const result = removeTrackFromPlaylist(req.params.id, decodedTrackKey);
    const { playlists, mostRecentPlaylistId } = listPlaylists();
    res.json({
      ...result,
      playlists,
      mostRecentPlaylistId,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/playlists/:id/reorder', (req, res) => {
  try {
    const { trackKeys, fromIndex, toIndex } = req.body || {};
    const playlist = reorderPlaylistTracks(req.params.id, {
      trackKeys,
      fromIndex,
      toIndex,
    });
    const { playlists, mostRecentPlaylistId } = listPlaylists();
    res.json({
      playlist,
      playlists,
      mostRecentPlaylistId,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.patch('/api/playlists/:id/move', (req, res) => {
  try {
    const { trackKey, direction } = req.body || {};
    const playlist = movePlaylistTrack(req.params.id, trackKey, direction);
    const { playlists, mostRecentPlaylistId } = listPlaylists();
    res.json({
      playlist,
      playlists,
      mostRecentPlaylistId,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==================================================
// ARTWORK BACKFILL & STOP ENDPOINTS
// ==================================================

/**
 * GET /api/artwork/progress
 * Persistent SSE stream for real-time artwork lookup events (`[ARTWORK]`, `[SKIPPED]`, `[ERROR]`, `[DONE]`).
 */
app.get('/api/artwork/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(
    `data: ${JSON.stringify({ type: 'CONNECTED', message: 'Connected to Artwork SSE stream' })}\n\n`
  );

  const onProgress = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  artworkEmitter.on('progress', onProgress);

  req.on('close', () => {
    artworkEmitter.off('progress', onProgress);
  });
});

/**
 * GET /api/artwork/backfill
 * SSE endpoint that initiates (if not already running) and streams artwork backfill progress.
 * Supports optional `?playlistId=pl_1` query parameter to scope to the selected playlist.
 */
app.get('/api/artwork/backfill', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const onProgress = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  artworkEmitter.on('progress', onProgress);

  req.on('close', () => {
    artworkEmitter.off('progress', onProgress);
  });

  const { isFetchingArtwork } = getArtworkState();
  if (!isFetchingArtwork) {
    const playlistId =
      typeof req.query.playlistId === 'string' && req.query.playlistId
        ? req.query.playlistId
        : null;
    runArtworkBackfill({ playlistId }).catch((err) => {
      console.error('[ARTWORK BACKFILL ERROR]', err);
    });
  }
});

/**
 * POST /api/artwork/backfill
 * Body: { playlistId?: string | null, trackKeys?: string[] | null }
 * Initiates artwork lookup for either the currently selected playlist or the entire library.
 */
app.post('/api/artwork/backfill', (req, res) => {
  const { isFetchingArtwork } = getArtworkState();
  if (isFetchingArtwork) {
    return res.status(409).json({ error: 'Artwork lookup is already in progress.' });
  }

  const playlistId = req.body?.playlistId || null;
  const trackKeys = Array.isArray(req.body?.trackKeys) ? req.body.trackKeys : null;

  runArtworkBackfill({ playlistId, trackKeys }).catch((err) => {
    console.error('[ARTWORK BACKFILL ERROR]', err);
  });

  return res.status(202).json({
    started: true,
    playlistId,
    message: 'Artwork lookup started. Streaming on /api/artwork/progress.',
  });
});

/**
 * POST /api/artwork/stop
 * Stops an in-progress artwork backfill run midway.
 */
app.post('/api/artwork/stop', (_req, res) => {
  const result = stopArtworkBackfill();
  res.json(result);
});

/**
 * GET /api/artwork/:baseName/download
 * Extracts embedded artwork from `~/Music/AudiophileVault/{baseName}.{ext}` and streams it
 * with `Content-Disposition: attachment` so the browser triggers a native "Save As" download.
 */
app.get('/api/artwork/:baseName/download', async (req, res) => {
  try {
    const rawParam = safeDecodeParam(req.params.baseName || '');
    const trackKey =
      typeof req.query.trackKey === 'string' ? req.query.trackKey : '';
    const art = await getEmbeddedArtworkForBaseName(rawParam, { trackKey });
    if (!art || !art.buffer) {
      return res
        .status(404)
        .json({ error: 'No embedded artwork found for this track.' });
    }

    const safeDispositionName = art.baseName.replace(/"/g, "'");
    const ext = art.mimeType?.includes('png') ? 'png' : 'jpg';

    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${safeDispositionName}.${ext}"`
    );
    res.setHeader('Content-Type', art.mimeType || 'image/jpeg');
    return res.send(art.buffer);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/artwork/:baseName
 * Locates `{baseName}.{ext}` in `~/Music/AudiophileVault/`, extracts the embedded image buffer
 * via `music-metadata` (with fault-tolerant fallback to any unmigrated companion `.jpg`),
 * and returns it with `Content-Type: image/jpeg` (or `404` if none exists).
 */
app.get('/api/artwork/:baseName', async (req, res) => {
  try {
    const rawParam = safeDecodeParam(req.params.baseName || '');
    const trackKey =
      typeof req.query.trackKey === 'string' ? req.query.trackKey : '';
    const art = await getEmbeddedArtworkForBaseName(rawParam, { trackKey });

    if (!art || !art.buffer) {
      return res.status(404).end();
    }

    res.setHeader('Content-Type', art.mimeType || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    return res.send(art.buffer);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/artwork/:baseName/delete
 * Fallback POST endpoint for stripping embedded artwork (supports `scope: 'single' | 'disc' | 'album'`).
 */
app.post('/api/artwork/:baseName/delete', async (req, res) => {
  try {
    const rawParam = safeDecodeParam(req.params.baseName || req.body?.baseName || '');
    const applyToAlbum =
      req.body?.applyToAlbum === true ||
      req.body?.applyToAlbum === 'true' ||
      req.query.applyToAlbum === 'true';
    const includeDisc =
      req.body?.includeDisc === true ||
      req.body?.includeDisc === 'true' ||
      req.query.includeDisc === 'true';
    const scope = req.body?.scope || req.query.scope || '';
    const result = await deleteManualArtwork(rawParam, {
      trackKey: req.body?.trackKey || req.query.trackKey || '',
      scope,
      applyToAlbum,
      includeDisc,
      artist: req.body?.artist || req.query.artist || '',
      album: req.body?.album || req.query.album || '',
    });
    await db.syncVaultOnDisk({ force: true });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * POST /api/artwork/:baseName
 * Multipart or JSON upload endpoint to embed custom artwork directly into the audio container(s)
 * for `scope: 'single' | 'disc' | 'album'` (or `applyToAlbum === true`).
 */
app.post('/api/artwork/:baseName', async (req, res) => {
  try {
    const rawParam = safeDecodeParam(req.params.baseName || '');
    const {
      fileBuffer,
      mimeType,
      trackKey,
      scope,
      applyToAlbum,
      includeDisc,
      artist,
      album,
    } = await parseMultipartArtworkRequest(req);

    const result = await saveManualArtwork(rawParam, fileBuffer, {
      mimeType,
      trackKey: trackKey || req.query.trackKey || '',
      scope,
      applyToAlbum,
      includeDisc,
      artist,
      album,
    });
    await db.syncVaultOnDisk({ force: true });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * DELETE /api/artwork/:baseName
 * Strips embedded cover art (`APIC` / `METADATA_BLOCK_PICTURE` / `covr`) from the targeted audio file(s).
 * Supports `scope` (`single` | `disc` | `album`), `trackKey`, `applyToAlbum`, `includeDisc`, `artist`, and `album`.
 */
app.delete('/api/artwork/:baseName', async (req, res) => {
  try {
    const rawParam = safeDecodeParam(req.params.baseName || req.body?.baseName || '');
    const applyToAlbum =
      req.body?.applyToAlbum === true ||
      req.body?.applyToAlbum === 'true' ||
      req.query.applyToAlbum === 'true';
    const includeDisc =
      req.body?.includeDisc === true ||
      req.body?.includeDisc === 'true' ||
      req.query.includeDisc === 'true';
    const scope = req.body?.scope || req.query.scope || '';
    const result = await deleteManualArtwork(rawParam, {
      trackKey: req.body?.trackKey || req.query.trackKey || '',
      scope,
      applyToAlbum,
      includeDisc,
      artist: req.body?.artist || req.query.artist || '',
      album: req.body?.album || req.query.album || '',
    });
    await db.syncVaultOnDisk({ force: true });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ==================================================
// INGESTION & RSYNC ENDPOINTS
// ==================================================

app.get(['/api/import/progress', '/api/import/stream'], (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(
    `data: ${JSON.stringify({ type: 'CONNECTED', message: 'Connected to Ingest SSE stream' })}\n\n`
  );

  // Replay buffered events if an ingestion run is currently active or if requested via ?replay=1
  const { isIngesting } = getIngestState();
  if (isIngesting || req.query.replay === '1') {
    const recent = getRecentIngestEvents();
    for (const evt of recent) {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    }
  }

  const onProgress = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  ingestEmitter.on('progress', onProgress);

  req.on('close', () => {
    clearInterval(heartbeat);
    ingestEmitter.off('progress', onProgress);
  });
});

app.post('/api/import', (req, res) => {
  const { isIngesting } = getIngestState();
  if (isIngesting) {
    return res.status(409).json({ error: 'Ingestion is already in progress.' });
  }

  if (req.body?.sourcePath || req.body?.vaultPath) {
    db.updateConfig({
      sourcePath: req.body.sourcePath,
      vaultPath: req.body.vaultPath,
    });
  }

  runIngestionPipeline().catch((err) => {
    console.error('[INGEST ERROR]', err);
  });

  return res.status(202).json({
    started: true,
    message: 'Ingestion pipeline started. Listening on /api/import/progress.',
  });
});

app.get('/api/sync/progress', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  res.write(
    `data: ${JSON.stringify({ type: 'CONNECTED', message: 'Connected to Rsync SSE stream' })}\n\n`
  );

  const onProgress = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  syncEmitter.on('progress', onProgress);

  req.on('close', () => {
    syncEmitter.off('progress', onProgress);
  });
});

app.post('/api/sync', async (req, res) => {
  const { isSyncing } = getSyncState();
  if (isSyncing) {
    return res.status(409).json({ error: 'Rsync is already running.' });
  }

  const volumePath = req.body?.volumePath || db.getConfig().sdCardPath;
  if (!volumePath) {
    return res.status(400).json({ error: 'Please select a target SD card volume first.' });
  }

  db.updateConfig({ sdCardPath: volumePath });

  runRsyncToSdCard(volumePath).catch((err) => {
    console.error('[RSYNC ERROR]', err.message);
  });

  const targetMusicDir = resolveTargetMusicDir(volumePath);
  return res.status(202).json({
    started: true,
    volumePath,
    targetPath: targetMusicDir,
    message: `Rsync started targeting ${targetMusicDir}.`,
  });
});

app.post('/api/eject', async (req, res) => {
  try {
    const volumePath = req.body?.volumePath || db.getConfig().sdCardPath;
    if (!volumePath) {
      return res.status(400).json({ error: 'No volume specified to eject.' });
    }
    const result = await ejectVolume(volumePath);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==================================================
// AUDIO STREAMING (HTTP RANGE PARTIAL CONTENT)
// ==================================================

const AUDIO_MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.alac': 'audio/mp4',
  '.wav': 'audio/wav',
  '.wave': 'audio/wav',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
};

/**
 * GET /api/stream/:filename
 * Streams audio files from `~/Music/AudiophileVault/{filename}` with HTTP Range requests
 * (HTTP 206 Partial Content) support for fast HTML5 Audio seeking and buffering.
 */
app.get('/api/stream/:filename', async (req, res) => {
  try {
    const rawParam = safeDecodeParam(req.params.filename || '');
    if (!rawParam) {
      return res.status(400).json({ error: 'Filename is required' });
    }

    // Sanitize filename to prevent directory traversal
    const safeBasename = path.basename(rawParam);
    const config = db.getConfig();
    const vaultDir = path.resolve(expandTilde(config.vaultPath));
    const filePath = path.resolve(vaultDir, safeBasename);

    // Verify path safety (must reside within vault directory)
    if (!filePath.startsWith(vaultDir)) {
      return res.status(403).json({ error: 'Access denied: path traversal detected' });
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch {
      return res.status(404).json({ error: 'Audio file not found in vault' });
    }

    if (!stat.isFile()) {
      return res.status(404).json({ error: 'Target is not a regular file' });
    }

    const ext = path.extname(filePath).toLowerCase();
    const mimeType = AUDIO_MIME_TYPES[ext] || 'application/octet-stream';
    const fileSize = stat.size;
    const range = req.headers.range;

    if (!range) {
      res.writeHead(200, {
        'Content-Length': fileSize,
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // Parse HTTP Range header (e.g. bytes=0-1024 or bytes=1024-)
    const match = range.match(/bytes=(\d*)-(\d*)/);
    if (!match) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).end();
    }

    let start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : fileSize - 1;

    if (isNaN(start)) start = 0;
    if (isNaN(end) || end >= fileSize) end = fileSize - 1;

    if (start > end || start >= fileSize) {
      res.setHeader('Content-Range', `bytes */${fileSize}`);
      return res.status(416).end();
    }

    const chunkSize = end - start + 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': mimeType,
      'Cache-Control': 'no-cache',
    });

    const stream = fs.createReadStream(filePath, { start, end });
    stream.on('error', (streamErr) => {
      console.error('[STREAM ERROR]', streamErr.message);
      if (!res.headersSent) {
        res.status(500).end();
      }
    });
    stream.pipe(res);
  } catch (err) {
    console.error('[STREAM HANDLER ERROR]', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: err.message });
    }
  }
});

// SPA fallback for production when client/dist exists
if (clientDistDir) {
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/covers')) {
      return next();
    }
    const indexPath = path.join(clientDistDir, 'index.html');
    if (fs.existsSync(indexPath)) {
      return res.sendFile(indexPath);
    }
    next();
  });
}

let activeHttpServer = null;

/**
 * Starts the Express backend server on 127.0.0.1.
 * If preferredPort is 0, the OS dynamically assigns a free port.
 */
export function startServer(preferredPort = 0) {
  return new Promise((resolve, reject) => {
    const portToUse = typeof preferredPort === 'number' ? preferredPort : 0;
    const server = app.listen(portToUse, '127.0.0.1', () => {
      const address = server.address();
      const boundPort =
        typeof address === 'object' && address ? address.port : portToUse;
      activeHttpServer = server;
      console.log(`\n⚡ Audiophile Vault Server running at http://127.0.0.1:${boundPort}`);
      resolve({ server, port: boundPort, app });
    });

    server.on('error', (err) => {
      console.error('[SERVER LISTEN ERROR]', err.message);
      reject(err);
    });
  });
}

/**
 * Cleanly shuts down the HTTP server and terminates active sync processes.
 */
export function stopServer() {
  return new Promise((resolve) => {
    killActiveRsync();
    if (activeHttpServer) {
      activeHttpServer.close((err) => {
        if (err) console.error('[SERVER CLOSE ERROR]', err.message);
        activeHttpServer = null;
        resolve();
      });
    } else {
      resolve();
    }
  });
}

export { app };

// Preserve standalone node execution (e.g. `node server/index.js` outside Electron)
const isDirectRun =
  Boolean(process.argv[1]) &&
  (import.meta.url === `file://${process.argv[1]}` ||
   import.meta.url.endsWith(process.argv[1].replace(/^[A-Z]:/, '')));

if (isDirectRun) {
  const standalonePort = parseInt(process.env.PORT, 10) || 3001;
  startServer(standalonePort).catch((err) => {
    console.error('[STANDALONE SERVER BOOT ERROR]', err);
    process.exit(1);
  });
}
