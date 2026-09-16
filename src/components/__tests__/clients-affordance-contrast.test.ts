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

    // The secondary button's grey fill. `control` exists because `hair-3`,
    // the strongest neutral in the palette, only reached 2.30:1 and read as a
    // smudge; anything quieter is what already failed twice.
    it("gives the grey CRM button a fill that separates from the card", () => {
      expect(contrast(token(theme, "control"), card())).toBeGreaterThanOrEqual(1.5);
    });

    it("keeps the CRM label readable on that grey fill", () => {
      expect(contrast(token(theme, "ink"), token(theme, "control"))).toBeGreaterThanOrEqual(AA);
    });

    // The primary button. `action` is the brand hue tuned to CARRY A LABEL,
    // which `accent` is not: the dark `accent` is tuned to read as accent TEXT
    // on a card, and a near-white label on it measures 3.32:1.
    it("gives the Planning button a fill with real presence", () => {
      expect(contrast(token(theme, "action"), card())).toBeGreaterThanOrEqual(3);
    });

    it("keeps the Planning label readable on the accent fill", () => {
      expect(contrast(token(theme, "action-on"), token(theme, "action"))).toBeGreaterThanOrEqual(AA);
    });

    // Hover is a state a keyboard or pointer user reads for real, so it holds
    // AA too. The CRM pill hovers onto `action` and swaps to `action-on`; the
    // Planning pill DEEPENS to `action-ink` rather than brightening, because a
    // brighter verdigris is exactly what its near-white label cannot sit on.
    it("keeps both labels readable on their hover fills", () => {
      expect(contrast(token(theme, "action-on"), token(theme, "action"))).toBeGreaterThanOrEqual(AA);
      expect(contrast(token(theme, "action-on"), token(theme, "action-ink"))).toBeGreaterThanOrEqual(AA);
    });

    // Neither button may dissolve into the row it sits on when that row is
    // hovered — the original complaint was half about exactly this.
    it("keeps both fills distinct from the hovered row", () => {
      const rowHover = token(theme, "card-hover");
      expect(contrast(token(theme, "control"), rowHover)).toBeGreaterThanOrEqual(1.5);
      expect(contrast(token(theme, "action"), rowHover)).toBeGreaterThanOrEqual(2.5);
    });

    // `control` is boxed in from BOTH sides, and each end has its own reason.
    //
    // Floor: it must separate from the card, because it is the CRM button's
    // fill AND the status box's border — and the status box has no fill of its
    // own to fall back on, so a faint border means no box at all. The old
    // `hair-2` border measured 1.92:1 on cream and simply did not draw.
    //
    // Ceiling: the `ink` assertion above. Lightening it on the dark themes or
    // darkening it on cream eventually eats the label.
    it("keeps the control fill separated enough to draw a box on its own", () => {
      expect(contrast(token(theme, "control"), card())).toBeGreaterThanOrEqual(2.5);
    });

    // Originally compared against `hair-3`. That held while `hair-3` was a
    // faint decorative hairline, but the 2026-09-16 light retune promoted it
    // to the INTERACTIVE boundary and pushed it to 3.69:1 on cream so it
    // clears WCAG 1.4.11's 3:1 — which is the whole point of that work. A
    // border that has to be seen and a fill that has to carry a label are no
    // longer the same kind of thing, and on cream no value satisfies both
    // "3:1 on paper" and "dimmer than control on card" at once.
    //
    // What the clause actually protects is unchanged and still pinned: the
    // grey fill must outrank the app's structural DIVIDER, so the secondary
    // button never reads as a hairline box. `control >= hair-2` says that
    // directly, and the absolute >= 2.5 floor above still guards the fill.
    it("keeps the control fill more present than a structural divider", () => {
      expect(contrast(token(theme, "control"), card())).toBeGreaterThanOrEqual(
        contrast(token(theme, "hair-2"), card()),
      );
    });

    // The status box is a `bg-paper` select — one step BEHIND the card — so
    // what has to hold is its label on `paper`, not on the card.
    it("keeps the status label readable in its own well", () => {
      expect(contrast(token(theme, "ink-2"), token(theme, "paper"))).toBeGreaterThanOrEqual(AA);
    });

    // The record NAME is the other half of "is anything here clickable". Its
    // underline is now HOVER-ONLY, so what has to hold is the hovered state:
    // the name turns `accent` and the underline paints with it.
    it("keeps the hovered record name readable on the row it sits on", () => {
      expect(contrast(token(theme, "accent"), token(theme, "card-hover"))).toBeGreaterThanOrEqual(3);
    });
  });
});
