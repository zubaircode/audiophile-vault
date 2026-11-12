import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { db, expandTilde, getCompanionJpgFilename } from '../db.js';
import {
  SUPPORTED_EXTENSIONS,
  DRM_EXTENSIONS,
  extractTrackMetadata,
} from './metadata.js';
import { fetchAndEmbedAlbumArt } from '../artwork.js';

export const ingestEmitter = new EventEmitter();
ingestEmitter.setMaxListeners(50);

let isIngesting = false;
let currentRunId = 0;
let recentIngestEvents = [];
const MAX_RECENT_EVENTS = 400;

export function getIngestState() {
  return { isIngesting, runId: currentRunId };
}

export function getRecentIngestEvents() {
  return recentIngestEvents;
}

function emitEvent(type, message, extra = {}) {
  const payload = {
    id: `${currentRunId}:${recentIngestEvents.length + 1}`,
    runId: currentRunId,
    timestamp: new Date().toISOString(),
    type, // 'INGEST' | 'SKIPPED' | 'DRM' | 'ERROR' | 'DONE'
    message,
    ...extra,
  };
  recentIngestEvents.push(payload);
  if (recentIngestEvents.length > MAX_RECENT_EVENTS) {
    recentIngestEvents = recentIngestEvents.slice(-MAX_RECENT_EVENTS);
  }
  ingestEmitter.emit('progress', payload);
}

/**
 * Computes SHA-256 hash of a file using non-blocking streams.
 */
export function computeFileSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

/**
 * Non-blocking asynchronous generator to walk a directory tree recursively.
 */
async function* walkAudioDirectory(dirPath) {
  let entries;
  try {
    entries = await fsp.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    emitEvent('ERROR', `[ERROR] Cannot read directory ${dirPath}: ${err.message}`);
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue; // Skip macOS .DS_Store and hidden files
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      yield* walkAudioDirectory(fullPath);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (SUPPORTED_EXTENSIONS.has(ext) || DRM_EXTENSIONS.has(ext)) {
        yield fullPath;
      }
    }
  }
}

/**
 * Runs the full ingestion & deduplication pipeline from Master Music Source into Flat Vault.
 */
