export const THEME_COOKIE = "theme";

export type Theme = "dark" | "light";

/** What an advisor sees before they ever touch the toggle. The ThemeToggle's
 *  initial client state must match this or the icon swaps after mount. */
export const DEFAULT_THEME: Theme = "dark";

/**
 * Resolve the persisted theme from the cookie value. Dark is the default — only
 * the literal `light` opts out of it, so any missing or malformed cookie renders
 * the (no-flash) dark default. That includes a legacy `industrial` cookie: the
 * Industrial Dark theme is retired.
 */
export function resolveTheme(cookieValue: string | undefined): Theme {
  return cookieValue === "light" ? "light" : DEFAULT_THEME;
}
