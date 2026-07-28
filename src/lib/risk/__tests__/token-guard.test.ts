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
});
