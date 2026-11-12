import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import {
  Terminal,
  ChevronUp,
  ChevronDown,
  Trash2,
  Radio,
} from 'lucide-react';

function getBadgeStyle(type) {
  switch (type) {
    case 'INGEST':
      return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    case 'ARTWORK':
      return 'bg-sky-500/20 text-sky-300 border-sky-500/40';
    case 'SKIPPED':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'PLAYLIST':
      return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    case 'RSYNC':
      return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
    case 'DONE':
      return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
    case 'ERROR':
      return 'bg-red-500/15 text-red-300 border-red-500/30';
    default:
      return 'bg-zinc-800 text-zinc-400 border-zinc-700';
  }
}

const LogViewer = memo(function LogViewer({
  logs,
  onClearLogs,
  isOpen,
  onToggleOpen,
  isStreaming,
}) {
  const [filterType, setFilterType] = useState('ALL');
  const bottomRef = useRef(null);

  const filteredLogs = useMemo(
    () =>
      filterType === 'ALL' ? logs : logs.filter((l) => l.type === filterType),
    [logs, filterType]
  );

  useEffect(() => {
    if (isOpen && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: 'auto' });
    }
  }, [filteredLogs.length, isOpen]);

  return (
    <footer
      className={`border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 flex flex-col transition-all duration-200 ${
        isOpen ? 'h-64' : 'h-10'
      }`}
    >
      {/* Drawer Header Bar */}
      <div className="h-10 px-6 bg-zinc-100 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border-b border-zinc-200 dark:border-zinc-800 flex items-center justify-between select-none transition-colors">
        <button
          type="button"
          onClick={onToggleOpen}
          className="flex items-center gap-2.5 text-xs font-mono uppercase tracking-wider text-zinc-700 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-white cursor-pointer"
        >
          <Terminal className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          <span>Live Pipeline Console (SSE)</span>
          <span className="px-2 py-0.5 rounded-full bg-zinc-200 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 text-[11px]">
            {logs.length}
          </span>
          {isStreaming && (
            <span className="inline-flex items-center gap-1 text-[11px] text-cyan-600 dark:text-cyan-400">
              <Radio className="w-3.5 h-3.5 animate-pulse" />
              LIVE
            </span>
          )}
        </button>

        <div className="flex items-center gap-2">
          {isOpen && (
            <div className="flex items-center gap-1 mr-2">
              {['ALL', 'ARTWORK', 'PLAYLIST', 'INGEST', 'SKIPPED', 'RSYNC', 'DONE', 'ERROR'].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setFilterType(tab)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono transition cursor-pointer ${
                    filterType === tab
                      ? 'bg-amber-500 text-zinc-950 font-semibold'
                      : 'bg-zinc-200 dark:bg-zinc-800/70 text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                  }`}
                >
                  {tab}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={onClearLogs}
            title="Clear console output"
            className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={onToggleOpen}
            className="p-1 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200 transition cursor-pointer"
            aria-label={isOpen ? 'Collapse console' : 'Expand console'}
          >
            {isOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronUp className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Monospaced Log Stream Body */}
      {isOpen && (
        <div className="flex-1 overflow-y-auto px-6 py-2.5 font-mono text-xs space-y-1.5 bg-zinc-50 dark:bg-zinc-950 text-zinc-800 dark:text-zinc-300">
          {filteredLogs.length === 0 ? (
            <div className="text-zinc-400 dark:text-zinc-600 py-6 text-center">
              Waiting for pipeline events ([INGEST], [SKIPPED], [RSYNC], [DONE])…
            </div>
          ) : (
            filteredLogs.map((entry, index) => {
              const timeStr = entry.timestamp
                ? new Date(entry.timestamp).toLocaleTimeString('en-US', {
                    hour12: false,
                  })
                : '--:--:--';
              return (
                <div
                  key={`${entry.timestamp}-${index}`}
                  className="flex items-start gap-2.5 leading-relaxed hover:bg-zinc-200/50 dark:hover:bg-zinc-900/50 px-2 py-0.5 rounded"
                >
                  <span className="text-zinc-500 dark:text-zinc-500 shrink-0">{timeStr}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] border shrink-0 ${getBadgeStyle(
                      entry.type
                    )}`}
                  >
                    {entry.type}
                  </span>
                  <span className="text-zinc-800 dark:text-zinc-200 break-all">{entry.message}</span>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      )}
    </footer>
  );
});

export default LogViewer;
