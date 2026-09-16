import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * A contrast RATCHET for the Clients list's affordances.
 *
 * Why this exists: the sibling tests pin Tailwind class names, which proves a
 * class is present — not that it has any contrast. The numbers those classes
 * resolve to live in `globals.css`, so retuning `--color-hair-3` toward
 * `--color-card` would reintroduce the exact reported defect ("nothing on this
 * screen looks clickable") with every class pin still green.
 *
 * `scripts/browser-clients-affordance.local.mjs` measures the real thing
 * through a real page load, but it is gitignored, needs a dev server and a
 * Clerk key, and never runs in CI. It is an instrument. This is the ratchet.
 *
 * The floors below are the ones the component and `table-styles.ts` comments
 * already claim, per theme. If a token moves and this goes red, the fix is to
 * re-measure and move the affordance — not to lower the floor.
 */

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

const THEMES = ["dark", "light", "industrial"] as const;
type Theme = (typeof THEMES)[number];

/** Pull one theme's `:root[data-theme="…"]` block out of globals.css. */
function themeBlock(theme: Theme): string {
  const m = CSS.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`, "m"));
  if (!m) throw new Error(`globals.css has no :root[data-theme="${theme}"] block`);
  return m[1];
}

/**
 * Resolve one `--color-*` token to sRGB.
 *
 * Throws on a missing or non-hex token rather than returning a default: a
 * colour test that silently substitutes black passes for the wrong reason, and
 * every assertion below would then be measuring a value nobody authored.
 */
function token(theme: Theme, name: string): [number, number, number] {
  const m = themeBlock(theme).match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`[${theme}] --color-${name} is not defined`);
  const v = m[1].trim();
  if (!/^#[0-9a-f]{6}$/i.test(v)) {
    throw new Error(`[${theme}] --color-${name} is "${v}", not a 6-digit hex — this test cannot measure it`);
  }
  return [1, 3, 5].map((i) => parseInt(v.slice(i, i + 2), 16)) as [number, number, number];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

/** WCAG 2.x contrast ratio, 1:1 (identical) to 21:1 (black on white). */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AA = 4.5;

describe("Clients list affordance contrast (globals.css ratchet)", () => {
  // Guard the guard: if the parser silently found nothing, every `it` below
  // would vacuously pass. Prove it reads real, DIFFERENT values per theme.
  it("actually parses a distinct palette for each theme", () => {
    const cards = THEMES.map((t) => token(t, "card").join(","));
    expect(new Set(cards).size).toBe(THEMES.length);
    expect(() => token("dark", "no-such-token")).toThrow(/not defined/);
  });

  describe.each(THEMES)("%s theme", (theme) => {
    const card = () => token(theme, "card");

    // The secondary button's grey fill. `hair-3` is the strongest neutral the
    // palette has; anything quieter is what already failed twice.
    it("gives the grey CRM button a fill that separates from the card", () => {
      expect(contrast(token(theme, "hair-3"), card())).toBeGreaterThanOrEqual(1.5);
    });

    it("keeps the CRM label readable on that grey fill", () => {
      expect(contrast(token(theme, "ink"), token(theme, "hair-3"))).toBeGreaterThanOrEqual(AA);
    });

    // The primary button. The accent is the only token in the palette with
    // real presence against the card — this is what that claim rests on.
    it("gives the Planning button a fill with real presence", () => {
      expect(contrast(token(theme, "accent"), card())).toBeGreaterThanOrEqual(3);
    });

    it("keeps the Planning label readable on the accent fill", () => {
      expect(contrast(token(theme, "accent-on"), token(theme, "accent"))).toBeGreaterThanOrEqual(AA);
    });

    // Hover is a state a keyboard or pointer user reads for real, so it holds
    // AA too — both buttons land on an accent-family fill when hovered.
    it("keeps both labels readable on their hover fills", () => {
      expect(contrast(token(theme, "accent-on"), token(theme, "accent"))).toBeGreaterThanOrEqual(AA);
      expect(contrast(token(theme, "accent-on"), token(theme, "accent-ink"))).toBeGreaterThanOrEqual(AA);
    });

    // Neither button may dissolve into the row it sits on when that row is
    // hovered — the original complaint was half about exactly this.
    it("keeps both fills distinct from the hovered row", () => {
      const rowHover = token(theme, "card-hover");
      expect(contrast(token(theme, "hair-3"), rowHover)).toBeGreaterThanOrEqual(1.5);
      expect(contrast(token(theme, "accent"), rowHover)).toBeGreaterThanOrEqual(3);
    });

    // `table-styles.ts` claims this one in a comment (8.21 dark · 5.99 light ·
    // 4.70 industrial) and nothing else enforces it. The record NAME is the
    // other half of "is anything here clickable".
    it("keeps the record-name underline visible against the card", () => {
      expect(contrast(token(theme, "ink-3"), card())).toBeGreaterThanOrEqual(3);
    });
  });
});
