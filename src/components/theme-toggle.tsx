"use client";

import { useEffect, useState } from "react";
import { DEFAULT_THEME, THEME_COOKIE, type Theme } from "@/lib/theme";

// Inline Lucide-style outline icons — lucide-react is not a dependency in this
// repo. strokeWidth 1.5, currentColor, per the foundry-design icon spec.
function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="m4.93 4.93 1.41 1.41" />
      <path d="m17.66 17.66 1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="m6.34 17.66-1.41 1.41" />
      <path d="m19.07 4.93-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

// Industrial Dark — a plotted grid, matching the theme's own line-first,
// architectural-drawing language.
function GridIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="18" height="18" rx="1" />
      <path d="M3 9h18" />
      <path d="M3 15h18" />
      <path d="M9 3v18" />
      <path d="M15 3v18" />
    </svg>
  );
}

// Cycle order. Each entry names the theme the button moves TO, so the icon and
// label always describe the next state rather than the current one.
const NEXT: Record<Theme, Theme> = {
  dark: "light",
  light: "industrial",
  industrial: "dark",
};

const THEME_LABELS: Record<Theme, string> = {
  dark: "dark",
  light: "light",
  industrial: "industrial",
};

function isTheme(value: string | undefined): value is Theme {
  return value === "dark" || value === "light" || value === "industrial";
}

export function ThemeToggle() {
  // The server renders <html data-theme=…> from the cookie; sync to it on mount
  // so the icon matches without a hydration mismatch. Seed from DEFAULT_THEME so
  // an advisor with no cookie — now the common case — sees the right icon on the
  // first paint instead of one that swaps after hydration.
  const [theme, setTheme] = useState<Theme>(DEFAULT_THEME);

  useEffect(() => {
    const current = document.documentElement.dataset.theme;
    if (isTheme(current)) setTheme(current);
  }, []);

  function toggle() {
    const next = NEXT[theme];
    const root = document.documentElement;
    root.dataset.theme = next;
    root.classList.remove(theme);
    root.classList.add(next);
    document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    setTheme(next);
  }

  const label = `Switch to ${THEME_LABELS[NEXT[theme]]} theme`;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center rounded-md border border-hair bg-card-2 p-2 text-ink-2 transition-colors hover:border-accent hover:text-accent"
    >
      {theme === "dark" ? <SunIcon /> : theme === "light" ? <GridIcon /> : <MoonIcon />}
    </button>
  );
}
