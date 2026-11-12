import React, { memo } from 'react';
import {
  HardDrive,
  FolderInput,
  HardDriveUpload,
  Loader2,
} from 'lucide-react';

export function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0.0 GB';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(1)} MB`;
}

function EjectIcon({ className = 'w-4 h-4' }) {
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

const SyncPanel = memo(function SyncPanel({
  volumes = [],
  selectedVolumePath = '',
  onStartIngest,
  onStartSync,
  onEjectVolume,
  isIngesting = false,
  isSyncing = false,
  isEjecting = false,
}) {
  const selectedVol = volumes.find((v) => v.path === selectedVolumePath) || null;
  const isMounted = Boolean(selectedVol);
  const busy = isIngesting || isSyncing || isEjecting;

  return (
    <section className="bg-zinc-900/60 backdrop-blur-md border-b border-zinc-800/80 px-6 py-2">
      <div className="w-full flex items-center justify-between gap-4">
        {/* Left: Minimal Target SD Indicator */}
        <div className="flex items-center gap-2 min-w-0">
          {isMounted ? (
            <div
              className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-300 truncate"
              title={`Target: ${selectedVol.path} (${formatBytes(selectedVol.freeSpace)} free)`}
            >
              <HardDrive className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              <span className="text-zinc-500">Target:</span>
              <span className="font-semibold text-zinc-200 truncate">{selectedVol.name}</span>
              <span className="text-zinc-500 shrink-0">
                ({formatBytes(selectedVol.freeSpace)} free)
              </span>
            </div>
          ) : (
            <div className="inline-flex items-center gap-1.5 text-xs font-mono text-zinc-500">
              <HardDrive className="w-3.5 h-3.5 text-zinc-600 shrink-0" />
              <span>No target SD card mounted</span>
            </div>
          )}
        </div>

        {/* Right: Compact Icon-based Primary Action Buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {/* 1. Scan & Ingest */}
          <button
            type="button"
            onClick={onStartIngest}
            disabled={busy}
            title="Scan & Ingest from Music Library"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 transition shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isIngesting ? (
              <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
            ) : (
              <FolderInput className="w-3.5 h-3.5 text-amber-400" />
            )}
            <span>Ingest</span>
          </button>

          {/* 2. Sync to SD Card */}
          <button
            type="button"
            onClick={onStartSync}
            disabled={!isMounted || busy}
            title={
              isMounted
                ? `Sync to SD Card (${selectedVol.name})`
                : 'Insert or mount target SD card'
            }
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/40 transition shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSyncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-400" />
            ) : (
              <HardDriveUpload className="w-3.5 h-3.5" />
            )}
            <span>Sync</span>
          </button>

          {/* 3. Eject SD Card */}
          <button
            type="button"
            onClick={onEjectVolume}
            disabled={!isMounted || busy}
            title={
              isMounted
                ? `Eject SD Card (${selectedVol.name})`
                : 'No SD Card mounted'
            }
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-900 hover:bg-red-500/10 text-zinc-400 hover:text-red-400 border border-zinc-800 hover:border-red-500/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isEjecting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-red-400" />
            ) : (
              <EjectIcon className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">Eject</span>
          </button>
        </div>
      </div>
    </section>
  );
});

export default SyncPanel;
