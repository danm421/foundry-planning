import { describe, it, expect } from "vitest";
import {
  clampNoteLimit,
  truncateNoteBody,
  filterNotesWindow,
  NOTE_BODY_MAX,
  NOTE_LIMIT_DEFAULT,
  NOTE_LIMIT_MAX,
} from "../notes-window";
import type { NoteRow } from "../notes";

const note = (over: Partial<NoteRow> = {}): NoteRow => ({
  id: "n1",
  kind: "note",
  title: "Subject",
  body: "Body",
  occurredAt: "2026-06-01T12:00:00.000Z",
  actorUserId: "user_1",
  updatedAt: "2026-06-01T12:00:00.000Z",
  ...over,
});

describe("clampNoteLimit", () => {
  it("defaults when absent and clamps to the max", () => {
    expect(clampNoteLimit(undefined)).toBe(NOTE_LIMIT_DEFAULT);
    expect(clampNoteLimit(5)).toBe(5);
    expect(clampNoteLimit(10_000)).toBe(NOTE_LIMIT_MAX);
    expect(clampNoteLimit(0)).toBe(NOTE_LIMIT_DEFAULT);
    expect(clampNoteLimit(-3)).toBe(NOTE_LIMIT_DEFAULT);
  });
});

describe("truncateNoteBody", () => {
  it("leaves a short body untouched", () => {
    expect(truncateNoteBody("short")).toEqual({ body: "short", truncated: false });
  });

  it("cuts a long body at a word boundary and flags it", () => {
    // 'word ' repeated past the cap, so the cap lands mid-repetition.
    const long = "word ".repeat(400).trim();
    const out = truncateNoteBody(long);
    expect(out.truncated).toBe(true);
    expect(out.body.length).toBeLessThanOrEqual(NOTE_BODY_MAX);
    // The cut must not leave a half-word at the end.
    expect(out.body.endsWith("word")).toBe(true);
  });

  it("does not flag a body exactly at the cap", () => {
    const exact = "x".repeat(NOTE_BODY_MAX);
    expect(truncateNoteBody(exact)).toEqual({ body: exact, truncated: false });
  });

  it("falls back to a hard cut when there is no space to break on", () => {
    const unbroken = "x".repeat(NOTE_BODY_MAX + 50);
    const out = truncateNoteBody(unbroken);
    expect(out.truncated).toBe(true);
    expect(out.body.length).toBe(NOTE_BODY_MAX);
  });
});

describe("filterNotesWindow", () => {
  const rows = [
    note({ id: "a", kind: "call", occurredAt: "2026-01-15T12:00:00.000Z" }),
    note({ id: "b", kind: "meeting", occurredAt: "2026-06-15T12:00:00.000Z" }),
    note({ id: "c", kind: "note", occurredAt: "2026-09-15T12:00:00.000Z" }),
  ];

  it("returns every row when no options are given", () => {
    expect(filterNotesWindow(rows, {}).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("filters by kind", () => {
    expect(filterNotesWindow(rows, { kinds: ["call", "note"] }).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("filters by an inclusive date window", () => {
    const out = filterNotesWindow(rows, { since: "2026-06-15", until: "2026-09-15" });
    expect(out.map((r) => r.id)).toEqual(["b", "c"]);
  });

  it("treats `since` as the start of that day and `until` as the end of it", () => {
    // A note stored at noon UTC on the boundary day must survive both bounds.
    expect(filterNotesWindow(rows, { since: "2026-06-15" }).map((r) => r.id)).toEqual(["b", "c"]);
    expect(filterNotesWindow(rows, { until: "2026-06-15" }).map((r) => r.id)).toEqual(["a", "b"]);
  });
});
