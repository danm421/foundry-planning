import { describe, it, expect } from "vitest";
import { ASSET_CLASS_SLUGS, ASSET_CLASS_NAME_TO_SLUG } from "../asset-class-slugs";
import { DEFAULT_ASSET_CLASSES } from "../../cma-seed";

describe("canonical asset-class slugs", () => {
  it("has exactly 15 unique slugs", () => {
    expect(ASSET_CLASS_SLUGS.length).toBe(15);
    expect(new Set(ASSET_CLASS_SLUGS).size).toBe(15);
  });

  it("every DEFAULT_ASSET_CLASSES entry has a slug in the canonical set", () => {
    for (const ac of DEFAULT_ASSET_CLASSES) {
      expect(ac.slug, `${ac.name} is missing a slug`).toBeDefined();
      expect(ASSET_CLASS_SLUGS).toContain(ac.slug);
    }
  });

  it("maps each canonical name to its slug", () => {
    for (const ac of DEFAULT_ASSET_CLASSES) {
      expect(ASSET_CLASS_NAME_TO_SLUG[ac.name]).toBe(ac.slug);
    }
  });
});
