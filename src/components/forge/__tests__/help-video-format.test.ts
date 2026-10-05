// src/components/forge/__tests__/help-video-format.test.ts
import { describe, it, expect } from "vitest";
import { formatClock, posterSrc, recordedLabel, videoSrc } from "../help-video-format";
import { EXPENSE_VIDEO } from "@/domain/forge/help/__tests__/help-video-fixtures";

describe("help-video-format", () => {
  it("formats seconds as m:ss", () => {
    expect(formatClock(0)).toBe("0:00");
    expect(formatClock(42)).toBe("0:42");
    expect(formatClock(73.5)).toBe("1:13");
  });

  it("labels the recording month", () => {
    expect(recordedLabel("2026-10-05")).toBe("Recorded Oct 2026");
  });

  it("puts the content hash on both URLs", () => {
    expect(videoSrc(EXPENSE_VIDEO)).toBe("/api/knowledge-hub/videos/add-one-time-expense?v=aaaaaaaaaaaa");
    expect(posterSrc(EXPENSE_VIDEO)).toBe("/api/knowledge-hub/videos/add-one-time-expense/poster?v=bbbbbbbbbbbb");
  });
});
