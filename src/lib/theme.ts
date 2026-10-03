export const THEME_COOKIE = "theme";

export type Theme = "light" | "industrial";

const THEMES: readonly Theme[] = ["light", "industrial"];

/** What an advisor sees before they ever touch the toggle. The ThemeToggle's
 *  initial client state must match this or the icon swaps after mount. */
export const DEFAULT_THEME: Theme = "industrial";

/**
 * Resolve the persisted theme from the cookie value. Industrial Dark is the
 * default — only a literal known theme name opts out of it, so any missing or
 * malformed cookie renders the (no-flash) Industrial Dark default. That
 * includes a legacy `dark` cookie: the original near-black theme is retired,
 * and its block in globals.css survives only as the base the others override.
 */
export function resolveTheme(cookieValue: string | undefined): Theme {
  return THEMES.includes(cookieValue as Theme)
    ? (cookieValue as Theme)
    : DEFAULT_THEME;
}

/** Clerk ships a dark and a light appearance only; Industrial Dark is dark. */
export function isDarkTheme(theme: Theme): boolean {
  return theme !== "light";
}

/** The two-way split that chart palettes and print themes are built on.
 *  Industrial Dark is a dark surface, so it renders on the dark palette. */
export type PaletteTheme = "dark" | "light";

export function paletteTheme(theme: Theme): PaletteTheme {
  return theme === "light" ? "light" : "dark";
}
