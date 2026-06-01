export const THEME_COOKIE = "theme";

export type Theme = "dark" | "light";

/**
 * Resolve the persisted theme from the cookie value. Dark is the default —
 * only the literal "light" opts into the light theme, so any missing or
 * malformed cookie renders the (no-flash) dark default.
 */
export function resolveTheme(cookieValue: string | undefined): Theme {
  return cookieValue === "light" ? "light" : "dark";
}
