import { describe, it, expect, vi } from "vitest";

const dispatch = vi.fn();
vi.mock("@langchain/core/callbacks/dispatch", () => ({
  dispatchCustomEvent: (...a: unknown[]) => dispatch(...a),
}));
vi.mock("../help/videos", async () => {
  const f = await import("../help/__tests__/help-video-fixtures");
  return { getHelpVideo: (s: string) => [f.EXPENSE_VIDEO].find((v) => v.slug === s) };
});

import {
  emitNavigate,
  emitToolRender,
  emitActivity,
  emitWalkthrough,
  emitVideoLink,
  NAVIGATE_ALLOWLIST_PREFIXES,
} from "../custom-events";

describe("custom events", () => {
  it("emitVideoLink dispatches a video_link frame with the catalog's title", async () => {
    await emitVideoLink("add-one-time-expense", { at: 30, label: "Set the years" });
    expect(dispatch).toHaveBeenCalledWith("video_link", {
      slug: "add-one-time-expense",
      title: "Add a one-time expense and see it in the cash flow",
      chapterAt: 30,
      chapterLabel: "Set the years",
    });
  });

  it("emitVideoLink rejects a slug that isn't in the details files", async () => {
    await expect(emitVideoLink("made-up")).rejects.toThrow();
  });

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

describe("emitWalkthrough", () => {
  it("dispatches a walkthrough frame for a real walkthrough id", async () => {
    await emitWalkthrough("add-household");
    expect(dispatch).toHaveBeenCalledWith("walkthrough", { walkthroughId: "add-household" });
  });

  it("rejects an unknown walkthrough id", async () => {
    await expect(emitWalkthrough("does-not-exist")).rejects.toThrow();
  });
});

describe("navigate allowlist covers global product-help targets", () => {
  it("allows /crm/new and the bare /clients list", async () => {
    await expect(emitNavigate("/crm/new")).resolves.toBeUndefined();
    await expect(emitNavigate("/clients")).resolves.toBeUndefined();
    await expect(emitNavigate("/tasks")).resolves.toBeUndefined();
  });
  it("still rejects an external url", async () => {
    await expect(emitNavigate("https://evil.example")).rejects.toThrow();
  });
  it("exports the broadened prefix list", () => {
    expect(NAVIGATE_ALLOWLIST_PREFIXES).toContain("/crm");
    expect(NAVIGATE_ALLOWLIST_PREFIXES).toContain("/tasks");
  });
});
