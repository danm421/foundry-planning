import { describe, it, expect } from "vitest";
import { formatDueDate } from "./format";

describe("formatDueDate", () => {
  const now = new Date("2026-05-21T12:00:00Z");
  it("returns em-dash + not overdue when null", () => {
    expect(formatDueDate(null, now)).toEqual({ label: "—", overdue: false });
  });
  it("today", () => {
    expect(formatDueDate("2026-05-21", now)).toEqual({ label: "today", overdue: false });
  });
  it("tomorrow", () => {
    expect(formatDueDate("2026-05-22", now)).toEqual({ label: "tomorrow", overdue: false });
  });
  it("in N days (small)", () => {
    expect(formatDueDate("2026-05-25", now)).toEqual({ label: "in 4d", overdue: false });
  });
  it("N days ago + overdue", () => {
    expect(formatDueDate("2026-05-19", now)).toEqual({ label: "2d ago", overdue: true });
  });
  it("absolute date when > 14 days out", () => {
    const r = formatDueDate("2026-06-30", now);
    expect(r.overdue).toBe(false);
    expect(r.label).toMatch(/Jun\s*30/);
  });
});
