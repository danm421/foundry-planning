// src/domain/forge/help/__tests__/video-schema.test.ts
import { describe, it, expect } from "vitest";
import { helpVideoSchema } from "../video-schema";
import { EXPENSE_VIDEO, SOLVER_VIDEO, makeVideo } from "./help-video-fixtures";

const issues = (v: unknown) => {
  const r = helpVideoSchema.safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("helpVideoSchema", () => {
  it("accepts both fixtures", () => {
    expect(issues(EXPENSE_VIDEO)).toEqual([]);
    expect(issues(SOLVER_VIDEO)).toEqual([]);
  });

  it("requires the first chapter at 0", () => {
    expect(issues(makeVideo({ chapters: [{ at: 2, label: "x" }] }))).toContain("first chapter must start at 0");
  });

  it("requires strictly ascending chapters", () => {
    const chapters = [{ at: 0, label: "a" }, { at: 10, label: "b" }, { at: 10, label: "c" }];
    expect(issues(makeVideo({ chapters }))).toContain("chapters must be strictly ascending");
  });

  it("rejects a chapter that starts after the video ends", () => {
    const chapters = [{ at: 0, label: "a" }, { at: 80, label: "b" }];
    expect(issues(makeVideo({ chapters }))).toContain("chapter starts after the video ends");
  });

  it("rejects a tag outside the shared list", () => {
    expect(issues({ ...EXPENSE_VIDEO, tags: ["expense"] }).length).toBeGreaterThan(0);
  });

  it("rejects a storage path that doesn't match the hash", () => {
    const video = { ...EXPENSE_VIDEO.video, path: "knowledge-hub/add-one-time-expense/wrong.mp4" };
    expect(issues(makeVideo({ video }))).toContain("video.path must be knowledge-hub/<slug>/<sha12>.mp4");
  });

  it("rejects an unknown field (typos can't hide)", () => {
    expect(issues({ ...EXPENSE_VIDEO, serachTerms: [] }).length).toBeGreaterThan(0);
  });

  it("caps the summary at 140 characters", () => {
    expect(issues(makeVideo({ summary: "x".repeat(141) })).length).toBeGreaterThan(0);
  });
});
