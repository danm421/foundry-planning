// src/lib/fact-finder/__tests__/reading-status.test.ts
import { describe, expect, it } from "vitest";
import { STALE_READING_MS, filesReading, isReadingNow, needsReading } from "../reading-status";
import { emptyFactFinderState } from "../state";
import type { FFFileReading } from "../types";

const NOW = new Date("2026-10-12T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();
const reading = (startedMsAgo: number): FFFileReading => ({ status: "reading", startedAt: ago(startedMsAgo) });
const done: FFFileReading = { status: "done", startedAt: ago(60_000), finishedAt: ago(30_000), rows: 2 };
const failed: FFFileReading = { status: "failed", startedAt: ago(60_000), finishedAt: ago(30_000), reason: "Couldn't read this file." };

describe("needsReading", () => {
  it("reads a new file, a failed one, and one stuck reading past the stale limit", () => {
    expect(needsReading(undefined, NOW)).toBe(true);
    expect(needsReading(failed, NOW)).toBe(true);
    expect(needsReading(reading(STALE_READING_MS + 1), NOW)).toBe(true);
  });

  it("leaves a file that's done or still reading", () => {
    expect(needsReading(done, NOW)).toBe(false);
    expect(needsReading(reading(60_000), NOW)).toBe(false);
    expect(needsReading(reading(STALE_READING_MS), NOW)).toBe(false);
  });
});

describe("isReadingNow", () => {
  it("is true only for a read that started within the stale limit", () => {
    expect(isReadingNow(reading(60_000), NOW)).toBe(true);
    expect(isReadingNow(reading(STALE_READING_MS), NOW)).toBe(true);
    expect(isReadingNow(reading(STALE_READING_MS + 1), NOW)).toBe(false);
    expect(isReadingNow(done, NOW)).toBe(false);
    expect(isReadingNow(failed, NOW)).toBe(false);
    expect(isReadingNow(undefined, NOW)).toBe(false);
  });
});

describe("filesReading", () => {
  it("lists the files being read right now, not stale, done or failed ones", () => {
    const state = {
      ...emptyFactFinderState(),
      readings: { a: reading(1_000), b: reading(STALE_READING_MS + 60_000), c: done, d: failed, e: reading(5_000) },
    };
    expect(filesReading(state, NOW)).toEqual(["a", "e"]);
  });

  it("is empty for a fact finder with nothing read yet", () => {
    expect(filesReading(emptyFactFinderState(), NOW)).toEqual([]);
  });
});
