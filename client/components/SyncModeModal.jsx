import React, { useState, useEffect } from 'react';
import { Folder, FolderTree, AlertTriangle, RefreshCw, X } from 'lucide-react';

export default function SyncModeModal({
  isOpen,
  onClose,
  onConfirm,
  targetName = 'Target Device',
}) {
  const [selectedMode, setSelectedMode] = useState('single');

  useEffect(() => {
    if (isOpen) {
      setSelectedMode('single');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleConfirm = () => {
    onConfirm?.(selectedMode);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 dark:border-zinc-800">
          <div>
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Choose Sync Layout Mode
            </h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
              Destination: <span className="font-medium text-zinc-700 dark:text-zinc-200">{targetName}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
            aria-label="Close modal"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode Options */}
        <div className="p-5 space-y-3">
          {/* Option 1: Single Folder */}
          <button
            type="button"
            onClick={() => setSelectedMode('single')}
            className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 ${
              selectedMode === 'single'
                ? 'bg-amber-500/10 border-amber-500/60 ring-1 ring-amber-500/40'
                : 'bg-zinc-50 dark:bg-zinc-950/60 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
            }`}
          >
            <div
              className={`mt-0.5 p-2 rounded-lg shrink-0 ${
                selectedMode === 'single'
                  ? 'bg-amber-500/20 text-amber-600 dark:text-amber-400'
                  : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <Folder className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Single Folder
                </span>
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    selectedMode === 'single'
                      ? 'border-amber-500 bg-amber-500'
                      : 'border-zinc-400 dark:border-zinc-600'
                  }`}
                >
                  {selectedMode === 'single' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1 leading-relaxed">
                Copies all tracks into a single flat <code className="px-1 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 font-mono text-[11px]">Music/</code> folder and writes <code className="px-1 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 font-mono text-[11px]">.m3u</code> playlist files.
              </p>
            </div>
          </button>

          {/* Option 2: Multi Folder */}
          <button
            type="button"
            onClick={() => setSelectedMode('multi')}
            className={`w-full text-left p-4 rounded-xl border transition-all cursor-pointer flex items-start gap-3.5 ${
              selectedMode === 'multi'
                ? 'bg-sky-500/10 border-sky-500/60 ring-1 ring-sky-500/40'
                : 'bg-zinc-50 dark:bg-zinc-950/60 border-zinc-200 dark:border-zinc-800 hover:border-zinc-300 dark:hover:border-zinc-700'
            }`}
          >
            <div
              className={`mt-0.5 p-2 rounded-lg shrink-0 ${
                selectedMode === 'multi'
                  ? 'bg-sky-500/20 text-sky-600 dark:text-sky-400'
                  : 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400'
              }`}
            >
              <FolderTree className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Multi Folder
                </span>
                <span
                  className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                    selectedMode === 'multi'
                      ? 'border-sky-500 bg-sky-500'
                      : 'border-zinc-400 dark:border-zinc-600'
                  }`}
                >
                  {selectedMode === 'multi' && (
                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-300 mt-1 leading-relaxed">
                Creates <code className="px-1 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 font-mono text-[11px]">Music/Library/</code> and separate <code className="px-1 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 font-mono text-[11px]">Music/&lt;Playlist&gt;/</code> subfolders with duplicated tracks (no <code className="px-1 py-0.5 rounded bg-zinc-200/70 dark:bg-zinc-800 font-mono text-[11px]">.m3u</code> files).
              </p>
            </div>
          </button>

          {/* Layout Reorganization Warning */}
          <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-800 dark:text-amber-200">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <span>
              Switching between <strong>Single Folder</strong> and <strong>Multi Folder</strong> reorganizes the target <code className="font-mono">Music/</code> directory layout on <strong>{targetName}</strong>.
            </span>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-3.5 bg-zinc-50 dark:bg-zinc-950/60 border-t border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-xs font-medium text-zinc-700 dark:text-zinc-300 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 transition flex items-center gap-1.5 shadow-sm cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Start Sync
          </button>
        </div>
      </div>
    </div>
  );
}
