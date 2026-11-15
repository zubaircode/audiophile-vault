import React, { useState, useEffect } from 'react';
import { FolderOpen, HardDrive, Save, X } from 'lucide-react';
import { formatBytes } from './SyncPanel.jsx';

export default function SettingsModal({
  isOpen,
  onClose,
  config,
  volumes = [],
  selectedVolumePath = '',
  onSelectVolume,
  onSaveSettings,
  onBrowseFolder,
}) {
  const [sourcePath, setSourcePath] = useState('');
  const [vaultPath, setVaultPath] = useState('');
  const [targetPath, setTargetPath] = useState('');

  useEffect(() => {
    if (isOpen) {
      setSourcePath(config.sourcePath || '');
      setVaultPath(config.vaultPath || '');
      setTargetPath(config.sdCardPath || selectedVolumePath || '');
    }
  }, [isOpen, config, selectedVolumePath]);

  if (!isOpen) return null;

  const handleSubmit = (e) => {
    e.preventDefault();
    onSaveSettings?.({
      sourcePath: sourcePath.trim(),
      vaultPath: vaultPath.trim(),
      targetPath: targetPath.trim(),
      sdCardPath: targetPath.trim(),
    });
  };

  const handleVolumeChange = (volPath) => {
    onSelectVolume?.(volPath);
    if (!volPath) {
      setTargetPath('');
      return;
    }
    const defaultMusic = volPath.endsWith('/Music')
      ? volPath
      : `${volPath}/Music`;
    setTargetPath(defaultMusic);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 dark:bg-black/75 backdrop-blur-sm animate-in fade-in duration-150"
    >
      <div className="bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-200 dark:border-zinc-700/80 rounded-2xl w-full max-w-xl shadow-2xl overflow-hidden flex flex-col transition-colors">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50/90 dark:bg-zinc-900/90">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center">
              <FolderOpen className="w-4 h-4 text-amber-500 dark:text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
                Audiophile Vault Settings
              </h2>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">
                SD Card &amp; Storage Configuration
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200 p-1.5 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition cursor-pointer"
            aria-label="Close settings"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Form Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-5 overflow-y-auto max-h-[80vh]">
          {/* Section 1: Target SD Card / Removable Volume */}
          <div className="space-y-3.5 pb-4 border-b border-zinc-200 dark:border-zinc-800/80">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
              <HardDrive className="w-4 h-4" />
              <span>Target SD Card &amp; Removable Volume</span>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Mounted Volume
              </label>
              <select
                value={selectedVolumePath}
                onChange={(e) => handleVolumeChange(e.target.value)}
                className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-amber-500 dark:focus:border-amber-500"
              >
                <option value="">— Select Mounted Volume in /Volumes —</option>
                {volumes.map((vol) => (
                  <option key={vol.path} value={vol.path}>
                    {vol.name} ({formatBytes(vol.freeSpace)} free / {formatBytes(vol.totalSpace)})
                  </option>
                ))}
              </select>
              <p className="text-[11px] text-zinc-500 mt-1">
                Works with any removable microSD card, external drive, or target audio directory.
              </p>
            </div>

            <div>
              <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                Sync Destination Directory on SD Card
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={targetPath}
                  onChange={(e) => setTargetPath(e.target.value)}
                  placeholder="/Volumes/SD_CARD/Music"
                  className="flex-1 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border border-zinc-300 dark:border-zinc-700 focus:border-amber-500 dark:focus:border-amber-500 rounded-lg px-3.5 py-2 text-sm font-mono focus:outline-none"
                />
                <button
                  type="button"
                  onClick={async () => {
                    const picked = await onBrowseFolder?.('target');
                    if (picked) setTargetPath(picked);
                  }}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 shrink-0 transition cursor-pointer"
                >
                  Browse…
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">
                Files and playlists are synchronized directly to this directory.
              </p>
            </div>
          </div>

          {/* Section 2: Master Source and Vault Paths */}
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5">
                Master Music Source Directory (Read-Only Scan)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={sourcePath}
                  onChange={(e) => setSourcePath(e.target.value)}
                  placeholder="/Users/zubaircode/Music/Music Alpha"
                  className="flex-1 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border border-zinc-300 dark:border-zinc-700 focus:border-amber-500 dark:focus:border-amber-500 rounded-lg px-3.5 py-2 text-sm font-mono focus:outline-none"
                  required
                />
                <button
                  type="button"
                  onClick={async () => {
                    const picked = await onBrowseFolder?.('source');
                    if (picked) setSourcePath(picked);
                  }}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 shrink-0 transition cursor-pointer"
                >
                  Browse…
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">
                Recursively scanned for DRM-free audio (.flac, .alac, .m4a, .mp3, .wav, .aiff, .aac, .ogg).
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400 mb-1.5">
                Flat Vault Staging Directory
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={vaultPath}
                  onChange={(e) => setVaultPath(e.target.value)}
                  placeholder="~/Music/AudiophileVault/"
                  className="flex-1 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border border-zinc-300 dark:border-zinc-700 focus:border-amber-500 dark:focus:border-amber-500 rounded-lg px-3.5 py-2 text-sm font-mono focus:outline-none"
                  required
                />
                <button
                  type="button"
                  onClick={async () => {
                    const picked = await onBrowseFolder?.('vault');
                    if (picked) setVaultPath(picked);
                  }}
                  className="px-3 py-2 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 shrink-0 transition cursor-pointer"
                >
                  Browse…
                </button>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">
                Flat staging archive with embedded artwork and universal relative playlists.
              </p>
            </div>
          </div>

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition shadow-sm cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Configuration</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
