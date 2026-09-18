import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Foundry's theme contrast contract, made executable.
 *
 * Sibling tests pin Tailwind class names, which proves a class is present — not
 * that it has any contrast. The numbers those classes resolve to live in
 * globals.css, so retuning a token toward its background reintroduces the
 * reported defect ("Light View is just a gray version") with every class pin
 * still green.
 *
 * Split by token family, on purpose. The 2026-09-16 design work measured all
 * three themes and found the same class of defect in each. The INK retune has
 * landed everywhere, so C9-C11 run against all three. The SURFACE retune has
 * only landed for light; dark and industrial still sit at values that would
 * fail C1, C3, C6, C7 and C8, and asserting them now would land a red ratchet,
 * which is worse than none. The floors are theme-independent — when the dark
 * and industrial surfaces are retuned, fold SURFACE_THEMES into ALL_THEMES and
 * delete this paragraph.
 *
 * Contract C1–C12 is Part 1 of
 * ~/Documents/brain/20-projects/foundry-planning/specs/2026-09-16-theme-contrast-and-layering-design.md.
 * If this goes red, re-measure and move the token — never lower a floor.
 */

const CSS = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

/**
 * Surface floors (C1-C8) are light-only: dark and industrial have not had their
 * surface retune yet and would land a red ratchet. The INK floors below are not
 * so limited — the ink retune HAS shipped for all three, so they all hold.
 */
const SURFACE_THEMES = ["light"] as const;
const ALL_THEMES = ["dark", "light", "industrial"] as const;
type Theme = (typeof ALL_THEMES)[number];

/** Resting surfaces: what content sits on. hover/active are STATES, not surfaces. */
const RESTING = ["paper", "card", "card-2"] as const;

function themeBlock(theme: Theme): string {
  const m = CSS.match(new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`, "m"));
  if (!m) throw new Error(`globals.css has no :root[data-theme="${theme}"] block`);
  return m[1];
}

/** Throws rather than defaulting: a colour test that substitutes black passes for the wrong reason. */
function token(theme: Theme, name: string): [number, number, number] {
  const m = themeBlock(theme).match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`[${theme}] --color-${name} is not defined`);
  const v = m[1].trim();
  if (!/^#[0-9a-f]{6}$/i.test(v)) {
    throw new Error(`[${theme}] --color-${name} is "${v}", not a 6-digit hex`);
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

const ratio = (t: Theme, a: string, b: string) => contrast(token(t, a), token(t, b));
const worstOnResting = (t: Theme, name: string) =>
  Math.min(...RESTING.map((s) => ratio(t, name, s)));

describe("theme contrast contract", () => {
  // Guard the guard: a parser that silently matched nothing would make every
  // assertion below vacuous. Prove it reads real, authored values.
  it("actually parses each theme's own block out of globals.css", () => {
    // Distinct authored values per theme: a regex that matched the wrong block
    // (or nothing) would make every assertion below vacuous.
    expect(token("light", "paper")).toEqual([0xee, 0xe9, 0xdd]);
    expect(token("dark", "paper")).toEqual([0x0b, 0x0c, 0x0f]);
    expect(token("industrial", "paper")).toEqual([0x11, 0x14, 0x19]);
    expect(() => token("light", "no-such-token")).toThrow(/not defined/);
  });

  describe.each(SURFACE_THEMES)("%s surfaces", (theme) => {
    it("C1 card lifts off paper (>= 1.16)", () => {
      expect(ratio(theme, "card", "paper")).toBeGreaterThanOrEqual(1.16);
    });
    it("C2 card-2 reads as nested on card (>= 1.10)", () => {
      expect(ratio(theme, "card-2", "card")).toBeGreaterThanOrEqual(1.1);
    });
    it("C3 hover is visible against card (>= 1.12)", () => {
      expect(ratio(theme, "card-hover", "card")).toBeGreaterThanOrEqual(1.12);
    });
    it("C4 a hovered row never swallows its own card-2 controls (>= 1.06)", () => {
      expect(ratio(theme, "card-hover", "card-2")).toBeGreaterThanOrEqual(1.06);
    });
    it("C5 pressed differs from hovered (>= 1.06)", () => {
      expect(ratio(theme, "card-active", "card-hover")).toBeGreaterThanOrEqual(1.06);
    });
    // C6 is the interactive boundary: the border of something you can click or
    // type into. WCAG 1.4.11 puts non-text UI at 3:1, and no Foundry hairline
    // cleared it anywhere before this retune. `hair-3` carries the role.
    it("C6 the interactive hairline clears WCAG 1.4.11 on every resting surface (>= 3.0)", () => {
      expect(worstOnResting(theme, "hair-3")).toBeGreaterThanOrEqual(3.0);
    });
    it("C7 hair-2 is a structural divider (>= 2.10)", () => {
      expect(worstOnResting(theme, "hair-2")).toBeGreaterThanOrEqual(2.1);
    });
    it("C8 hair is a visible quiet divider (>= 1.55)", () => {
      expect(worstOnResting(theme, "hair")).toBeGreaterThanOrEqual(1.55);
    });
    it.each(["accent", "good", "warn", "crit"])("C12 %s clears AA as text", (hue) => {
      expect(worstOnResting(theme, hue)).toBeGreaterThanOrEqual(4.5);
    });
  });

  describe.each(ALL_THEMES)("%s ink", (theme) => {
    it.each(["ink", "ink-2", "ink-3"])("C9 %s clears AA on every resting surface", (ink) => {
      expect(worstOnResting(theme, ink)).toBeGreaterThanOrEqual(4.5);
    });
    // ink-4 is documented as "disabled text" but has ~540 live uses — helper
    // copy, notes, icon buttons. It carries content, so it holds AA. Industrial
    // shipped at 2.79:1 until the 2026-09-17 lift.
    it("C10 ink-4 clears AA", () => {
      expect(worstOnResting(theme, "ink-4")).toBeGreaterThanOrEqual(4.5);
    });
    it("C11 ink-3 and ink-4 stay distinguishable (>= 1.15)", () => {
      expect(ratio(theme, "ink-3", "ink-4")).toBeGreaterThanOrEqual(1.15);
    });
    // C11 alone is direction-blind: it sorts the two luminances, so a ramp
    // where ink-4 is LOUDER than ink-3 satisfies it. Lifting industrial ink-4
    // to clear C10 does exactly that if ink-3 is left behind (it measured 1.18
    // apart, inverted). Order is part of the contract, not a side effect.
    it("C11b ink-4 stays QUIETER than ink-3, not merely different", () => {
      expect(worstOnResting(theme, "ink-4")).toBeLessThan(worstOnResting(theme, "ink-3"));
    });
  });
});
