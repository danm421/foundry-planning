import { describe, it, expect } from "vitest";
import {
  PRESENTATION_PAGES,
  type PresentationPage,
} from "@/components/presentations/registry";
import { tidbitsById } from "@/lib/presentations/tidbits";
import {
  EARLY_YEARS_TIDBITS_OPTIONS_DEFAULT,
  TIDBITS_PAGE_MAX,
} from "@/lib/presentations/pages/early-years-tidbits/types";

/**
 * Each Early Years sheet picks its own default tidbits, and no note is meant to
 * appear twice in one deck — an advisor who hands a client eight sheets should
 * not find the same paragraph on two of them.
 *
 * That rule spans seven files, so no single one of them can hold it. This is
 * where it lives. The roster is READ OFF the registry rather than listed here:
 * a hand-written list would leave the eighth sheet outside the very rule this
 * file exists to keep, and would do it silently.
 */
const EARLY_YEARS = Object.values(PRESENTATION_PAGES).filter(
  (p) => p.category === "Early Years",
) as PresentationPage<unknown, { tidbits: string[] }>[];

/** The back page IS its tidbits — six of them, in two columns. Every other
 *  sheet prints two beside a chart. */
const BACK_PAGE = "earlyYearsTidbits";
const SIDEBAR = EARLY_YEARS.filter((p) => p.id !== BACK_PAGE);

const picksOf = (page: (typeof EARLY_YEARS)[number]) => page.defaultOptions.tidbits;

describe("Early Years default tidbits", () => {
  it("finds every sheet through the registry", () => {
    // The roster is derived, so this is the assertion that the derivation still
    // finds anything at all — a renamed category would otherwise turn every
    // test below into a loop over nothing, all of them green.
    expect(EARLY_YEARS.length).toBeGreaterThanOrEqual(7);
    expect(EARLY_YEARS.map((p) => p.id)).toContain(BACK_PAGE);
  });

  it("names a real tidbit on every sheet", () => {
    // `tidbitsById` drops ids it cannot resolve, so a typo would show up as a
    // sidebar with one card in it — silently, and only in a rendered PDF.
    for (const page of EARLY_YEARS) {
      expect(tidbitsById(picksOf(page)).map((t) => t.id), page.id).toEqual(picksOf(page));
    }
  });

  it("never repeats a note across the deck", () => {
    const seen = new Map<string, string>();
    const repeats: string[] = [];
    for (const page of EARLY_YEARS) {
      for (const id of picksOf(page)) {
        const first = seen.get(id);
        if (first) repeats.push(`${id}: ${first} and ${page.id}`);
        else seen.set(id, page.id);
      }
    }
    expect(repeats).toEqual([]);
  });

  it("fills every slot each sheet has", () => {
    // A sheet shipping one card where two fit is a half-empty sidebar, which
    // reads as a mistake rather than a choice.
    for (const page of SIDEBAR) expect(picksOf(page).length, page.id).toBe(2);
    expect(EARLY_YEARS_TIDBITS_OPTIONS_DEFAULT.tidbits.length).toBe(TIDBITS_PAGE_MAX);
  });

  it("ships a default the page's own schema accepts", () => {
    // The cap is enforced in the schema, not in the constant. A default over it
    // would be dropped on save, not rejected at the picker.
    for (const page of EARLY_YEARS) {
      expect(page.optionsSchema.safeParse(page.defaultOptions).success, page.id).toBe(true);
    }
  });
});
