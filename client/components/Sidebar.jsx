import React, { memo, useState, useRef, useEffect } from 'react';
import {
  Library,
  ListMusic,
  Plus,
  Edit3,
  Copy,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import ContextMenu from './ContextMenu.jsx';

const Sidebar = memo(function Sidebar({
  totalLibraryTracks = 0,
  playlists = [],
  activePlaylistId = null,
  onSelectLibrary,
  onSelectPlaylist,
  onCreatePlaylist,
  onRenamePlaylist,
  onDuplicatePlaylist,
  onDeletePlaylist,
}) {
  const [contextMenu, setContextMenu] = useState(null); // { x, y, playlist: null | object }
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmDeletePl, setConfirmDeletePl] = useState(null);
  const renameInputRef = useRef(null);

  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  const handleEmptySpaceContextMenu = (e) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      playlist: null,
    });
  };

  const handlePlaylistContextMenu = (e, playlist) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      playlist,
    });
  };

  const startInlineRename = (playlist) => {
    setRenamingId(playlist.id);
    setRenameDraft(playlist.name);
  };

  const commitInlineRename = async (playlistId) => {
    const trimmed = renameDraft.trim();
    setRenamingId(null);
    if (!trimmed) return;
    await onRenamePlaylist(playlistId, trimmed);
  };

  const contextMenuItems = contextMenu
    ? contextMenu.playlist
      ? [
          {
            label: '+ New Playlist',
            icon: Plus,
            highlight: true,
            onClick: () => onCreatePlaylist(),
          },
          { type: 'separator' },
          {
            label: 'Rename Playlist',
            icon: Edit3,
            onClick: () => startInlineRename(contextMenu.playlist),
          },
          { type: 'separator' },
          {
            label: 'Copy Playlist',
            icon: Copy,
            onClick: () => onDuplicatePlaylist(contextMenu.playlist.id),
          },
          { type: 'separator' },
          {
            label: 'Delete Playlist',
            icon: Trash2,
            danger: true,
            onClick: () => setConfirmDeletePl(contextMenu.playlist),
          },
        ]
      : [
          {
            label: '+ New Playlist',
            icon: Plus,
            highlight: true,
            onClick: () => onCreatePlaylist(),
          },
        ]
    : [];

  return (
    <aside
      onContextMenu={handleEmptySpaceContextMenu}
      className="w-64 shrink-0 bg-zinc-100 dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800 flex flex-col select-none min-h-0 transition-colors"
    >
      {/* Top Master Library Link */}
      <div className="p-3">
        <div className="px-2.5 pb-1.5 text-[10px] font-mono uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
          Master Vault
        </div>
        <button
          type="button"
          onClick={onSelectLibrary}
          className={`w-full flex items-center justify-between px-3 py-2 rounded-r-lg text-sm transition cursor-pointer ${
            activePlaylistId === null
              ? 'bg-amber-500/15 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold border-l-2 border-amber-500 shadow-xs dark:shadow-none'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100 border-l-2 border-transparent'
          }`}
        >
          <span className="flex items-center gap-2.5 truncate">
            <Library className="w-4 h-4 shrink-0" />
            <span>Library</span>
          </span>
          <span
            className={`text-xs font-mono px-2 py-0.5 rounded-full ${
              activePlaylistId === null
                ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                : 'bg-zinc-200/80 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400'
            }`}
          >
            {totalLibraryTracks}
          </span>
        </button>

        <hr className="border-zinc-200 dark:border-zinc-800 my-2" />

        {/* Playlists Section Header */}
        <div className="px-2.5 py-1 flex items-center justify-between">
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 dark:text-zinc-500">
            Playlists (.m3u)
          </span>
          <button
            type="button"
            onClick={() => onCreatePlaylist()}
            title="New Playlist (or right-click sidebar)"
            className="p-1 rounded hover:bg-zinc-200/70 dark:hover:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:text-amber-600 dark:hover:text-amber-400 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Alphabetical Playlists List */}
      <div className="flex-1 overflow-y-auto px-3 pb-4 space-y-0.5">
        {playlists.length === 0 ? (
          <div className="px-2.5 py-6 text-center text-xs text-zinc-400 dark:text-zinc-500 border border-dashed border-zinc-300 dark:border-zinc-800/80 rounded-xl">
            <p className="text-zinc-600 dark:text-zinc-400 font-medium mb-1">No playlists yet</p>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              Right-click here or click <strong>+</strong> to create a playlist.
            </p>
          </div>
        ) : (
          playlists.map((pl) => {
            const isActive = activePlaylistId === pl.id;
            const isRenaming = renamingId === pl.id;
            const count = Array.isArray(pl.trackKeys) ? pl.trackKeys.length : 0;

            return (
              <div
                key={pl.id}
                onContextMenu={(e) => handlePlaylistContextMenu(e, pl)}
                className="group"
              >
                {isRenaming ? (
                  <div className="flex items-center gap-1 px-2 py-1 bg-white dark:bg-zinc-800 rounded-r-lg border-l-2 border-amber-500 shadow-xs dark:shadow-none">
                    <input
                      ref={renameInputRef}
                      type="text"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitInlineRename(pl.id);
                        } else if (e.key === 'Escape') {
                          setRenamingId(null);
                        }
                      }}
                      onBlur={() => commitInlineRename(pl.id)}
                      className="w-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 placeholder:text-zinc-400 dark:placeholder:text-zinc-500 text-xs px-2 py-1 rounded border border-amber-500/60 focus:outline-none"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        commitInlineRename(pl.id);
                      }}
                      className="p-1 text-emerald-600 dark:text-emerald-400 hover:text-emerald-500 cursor-pointer"
                      title="Save"
                    >
                      <Check className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setRenamingId(null);
                      }}
                      className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
                      title="Cancel"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => onSelectPlaylist(pl.id)}
                    onDoubleClick={() => startInlineRename(pl)}
                    className={`w-full flex items-center justify-between px-3 py-2 rounded-r-lg text-sm transition cursor-pointer ${
                      isActive
                        ? 'bg-amber-500/15 dark:bg-amber-500/15 text-amber-700 dark:text-amber-400 font-semibold border-l-2 border-amber-500 shadow-xs dark:shadow-none'
                        : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200/70 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100 border-l-2 border-transparent'
                    }`}
                  >
                    <span className="flex items-center gap-2.5 truncate">
                      <ListMusic
                        className={`w-4 h-4 shrink-0 ${
                          isActive ? 'text-amber-500 dark:text-amber-400' : 'text-cyan-600 dark:text-cyan-400/80'
                        }`}
                      />
                      <span className="truncate" title={pl.name}>
                        {pl.name}
                      </span>
                    </span>
                    <span
                      className={`text-xs font-mono px-1.5 py-0.5 rounded-full shrink-0 ${
                        isActive
                          ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300'
                          : 'bg-zinc-200/80 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400'
                      }`}
                    >
                      {count}
                    </span>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Floating Sidebar Context Menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Delete Playlist Confirmation Modal */}
      {confirmDeletePl && (
        <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl max-w-sm w-full p-5 shadow-2xl space-y-4">
            <div className="flex items-center gap-2.5 text-red-500 dark:text-red-400">
              <Trash2 className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                Delete Playlist &ldquo;{confirmDeletePl.name}&rdquo;?
              </h3>
            </div>
            <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
              This will remove the playlist from <code className="text-zinc-800 dark:text-zinc-300">.vault_index.json</code> and delete{' '}
              <code className="text-amber-600 dark:text-amber-300">{confirmDeletePl.name}.m3u</code>. Your audio tracks in the Vault will not be deleted.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-200 dark:border-zinc-800">
              <button
                type="button"
                onClick={() => setConfirmDeletePl(null)}
                className="px-3.5 py-1.5 rounded-lg text-xs font-medium bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-300 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  const target = confirmDeletePl;
                  setConfirmDeletePl(null);
                  await onDeletePlaylist(target.id, target.name);
                }}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white cursor-pointer"
              >
                Delete Playlist
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
});

export default Sidebar;
