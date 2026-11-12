import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/**
 * Generic, reusable floating context menu component.
 * Automatically clamps coordinates to stay within the viewport and closes on outside click or Escape.
 */
export default function ContextMenu({ x, y, items = [], onClose }) {
  const menuRef = useRef(null);
  const [position, setPosition] = useState({ top: y, left: x });

  // Calculate viewport boundaries so the context menu never clips off-screen
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const margin = 8;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let nextLeft = x;
    let nextTop = y;

    if (nextLeft + rect.width + margin > vw) {
      nextLeft = Math.max(margin, vw - rect.width - margin);
    }
    if (nextTop + rect.height + margin > vh) {
      nextTop = Math.max(margin, vh - rect.height - margin);
    }

    setPosition({ top: nextTop, left: nextLeft });
  }, [x, y, items]);

  // Dismiss on outside click, Escape key press, or scroll/resize
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };

    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    const handleScrollOrResize = () => {
      onClose();
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [onClose]);

  if (!items || items.length === 0) return null;

  return (
    <div
      ref={menuRef}
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
      onContextMenu={(e) => e.preventDefault()}
      className="fixed z-50 min-w-[230px] max-w-[320px] max-h-[80vh] overflow-y-auto rounded-xl bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md border border-zinc-200 dark:border-zinc-700/90 shadow-2xl shadow-zinc-950/20 dark:shadow-black/80 py-1.5 select-none animate-in fade-in duration-100"
      role="menu"
    >
      {items.map((item, idx) => {
        if (item.type === 'separator') {
          return (
            <hr
              key={`sep-${idx}`}
              className="border-zinc-200 dark:border-zinc-800 my-1"
            />
          );
        }

        const Icon = item.icon;

        return (
          <button
            key={item.key || `${item.label}-${idx}`}
            type="button"
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              onClose();
              item.onClick?.();
            }}
            className={`w-full px-3.5 py-2 text-left text-xs flex items-center justify-between gap-3 transition ${
              item.disabled
                ? 'text-zinc-400 dark:text-zinc-600 pointer-events-none cursor-not-allowed'
                : item.danger
                ? 'text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-700 dark:hover:text-red-300'
                : item.highlight
                ? 'text-amber-700 dark:text-amber-300 font-semibold hover:bg-amber-50 dark:hover:bg-amber-500/15'
                : 'text-zinc-800 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/90 hover:text-zinc-950 dark:hover:text-white'
            }`}
            role="menuitem"
            aria-disabled={Boolean(item.disabled)}
          >
            <span className="flex items-center gap-2.5 truncate">
              {Icon && (
                <Icon
                  className={`w-3.5 h-3.5 shrink-0 ${
                    item.disabled
                      ? 'text-zinc-300 dark:text-zinc-600'
                      : item.danger
                      ? 'text-red-600 dark:text-red-400'
                      : item.highlight
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-zinc-400 dark:text-zinc-400'
                  }`}
                />
              )}
              <span className="truncate">{item.label}</span>
            </span>

            {item.badge !== undefined && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 shrink-0">
                {item.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
