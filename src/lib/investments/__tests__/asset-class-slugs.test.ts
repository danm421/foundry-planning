import { describe, it, expect } from "vitest";
import { ASSET_CLASS_SLUGS, ASSET_CLASS_NAME_TO_SLUG, isAssetClassSlug, isLockedSystemAssetClass } from "../asset-class-slugs";
import { DEFAULT_ASSET_CLASSES } from "../../cma-seed";

describe("canonical asset-class slugs", () => {
  it("has exactly 16 unique slugs", () => {
    expect(ASSET_CLASS_SLUGS.length).toBe(16);
    expect(new Set(ASSET_CLASS_SLUGS).size).toBe(16);
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

describe("cash system slug", () => {
  it("includes cash in the canonical set", () => {
    expect(isAssetClassSlug("cash")).toBe(true);
    expect(ASSET_CLASS_SLUGS).toContain("cash");
  });
  it("locks only the cash slug as a system class", () => {
    expect(isLockedSystemAssetClass("cash")).toBe(true);
    expect(isLockedSystemAssetClass("inflation")).toBe(false);
    expect(isLockedSystemAssetClass(null)).toBe(false);
  });
});
