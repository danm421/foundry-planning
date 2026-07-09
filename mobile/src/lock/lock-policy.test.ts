import { describe, it, expect } from "vitest";
import { shouldLock, LOCK_GRACE_MS } from "./lock-policy";

describe("shouldLock", () => {
  const now = 1_000_000_000;
  it("never locks when disabled", () => {
    expect(shouldLock({ enabled: false, lastActiveAt: null, now, graceMs: LOCK_GRACE_MS })).toBe(false);
  });
  it("locks on cold start (no lastActiveAt)", () => {
    expect(shouldLock({ enabled: true, lastActiveAt: null, now, graceMs: LOCK_GRACE_MS })).toBe(true);
  });
  it("does not lock when foregrounded within the grace window", () => {
    expect(
      shouldLock({ enabled: true, lastActiveAt: now - LOCK_GRACE_MS + 1000, now, graceMs: LOCK_GRACE_MS }),
    ).toBe(false);
  });
  it("locks when backgrounded beyond the grace window", () => {
    expect(
      shouldLock({ enabled: true, lastActiveAt: now - LOCK_GRACE_MS - 1, now, graceMs: LOCK_GRACE_MS }),
    ).toBe(true);
  });
});
