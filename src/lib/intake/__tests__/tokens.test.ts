import { describe, it, expect } from "vitest";
import { newIntakeToken, defaultExpiry, isExpired } from "../tokens";

describe("intake tokens", () => {
  it("generates a url-safe token of useful length", () => {
    const t = newIntakeToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(newIntakeToken()).not.toBe(t);
  });
  it("default expiry is ~30 days out", () => {
    const now = new Date("2026-06-22T00:00:00Z");
    expect(defaultExpiry(now).getTime()).toBe(new Date("2026-07-22T00:00:00Z").getTime());
  });
  it("isExpired true past expiry or when not draft/submitted", () => {
    const now = new Date("2026-07-23T00:00:00Z");
    expect(isExpired({ expiresAt: new Date("2026-07-22T00:00:00Z"), status: "draft" }, now)).toBe(true);
    expect(isExpired({ expiresAt: new Date("2026-08-01T00:00:00Z"), status: "draft" }, now)).toBe(false);
    expect(isExpired({ expiresAt: new Date("2026-08-01T00:00:00Z"), status: "applied" }, now)).toBe(true);
  });
});
