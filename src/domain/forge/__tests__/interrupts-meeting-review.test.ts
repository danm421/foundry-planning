// src/domain/forge/__tests__/interrupts-meeting-review.test.ts
import { describe, it, expect } from "vitest";
import { parseMeetingReviewInterrupt, parseMeetingReviewResume } from "../interrupts";

describe("meeting_review schemas", () => {
  it("parses a valid interrupt value", () => {
    const v = parseMeetingReviewInterrupt({
      type: "meeting_review", summaryTitle: "T", summary: "S", meetingDate: null,
      proposedTasks: [{ title: "Do X", description: "", priority: "med", dueDate: null }],
    });
    expect(v.proposedTasks[0].title).toBe("Do X");
  });
  it("parses a valid resume value", () => {
    const v = parseMeetingReviewResume({
      approved: true, summaryTitle: "T", summary: "S", meetingDate: "2026-06-25",
      tasks: [{ title: "Do X", description: "", priority: "high", dueDate: "2026-07-01" }],
    });
    expect(v.approved).toBe(true);
    expect(v.tasks[0].priority).toBe("high");
  });
  it("rejects a wrong interrupt type", () => {
    expect(() => parseMeetingReviewInterrupt({ type: "approval_required" })).toThrow();
  });
});
