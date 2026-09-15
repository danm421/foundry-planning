import { describe, it, expect } from "vitest";
import { ALL_MCP_TOOLS } from "../tools";

describe("the MCP tool registry", () => {
  it("exposes exactly 17 tools", () => {
    expect(ALL_MCP_TOOLS).toHaveLength(17);
  });

  it("has unique names, each at most 64 characters", () => {
    const names = ALL_MCP_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n.length).toBeLessThanOrEqual(64);
  });

  it("annotates every tool read-only, which the directory requires", () => {
    for (const t of ALL_MCP_TOOLS) {
      expect(t.annotations).toEqual({
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      });
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });

  it("never says co-client, and never promises a goals entity", () => {
    for (const t of ALL_MCP_TOOLS) {
      expect(t.description.toLowerCase()).not.toContain("co-client");
    }
    expect(ALL_MCP_TOOLS.map((t) => t.name)).not.toContain("get_goals");
  });
});
