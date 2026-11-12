import React, { createContext, useContext, useState, useLayoutEffect, useCallback } from 'react';
import { flushSync } from 'react-dom';

const ThemeContext = createContext({
  theme: 'dark',
  toggleTheme: () => {},
  setTheme: () => {},
});

export const STORAGE_KEY_THEME = 'av_theme';

function applyTheme(nextTheme) {
  const isDark = nextTheme === 'dark';
  document.documentElement.classList.toggle('dark', isDark);
  if (document.body) {
    document.body.classList.toggle('dark', isDark);
  }
  document.documentElement.style.colorScheme = nextTheme;
  try {
    localStorage.setItem(STORAGE_KEY_THEME, nextTheme);
  } catch {
    // Ignore localStorage write errors
  }
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_THEME);
      if (saved === 'light' || saved === 'dark') {
        return saved;
      }
    } catch {
      // Ignore localStorage read errors
    }
    return 'dark';
  });

  useLayoutEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';

    if (!document.startViewTransition) {
      applyTheme(nextTheme);
      setThemeState(nextTheme);
      return;
    }

    // Suppress per-element CSS transitions so the new frame snaps in 1ms
    document.documentElement.classList.add('theme-switching');

    const transition = document.startViewTransition(() => {
      applyTheme(nextTheme);
      flushSync(() => {
        setThemeState(nextTheme);
      });
    });

    transition.finished.finally(() => {
      document.documentElement.classList.remove('theme-switching');
    });
  }, [theme]);

  const setTheme = useCallback((newTheme) => {
    if (newTheme === 'dark' || newTheme === 'light') {
      applyTheme(newTheme);
      setThemeState(newTheme);
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
}

export default ThemeContext;
