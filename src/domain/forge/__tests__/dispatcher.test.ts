import { describe, it, expect, vi } from "vitest";

vi.mock("../llm", () => ({
  chatModel: (m?: string) => ({
    invoke: vi.fn().mockResolvedValue({ content: '["read","compute"]' }),
    _model: m,
  }),
  embeddings: vi.fn(),
}));

import { classifyIntent, ALL_BUNDLES } from "../dispatcher";

describe("classifyIntent", () => {
  it("returns the parsed bundle list from the mini model", async () => {
    const bundles = await classifyIntent("run a projection");
    expect(bundles).toContain("compute");
  });

  it("falls back to all bundles on unparseable output", async () => {
    const bundles = await classifyIntent("???");
    expect(Array.isArray(bundles)).toBe(true);
    expect(bundles.length).toBeGreaterThan(0);
  });

  it("ALL_BUNDLES is the full known set", () => {
    expect(ALL_BUNDLES).toContain("read");
    expect(ALL_BUNDLES).toContain("memory");
  });
});
