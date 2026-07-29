import { describe, it, expect } from "vitest";
import { classifyToken } from "@/lib/risk/token-guard";

const NOW = new Date("2026-07-28T00:00:00Z");
const OPEN = {
  status: "sent" as const,
  expiresAt: new Date("2026-08-28T00:00:00Z"),
};

describe("classifyToken", () => {
  it("accepts an open, unexpired questionnaire", () => {
    expect(classifyToken(OPEN, NOW)).toEqual({ ok: true });
  });

  it("rejects a missing row", () => {
    expect(classifyToken(null, NOW)).toEqual({ ok: false, reason: "not_found" });
  });

  it("rejects an expired token", () => {
    expect(classifyToken({ ...OPEN, expiresAt: new Date("2026-07-01T00:00:00Z") }, NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects a token that has already been submitted", () => {
    expect(classifyToken({ ...OPEN, status: "submitted" }, NOW)).toEqual({
      ok: false,
      reason: "already_submitted",
    });
    expect(classifyToken({ ...OPEN, status: "applied" }, NOW)).toEqual({
      ok: false,
      reason: "already_submitted",
    });
  });

  it("rejects a discarded token as not found, not as expired", () => {
    expect(classifyToken({ ...OPEN, status: "discarded" }, NOW)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  // `status` defaults to 'draft' at the DB level (0226), and send-rtq's expiry
  // sweep already treats draft+sent as the one "open" set. buildQuestionnaireRow
  // sets 'sent' explicitly, so a draft is unreachable today -- pinned so that
  // stays a deliberate choice rather than an accident of which insert ran.
  it("accepts a draft, matching send-rtq's open set", () => {
    expect(classifyToken({ ...OPEN, status: "draft" }, NOW)).toEqual({ ok: true });
  });

  // The guard is an ALLOW-list, not a deny-list. A deny-list lets any status it
  // forgot to enumerate -- a new enum member, a typo, a DB default -- fall
  // through to ok:true and hand an unauthenticated caller a live questionnaire.
  it("rejects an unrecognized status instead of falling through to ok", () => {
    expect(classifyToken({ ...OPEN, status: "some_future_status" }, NOW)).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("rejects an expired draft on the expiry clock, not the status", () => {
    expect(
      classifyToken(
        { status: "draft", expiresAt: new Date("2026-07-01T00:00:00Z") },
        NOW,
      ),
    ).toEqual({ ok: false, reason: "expired" });
  });
});