export async function runIngestionPipeline() {
  if (isIngesting) {
    throw new Error('Ingestion is already running.');
  }

  isIngesting = true;
  currentRunId += 1;
  recentIngestEvents = [];

  // Yield briefly so any concurrent SSE connection from the client attaches before the first event
  await new Promise((r) => setTimeout(r, 80));

  const config = db.getConfig();
  const sourceDir = expandTilde(config.sourcePath);
  const vaultDir = expandTilde(config.vaultPath);

  const summary = {
    scanned: 0,
    imported: 0,
    skippedDuplicate: 0,
    skippedDrm: 0,
    errors: 0,
  };

  try {
    await fsp.mkdir(vaultDir, { recursive: true });

    try {
      await fsp.access(sourceDir, fs.constants.R_OK);
    } catch {
      emitEvent('ERROR', `[ERROR] Source directory not found or unreadable: ${sourceDir}`);
      emitEvent('DONE', `[DONE] Ingestion aborted — verify your Master Music Source path.`, {
        summary,
      });
      return summary;
    }

    emitEvent('INGEST', `[INGEST] Starting recursive scan of "${sourceDir}" -> "${vaultDir}"`);

    for await (const filePath of walkAudioDirectory(sourceDir)) {
      summary.scanned += 1;

      // Yield to the Node.js event loop periodically so Express remains responsive
      if (summary.scanned % 10 === 0) {
        await new Promise((r) => setImmediate(r));
      }

      try {
        const meta = await extractTrackMetadata(filePath);

        if (meta.isDrmProtected) {
          summary.skippedDrm += 1;
          emitEvent(
            'SKIPPED',
            `[SKIPPED] DRM Protected (${meta.drmReason}): ${path.basename(filePath)}`
          );
          continue;
        }

        const targetPath = path.join(vaultDir, meta.filename);

        // Check if target file already exists on disk in Flat Vault
        let existsOnDisk = false;
        try {
          await fsp.access(targetPath, fs.constants.F_OK);
          existsOnDisk = true;
        } catch {
          existsOnDisk = false;
        }

        if (existsOnDisk) {
          summary.skippedDuplicate += 1;
          emitEvent('SKIPPED', `[SKIPPED] Track already exists: ${meta.filename}`);
          continue;
        }

        // Compute SHA-256 and check deduplication registry
        const sha256 = await computeFileSha256(filePath);
        const dupCheck = db.hasDuplicate({
          sha256,
          normalizedKey: meta.normalizedKey,
          filename: meta.filename,
        });

        if (dupCheck.duplicate) {
          summary.skippedDuplicate += 1;
          emitEvent(
            'SKIPPED',
            `[SKIPPED] Track already exists (${dupCheck.reason}): ${meta.filename}`
          );
          continue;
        }

        // Non-destructive copy into Flat Vault
        await fsp.copyFile(filePath, targetPath, fs.constants.COPYFILE_EXCL);

        const jpgFilename = getCompanionJpgFilename(meta.filename);
        let hasArtwork = false;

        try {
          const artResult = await fetchAndEmbedAlbumArt(
            meta.artist,
            meta.album,
            targetPath,
            { rateLimitDelayMs: 150 }
          );
          if (
            artResult.status === 'DOWNLOADED' ||
            artResult.status === 'CACHED' ||
            artResult.status === 'MIGRATED'
          ) {
            hasArtwork = true;
            emitEvent(
              'ARTWORK',
              `[EMBEDDED ART] ${meta.filename} (${artResult.provider || 'iTunes'})`,
              { provider: artResult.provider }
            );
          } else if (
            artResult.status === 'ALREADY_EMBEDDED' ||
            artResult.status === 'SKIPPED'
          ) {
            hasArtwork = true;
            emitEvent(
              'ARTWORK',
              `[EMBEDDED ART] ${meta.filename} (Already Embedded)`
            );
          } else {
            emitEvent(
              'SKIPPED',
              `[ARTWORK: NOT FOUND] Could not resolve: ${meta.artist} - ${meta.album}`
            );
          }
        } catch {
          // Non-fatal if offline or artwork lookup fails during ingest
        }

        const stat = await fsp.stat(targetPath);
        const nowTs = Date.now();

        const trackRecord = {
          id: sha256.slice(0, 16),
          sha256,
          filename: meta.filename,
          baseName: meta.filename.replace(/\.[^.]+$/, ''),
          artworkFilename: jpgFilename,
          hasArtwork,
          artworkEmbedded: hasArtwork,
          artworkUpdatedAt: nowTs,
          updatedAt: nowTs,
          artist: meta.artist,
          albumArtist: meta.albumArtist || null,
          trackArtist: meta.trackArtist || meta.artist,
          compilation: Boolean(meta.compilation),
          album: meta.album,
          title: meta.title,
          discTrack: meta.discTrack,
          discNo: meta.discNo,
          discNumber: meta.discNumber || meta.discNo || 1,
          trackNo: meta.trackNo,
          extension: meta.extension,
          fileSize: stat.size,
          duration: meta.duration,
          normalizedKey: meta.normalizedKey,
          addedDate: new Date().toISOString(),
        };

        db.addTrack(trackRecord);
        summary.imported += 1;

        emitEvent('INGEST', `[INGEST] Copied: ${meta.filename}`, {
          track: trackRecord,
        });
      } catch (fileErr) {
        summary.errors += 1;
        emitEvent(
          'ERROR',
          `[ERROR] Failed processing ${path.basename(filePath)}: ${fileErr.message}`
        );
      }
    }

    emitEvent(
      'DONE',
      `[DONE] Ingestion complete — Scanned: ${summary.scanned} | Imported: ${summary.imported} | Skipped: ${summary.skippedDuplicate} | DRM Excluded: ${summary.skippedDrm}`,
      { summary }
    );
    return summary;
  } finally {
    isIngesting = false;
  }
}
