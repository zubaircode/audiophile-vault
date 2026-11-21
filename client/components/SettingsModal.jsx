import React, { useState, useEffect } from 'react';
import {
  FolderOpen,
  Folder,
  ArrowUp,
  ChevronRight,
  HardDrive,
  Save,
  Wifi,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  ShieldAlert,
  Loader2,
  X,
} from 'lucide-react';
import { formatBytes } from './SyncPanel.jsx';
import { API_BASE } from '../utils/api.js';

export default function SettingsModal({
  isOpen,
  onClose,
  config,
  volumes = [],
  ftpServices = [],
  selectedVolumePath = '',
  onSelectVolume,
  onSaveSettings,
  onBrowseFolder,
}) {
  const [sourcePath, setSourcePath] = useState('');
  const [vaultPath, setVaultPath] = useState('');
  const [targetPath, setTargetPath] = useState('');
  const [syncTargetMode, setSyncTargetMode] = useState('sd');
  const [ftpServiceName, setFtpServiceName] = useState('WiFiFTP');
  const [ftpUsername, setFtpUsername] = useState('');
  const [ftpPassword, setFtpPassword] = useState('');
  const [ftpRemotePath, setFtpRemotePath] = useState('/');
  const [testingFtp, setTestingFtp] = useState(false);
  const [ftpTestResult, setFtpTestResult] = useState(null);
  const [showFtpBrowser, setShowFtpBrowser] = useState(false);
  const [ftpBrowserLoading, setFtpBrowserLoading] = useState(false);
  const [ftpBrowserError, setFtpBrowserError] = useState('');
  const [ftpBrowserData, setFtpBrowserData] = useState(null);
  const [verifyingWritable, setVerifyingWritable] = useState(false);
  const [writableStatus, setWritableStatus] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setSourcePath(config.sourcePath || '');
      setVaultPath(config.vaultPath || '');
      setTargetPath(config.sdCardPath || selectedVolumePath || '');
      setSyncTargetMode(config.syncTargetMode === 'ftp' ? 'ftp' : 'sd');
      setFtpServiceName(config.ftpServiceName || 'WiFiFTP');
      setFtpUsername(config.ftpUsername || '');
      setFtpPassword(config.ftpPassword || '');
      setFtpRemotePath(config.ftpRemotePath || '/');
      setFtpTestResult(null);
      setShowFtpBrowser(false);
      setFtpBrowserError('');
      setFtpBrowserData(null);
      setWritableStatus(null);
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
      syncTargetMode,
      ftpServiceName: ftpServiceName.trim() || 'WiFiFTP',
      ftpManualHost: '',
      ftpUsername: ftpUsername.trim(),
      ftpPassword,
      ftpRemotePath: ftpRemotePath.trim() || '/',
    });
  };

  const handleTestFtp = async () => {
    setTestingFtp(true);
    setFtpTestResult(null);
    try {
      const res = await fetch(`${API_BASE}/api/ftp/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ftpServiceName: ftpServiceName.trim() || 'WiFiFTP',
          ftpManualHost: '',
          ftpUsername: ftpUsername.trim(),
          ftpPassword,
          ftpRemotePath: ftpRemotePath.trim() || '/',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFtpTestResult({ ok: false, message: data.error || 'Connection test failed.' });
      } else {
        setFtpTestResult({
          ok: true,
          message: `Connected to ${data.serviceName} (${data.host}:${data.port}${data.remotePath}) — ${data.fileCount} items listed.`,
        });
      }
    } catch (err) {
      setFtpTestResult({ ok: false, message: err.message || 'Connection test failed.' });
    } finally {
      setTestingFtp(false);
    }
  };

  const ftpConnectionPayload = () => ({
    ftpServiceName: ftpServiceName.trim() || 'WiFiFTP',
    ftpManualHost: '',
    ftpUsername: ftpUsername.trim(),
    ftpPassword,
  });

  const loadFtpDirectory = async (targetDir = '/') => {
    setFtpBrowserLoading(true);
    setFtpBrowserError('');
    try {
      const res = await fetch(`${API_BASE}/api/ftp/list`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ftpConnectionPayload(),
          path: targetDir || '/',
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setFtpBrowserError(data.error || 'Failed to list remote FTP directory.');
      } else {
        setFtpBrowserData(data);
      }
    } catch (err) {
      setFtpBrowserError(err.message || 'Network error listing remote FTP directory.');
    } finally {
      setFtpBrowserLoading(false);
    }
  };

  const handleToggleFtpBrowser = async () => {
    const nextOpen = !showFtpBrowser;
    setShowFtpBrowser(nextOpen);
    if (nextOpen) {
      await loadFtpDirectory(ftpRemotePath.trim() || '/');
    }
  };

  const handleSelectFtpFolder = async (folderPath) => {
    const clean = (folderPath || '/').trim() || '/';
    setFtpRemotePath(clean);
    setVerifyingWritable(true);
    setWritableStatus(null);
    try {
      const res = await fetch(`${API_BASE}/api/ftp/verify-writable`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...ftpConnectionPayload(),
          path: clean,
        }),
      });
      const data = await res.json();
      setWritableStatus({
        writable: Boolean(data.writable),
        path: data.path || clean,
        error: data.error || '',
      });
    } catch (err) {
      setWritableStatus({
        writable: false,
        path: clean,
        error: err.message || 'Write verification request failed.',
      });
    } finally {
      setVerifyingWritable(false);
    }
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
          {/* Section 1: Sync Target Mode */}
          <div className="space-y-3.5 pb-4 border-b border-zinc-200 dark:border-zinc-800/80">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">
                {syncTargetMode === 'ftp' ? (
                  <Wifi className="w-4 h-4" />
                ) : (
                  <HardDrive className="w-4 h-4" />
                )}
                <span>Sync Target</span>
              </div>

              <div className="inline-flex rounded-lg bg-zinc-100 dark:bg-zinc-950 p-0.5 border border-zinc-200 dark:border-zinc-800">
                <button
                  type="button"
                  onClick={() => setSyncTargetMode('sd')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                    syncTargetMode === 'sd'
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  Removable SD Card
                </button>
                <button
                  type="button"
                  onClick={() => setSyncTargetMode('ftp')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition cursor-pointer ${
                    syncTargetMode === 'ftp'
                      ? 'bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 shadow-xs'
                      : 'text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200'
                  }`}
                >
                  Wi-Fi FTP (Bonjour)
                </button>
              </div>
            </div>

            {syncTargetMode === 'sd' ? (
              <>
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
              </>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1.5">
                    Discovered Bonjour FTP Service (_ftp._tcp.local.)
                  </label>
                  <select
                    value={ftpServiceName}
                    onChange={(e) => setFtpServiceName(e.target.value)}
                    className="w-full bg-white dark:bg-zinc-900 border border-zinc-300 dark:border-zinc-700 rounded-lg px-3.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:border-amber-500 dark:focus:border-amber-500"
                  >
                    {ftpServices.length === 0 ? (
                      <option value={ftpServiceName || 'WiFiFTP'}>
                        {ftpServiceName || 'WiFiFTP'} (Searching on local network…)
                      </option>
                    ) : (
                      <>
                        {!ftpServices.some(
                          (s) => s.instanceName?.toLowerCase() === (ftpServiceName || 'WiFiFTP').toLowerCase()
                        ) && (
                          <option value={ftpServiceName || 'WiFiFTP'}>
                            {ftpServiceName || 'WiFiFTP'} (Offline)
                          </option>
                        )}
                        {ftpServices.map((svc) => (
                          <option key={svc.instanceName} value={svc.instanceName}>
                            {svc.instanceName} {svc.resolved ? '(Ready)' : '(Resolving…)'}
                          </option>
                        ))}
                      </>
                    )}
                  </select>
                  <p className="text-[11px] text-zinc-500 mt-1">
                    Automatically resolves your player&apos;s dynamic IP and port via Bonjour.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Username (Blank = Anonymous)
                    </label>
                    <input
                      type="text"
                      value={ftpUsername}
                      onChange={(e) => setFtpUsername(e.target.value)}
                      placeholder="anonymous"
                      className="w-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border border-zinc-300 dark:border-zinc-700 focus:border-amber-500 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Password (Optional)
                    </label>
                    <input
                      type="password"
                      value={ftpPassword}
                      onChange={(e) => setFtpPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 border border-zinc-300 dark:border-zinc-700 focus:border-amber-500 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none"
                    />
                  </div>
                </div>

                <div className="flex items-end gap-2">
                  <div className="flex-1">
                    <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 mb-1">
                      Remote Folder Path
                    </label>
                    <input
                      type="text"
                      value={ftpRemotePath}
                      onChange={(e) => setFtpRemotePath(e.target.value)}
                      placeholder="/"
                      className="w-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-zinc-300 dark:border-zinc-700 focus:border-amber-500 rounded-lg px-3 py-1.5 text-xs font-mono focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleToggleFtpBrowser}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition cursor-pointer shrink-0 ${
                      showFtpBrowser
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-700 dark:text-amber-300'
                        : 'bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border-zinc-300 dark:border-zinc-700'
                    }`}
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                    <span>Browse Folders</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleTestFtp}
                    disabled={testingFtp}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 border border-zinc-300 dark:border-zinc-700 transition disabled:opacity-50 cursor-pointer shrink-0"
                  >
                    {testingFtp ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500" />
                    ) : (
                      <Wifi className="w-3.5 h-3.5 text-amber-500" />
                    )}
                    <span>{testingFtp ? 'Testing…' : 'Test Connection'}</span>
                  </button>
                </div>

                {showFtpBrowser && (
                  <div className="bg-zinc-100 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-lg overflow-hidden">
                    {/* Breadcrumb / Current Path Header */}
                    <div className="px-3 py-2 bg-zinc-200/70 dark:bg-zinc-900/90 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        {ftpBrowserData?.currentPath && ftpBrowserData.currentPath !== '/' && (
                          <button
                            type="button"
                            onClick={() => loadFtpDirectory(ftpBrowserData.parentPath || '/')}
                            disabled={ftpBrowserLoading}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 text-[11px] font-medium text-zinc-700 dark:text-zinc-200 hover:border-amber-500 transition cursor-pointer shrink-0"
                          >
                            <ArrowUp className="w-3 h-3" />
                            <span>Up (..)</span>
                          </button>
                        )}
                        <span
                          className="text-xs font-mono font-semibold text-zinc-800 dark:text-zinc-200 truncate"
                          title={ftpBrowserData?.currentPath || '/'}
                        >
                          {ftpBrowserData?.currentPath || '/'}
                        </span>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSelectFtpFolder(ftpBrowserData?.currentPath || '/')}
                        disabled={ftpBrowserLoading || verifyingWritable || !ftpBrowserData}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold bg-amber-500 hover:bg-amber-400 text-zinc-950 transition disabled:opacity-50 cursor-pointer shrink-0"
                      >
                        {verifyingWritable ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <ShieldCheck className="w-3 h-3" />
                        )}
                        <span>{verifyingWritable ? 'Verifying…' : 'Select This Folder'}</span>
                      </button>
                    </div>

                    {/* Scrollable Subdirectory List */}
                    <div className="max-h-56 overflow-y-auto divide-y divide-zinc-200/70 dark:divide-zinc-800/70">
                      {ftpBrowserLoading ? (
                        <div className="px-3 py-5 flex items-center justify-center gap-2 text-xs text-zinc-500">
                          <Loader2 className="w-4 h-4 animate-spin text-amber-500" />
                          <span>Listing remote FTP directory…</span>
                        </div>
                      ) : ftpBrowserError ? (
                        <div className="px-3 py-3 text-xs text-red-600 dark:text-red-400 flex items-center justify-between gap-2">
                          <span>{ftpBrowserError}</span>
                          <button
                            type="button"
                            onClick={() => loadFtpDirectory('/')}
                            className="px-2 py-1 rounded bg-zinc-200 dark:bg-zinc-800 text-zinc-800 dark:text-zinc-200 text-[11px] font-medium shrink-0 cursor-pointer"
                          >
                            Retry /
                          </button>
                        </div>
                      ) : ftpBrowserData?.directories?.length > 0 ? (
                        ftpBrowserData.directories.map((dir) => {
                          const nextPath =
                            ftpBrowserData.currentPath === '/'
                              ? `/${dir}`
                              : `${ftpBrowserData.currentPath}/${dir}`;
                          return (
                            <button
                              key={dir}
                              type="button"
                              onClick={() => loadFtpDirectory(nextPath)}
                              className="w-full px-3 py-2 flex items-center justify-between gap-2 text-left text-xs text-zinc-800 dark:text-zinc-200 hover:bg-zinc-200/60 dark:hover:bg-zinc-900/90 transition cursor-pointer"
                            >
                              <span className="flex items-center gap-2 min-w-0">
                                <Folder className="w-4 h-4 text-amber-500 shrink-0" />
                                <span className="font-mono truncate">{dir}</span>
                              </span>
                              <ChevronRight className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                            </button>
                          );
                        })
                      ) : (
                        <div className="px-3 py-3 text-xs text-zinc-500 italic">
                          No subdirectories in this folder
                        </div>
                      )}
                    </div>

                    {/* Folder Content Preview Footer */}
                    {ftpBrowserData && !ftpBrowserLoading && !ftpBrowserError && (
                      <div className="px-3 py-1.5 bg-zinc-200/50 dark:bg-zinc-900/60 border-t border-zinc-200 dark:border-zinc-800 flex items-center justify-between gap-2 text-[11px] text-zinc-600 dark:text-zinc-400">
                        <span>
                          {ftpBrowserData.audioFileCount > 0
                            ? `${ftpBrowserData.audioFileCount.toLocaleString()} audio files found in this folder`
                            : ftpBrowserData.directories.length === 0 && ftpBrowserData.totalFileCount === 0
                            ? 'Empty folder'
                            : `${ftpBrowserData.directories.length} folders, ${ftpBrowserData.totalFileCount} files`}
                        </span>
                        {ftpBrowserData.sampleFiles?.[0] && (
                          <span
                            className="font-mono text-[10px] text-zinc-500 truncate max-w-[220px]"
                            title={ftpBrowserData.sampleFiles[0]}
                          >
                            e.g. {ftpBrowserData.sampleFiles[0]}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {writableStatus && (
                  <div
                    className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${
                      writableStatus.writable
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-500/10 border-amber-500/40 text-amber-800 dark:text-amber-300'
                    }`}
                  >
                    {writableStatus.writable ? (
                      <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-emerald-500" />
                    ) : (
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
                    )}
                    <div>
                      {writableStatus.writable ? (
                        <span className="font-medium">
                          Writable SD Folder Verified ({writableStatus.path})
                        </span>
                      ) : (
                        <div className="space-y-0.5">
                          <div className="font-medium">
                            Read-Only / Permission Denied — Navigate into your Music subfolder or grant folder access in WiFi FTP Server
                          </div>
                          {writableStatus.error && (
                            <div className="text-[11px] opacity-80 font-mono">{writableStatus.error}</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {ftpTestResult && (
                  <div
                    className={`flex items-start gap-2 px-3 py-2 rounded-lg text-xs border ${
                      ftpTestResult.ok
                        ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                        : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300'
                    }`}
                  >
                    {ftpTestResult.ok ? (
                      <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    )}
                    <span>{ftpTestResult.message}</span>
                  </div>
                )}
              </div>
            )}
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
