// src/domain/forge/help/__tests__/video-search.test.ts
import { describe, it, expect } from "vitest";
import { isStrongMatch, searchHelpVideos } from "../video-search";
import { EXPENSE_VIDEO, SOLVER_VIDEO, makeVideo } from "./help-video-fixtures";

const ALL = [EXPENSE_VIDEO, SOLVER_VIDEO];
const slugs = (q: string) => searchHelpVideos(q, ALL).map((h) => h.video.slug);

describe("searchHelpVideos", () => {
  it("finds by a title word", () => {
    expect(slugs("expense")).toEqual(["add-one-time-expense"]);
  });

  it("matches word prefixes and plurals", () => {
    expect(slugs("expen")).toEqual(["add-one-time-expense"]);
    expect(slugs("expenses")).toEqual(["add-one-time-expense"]);
    expect(slugs("scenarios")).toEqual(["solver-save-scenario"]);
  });

  it("finds by search words advisors type that aren't in the title", () => {
    expect(slugs("lump sum")).toEqual(["add-one-time-expense"]);
  });

  it("ranks by how many query words matched, then by field weight", () => {
    // cash + flow hit EXPENSE (2 words); scenario hits SOLVER (1 word)
    expect(slugs("cash flow scenario")).toEqual(["add-one-time-expense", "solver-save-scenario"]);
    const inTitle = makeVideo({ slug: "budget-in-title", title: "Budget planning" });
    const inSteps = makeVideo({ slug: "budget-in-steps", title: "Something else", steps: ["Open the budget page."] });
    expect(searchHelpVideos("budget", [inSteps, inTitle]).map((h) => h.video.slug)).toEqual(["budget-in-title", "budget-in-steps"]);
  });

  it("picks the chapter that matches the most query words", () => {
    const [hit] = searchHelpVideos("start and end year", ALL);
    expect(hit.chapter).toEqual({ at: 30, label: "Set the start and end year to 2028, so it's paid once." });
  });

  it("returns nothing for an empty or stopword-only query, or no match", () => {
    expect(searchHelpVideos("", ALL)).toEqual([]);
    expect(searchHelpVideos("how do I", ALL)).toEqual([]);
    expect(searchHelpVideos("roth conversion", ALL)).toEqual([]);
  });

  it("ignores punctuation, including a non-ASCII hyphen", () => {
    expect(slugs("one‑time")).toEqual(["add-one-time-expense"]);
  });

  it("folds -ed and -ing on both sides, so a past or ongoing verb finds its root", () => {
    expect(slugs("added")).toEqual(["add-one-time-expense"]);
    expect(slugs("saving")).toEqual(["solver-save-scenario"]);
  });
});

describe("isStrongMatch", () => {
  const top = (q: string) => searchHelpVideos(q, ALL)[0];

  it("is strong when most words match and one hits what the video is about", () => {
    expect(isStrongMatch(top("add a one-time expense"))).toBe(true);
  });

  it("is weak when the only hit is in the steps", () => {
    // "details" appears only in EXPENSE's steps
    expect(isStrongMatch(top("details"))).toBe(false);
  });

  it("is weak when under 60% of the words matched", () => {
    expect(isStrongMatch(top("expense roth conversion ira"))).toBe(false);
  });

  it("is strong for how advisors actually phrase it", () => {
    // "adding" ≠ "add" and "video"/"there" are filler — without the -ing fold
    // and the extra stopwords these fall under the 60% bar.
    expect(top("adding an expense").video.slug).toBe("add-one-time-expense");
    expect(isStrongMatch(top("adding an expense"))).toBe(true);
    expect(isStrongMatch(top("video on adding an expense"))).toBe(true);
    const q = "is there a video on saving Solver changes as a scenario";
    expect(top(q).video.slug).toBe("solver-save-scenario");
    expect(isStrongMatch(top(q))).toBe(true);
  });

  it("is never strong with zero meaningful words (no NaN)", () => {
    expect(isStrongMatch({ video: EXPENSE_VIDEO, matched: 0, of: 0, score: 0, strongField: false })).toBe(false);
  });
});
