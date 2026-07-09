// mobile/src/ui/data-color.ts
//
// Category/budget colors arrive from the API as `var(--data-*)` tokens.
// React Native can't parse CSS vars, so resolve them to the dark-theme hex
// here. Values mirror the dark-theme --data-* block in src/app/globals.css
// (the app is dark-only; there is no light-theme resolution path).

const DATA_HEX: Record<string, string> = {
  red: "#c0392b",
  blue: "#2c5fa8",
  green: "#2a8a5e",
  yellow: "#c99a1e",
  grey: "#9ca3af",
  orange: "#cf6a1f",
  purple: "#6a3fa0",
  teal: "#1f8a86",
  pink: "#a83f6a",
};
const FALLBACK = "#9ca3af"; // grey (matches --data-grey dark)

export function tokenToHex(color: string | null | undefined): string {
  if (!color) return FALLBACK;
  if (color.startsWith("#")) return color;
  const m = color.match(/^var\(--data-([a-z]+)\)$/) ?? color.match(/^([a-z]+)$/);
  const name = m?.[1];
  return (name && DATA_HEX[name]) || FALLBACK;
}
