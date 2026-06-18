import { describe, it, expect, vi } from "vitest";

const dispatch = vi.fn();
vi.mock("@langchain/core/callbacks/dispatch", () => ({
  dispatchCustomEvent: (...a: unknown[]) => dispatch(...a),
}));

import { emitNavigate, emitToolRender, emitActivity, NAVIGATE_ALLOWLIST_PREFIXES } from "../custom-events";

describe("custom events", () => {
  it("emitNavigate dispatches a navigate frame for an allowlisted href", async () => {
    await emitNavigate("/clients/c1/scenarios/s1");
    expect(dispatch).toHaveBeenCalledWith("navigate", { href: "/clients/c1/scenarios/s1" });
  });

  it("emitNavigate rejects an off-allowlist href", async () => {
    await expect(emitNavigate("https://evil.example.com")).rejects.toThrow();
    expect(NAVIGATE_ALLOWLIST_PREFIXES.length).toBeGreaterThan(0);
  });

  it("emitToolRender dispatches a tool_render frame", async () => {
    await emitToolRender("run_projection", "complete", { median: 1 });
    expect(dispatch).toHaveBeenCalledWith("tool_render", {
      name: "run_projection",
      status: "complete",
      data: { median: 1 },
    });
  });

  it("emitActivity dispatches an activity frame", async () => {
    await emitActivity("Loading plan…");
    expect(dispatch).toHaveBeenCalledWith("activity", { label: "Loading plan…" });
  });
});
