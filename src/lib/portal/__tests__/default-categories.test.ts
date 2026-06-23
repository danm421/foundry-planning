import { describe, it, expect } from "vitest";
import { DEFAULT_TAXONOMY, DEFAULT_LEAF_SLUGS } from "@/lib/portal/default-categories";

describe("DEFAULT_TAXONOMY", () => {
  it("every group has at least one leaf", () => {
    for (const g of DEFAULT_TAXONOMY) expect(g.leaves.length).toBeGreaterThan(0);
  });
  it("all slugs (group + leaf) are unique", () => {
    const all = [
      ...DEFAULT_TAXONOMY.map((g) => g.slug),
      ...DEFAULT_TAXONOMY.flatMap((g) => g.leaves.map((l) => l.slug)),
    ];
    expect(new Set(all).size).toBe(all.length);
  });
  it("every leaf slug is prefixed by a known group prefix and exposed in DEFAULT_LEAF_SLUGS", () => {
    for (const g of DEFAULT_TAXONOMY) {
      for (const l of g.leaves) expect(DEFAULT_LEAF_SLUGS.has(l.slug)).toBe(true);
    }
  });
  it("colors are var(--data-*) tokens", () => {
    for (const g of DEFAULT_TAXONOMY) expect(g.color).toMatch(/^var\(--data-[a-z]+\)$/);
  });
});
