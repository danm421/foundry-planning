import { describe, it, expect, vi, beforeEach } from "vitest";

const dispatch = vi.fn();
vi.mock("@langchain/core/callbacks/dispatch", () => ({
  dispatchCustomEvent: (...a: unknown[]) => dispatch(...a),
}));
vi.mock("../../help/videos", async () => {
  const f = await import("../../help/__tests__/help-video-fixtures");
  const all = [f.EXPENSE_VIDEO, f.SOLVER_VIDEO];
  return { HELP_VIDEOS: all, getHelpVideo: (s: string) => all.find((v) => v.slug === s) };
});

import { buildHelpVideoTools } from "../help-video";
import { EXPENSE_VIDEO } from "../../help/__tests__/help-video-fixtures";

const invoke = async (query: string) => {
  const [t] = buildHelpVideoTools();
  return JSON.parse((await t.invoke({ query })) as string);
};

beforeEach(() => dispatch.mockReset());

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
});
