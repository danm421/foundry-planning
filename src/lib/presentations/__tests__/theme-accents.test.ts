import { describe, it, expect } from "vitest";
import {
  SECTION_ACCENTS,
  DEFAULT_ACCENT,
  ZEBRA_FILL,
  PRESENTATION_THEME,
} from "../theme";
import { CATEGORY_ORDER } from "@/components/presentations/registry";

const HEX = /^#[0-9a-fA-F]{6}$/;

describe("section accents", () => {
  it("maps every presentation category", () => {
    for (const category of CATEGORY_ORDER) {
      expect(SECTION_ACCENTS[category], `missing accent for ${category}`).toBeDefined();
    }
  });

  it("uses valid 6-digit hex for accent and tint", () => {
    for (const { accent, tint } of Object.values(SECTION_ACCENTS)) {
      expect(accent).toMatch(HEX);
      expect(tint).toMatch(HEX);
    }
    expect(ZEBRA_FILL).toMatch(HEX);
  });

  it("defaults to the amber brand pair", () => {
    expect(DEFAULT_ACCENT.accent).toBe(PRESENTATION_THEME.accent);
    expect(DEFAULT_ACCENT.tint).toBe(PRESENTATION_THEME.accentTint);
    expect(SECTION_ACCENTS["Framing"]).toEqual(DEFAULT_ACCENT);
  });
});
