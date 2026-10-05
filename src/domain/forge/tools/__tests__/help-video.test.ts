import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HelpVideo } from "../../help/video-schema";

const dispatch = vi.fn();
vi.mock("@langchain/core/callbacks/dispatch", () => ({
  dispatchCustomEvent: (...a: unknown[]) => dispatch(...a),
}));
// The catalog the tool sees. Refilled before each test; a test may swap in its own.
const catalog = vi.hoisted(() => [] as HelpVideo[]);
vi.mock("../../help/videos", () => ({
  HELP_VIDEOS: catalog,
  getHelpVideo: (s: string) => catalog.find((v) => v.slug === s),
}));

import { buildHelpVideoTools } from "../help-video";
import { EXPENSE_VIDEO, SOLVER_VIDEO, makeVideo } from "../../help/__tests__/help-video-fixtures";

const invoke = async (query: string) => {
  const [t] = buildHelpVideoTools();
  return JSON.parse((await t.invoke({ query })) as string);
};
const useCatalog = (...videos: HelpVideo[]) => catalog.splice(0, catalog.length, ...videos);

beforeEach(() => {
  dispatch.mockReset();
  useCatalog(EXPENSE_VIDEO, SOLVER_VIDEO);
});

describe("suggest_help_video", () => {
  it("exposes exactly suggest_help_video", () => {
    expect(buildHelpVideoTools().map((t) => t.name)).toEqual(["suggest_help_video"]);
  });

  it("attaches a Watch card for a strong match — server-picked title and chapter", async () => {
    const out = await invoke("set the start and end year for a one-time expense");
    expect(dispatch).toHaveBeenCalledWith("video_link", {
      slug: "add-one-time-expense",
      title: EXPENSE_VIDEO.title,
      chapterAt: 30,
      chapterLabel: "Set the start and end year to 2028, so it's paid once.",
    });
    expect(out.suggested).toEqual({ title: EXPENSE_VIDEO.title, chapter: "Set the start and end year to 2028, so it's paid once." });
  });

  it("suggests nothing when no video matches", async () => {
    const out = await invoke("convert to roth");
    expect(out.suggested).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("suggests nothing for a weak match (only the steps mention it)", async () => {
    const out = await invoke("details");
    expect(out.suggested).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("offers the best strong match even when a weak one ranks above it", async () => {
    // weak-top matches all three words, but only in a chapter; strong-lower
    // matches two of three in its title, so it ranks second.
    useCatalog(
      makeVideo({ slug: "weak-top", title: "Something else", chapters: [{ at: 0, label: "Budget forecast review" }] }),
      makeVideo({ slug: "strong-lower", title: "Budget forecast" }),
    );
    const out = await invoke("budget forecast review");
    expect(dispatch).toHaveBeenCalledWith("video_link", { slug: "strong-lower", title: "Budget forecast" });
    expect(out.suggested).toEqual({ title: "Budget forecast", chapter: null });
  });

  it("warns, and suggests nothing, when the Watch card can't be attached", async () => {
    dispatch.mockRejectedValueOnce(new Error("no run context"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const out = await invoke("add a one-time expense");
      expect(out.suggested).toBeNull();
      expect(warn).toHaveBeenCalledWith("suggest_help_video: couldn't attach the Watch card", {
        slug: "add-one-time-expense",
        error: "no run context",
      });
    } finally {
      warn.mockRestore();
    }
  });
});
