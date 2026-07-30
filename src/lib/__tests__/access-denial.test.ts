// `nullOnAccessDenial` — the narrowed replacement for `.catch(() => null)` on
// the client access gates. Only an access *decision* may become null; every
// other failure has to keep propagating so a DB outage surfaces as a 500
// instead of "this client doesn't exist" (the 2026-07-30 prod incident).

import { describe, it, expect } from "vitest";
import { isAccessDenial, nullOnAccessDenial, ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";

describe("isAccessDenial", () => {
  it("is true for the two errors the gates raise as a decision", () => {
    expect(isAccessDenial(new UnauthorizedError())).toBe(true);
    expect(isAccessDenial(new ForbiddenError("Client not found or access denied"))).toBe(true);
  });

  it("is false for faults, including ones whose message looks authz-ish", () => {
    expect(isAccessDenial(new Error("Unauthorized"))).toBe(false);
    expect(isAccessDenial(new Error("Connection terminated unexpectedly"))).toBe(false);
    expect(isAccessDenial(new TypeError("fetch failed"))).toBe(false);
    expect(isAccessDenial(null)).toBe(false);
    expect(isAccessDenial("Forbidden")).toBe(false);
  });
});

describe("nullOnAccessDenial", () => {
  it("returns null for an access denial", () => {
    expect(nullOnAccessDenial(new UnauthorizedError())).toBeNull();
    expect(nullOnAccessDenial(new ForbiddenError("Client not found or access denied"))).toBeNull();
  });

  it("rethrows a missing-column fault (the 0228 incident shape)", () => {
    const fault = Object.assign(
      new Error("column clients.covered_by_workplace_plan does not exist"),
      { code: "42703" },
    );
    expect(() => nullOnAccessDenial(fault)).toThrow(fault);
  });

  it("rethrows a dropped connection", () => {
    const fault = new Error("Connection terminated unexpectedly");
    expect(() => nullOnAccessDenial(fault)).toThrow(fault);
  });

  it("rethrows a legacy string-message Error rather than trusting the message", () => {
    // `authErrorResponse` still honours `new Error("Unauthorized")` for legacy
    // throw sites. This helper deliberately does not: an untyped error of
    // unknown origin is treated as a fault, not as a denial.
    const legacy = new Error("Unauthorized");
    expect(() => nullOnAccessDenial(legacy)).toThrow(legacy);
  });

  it("rethrows a non-Error rejection value", () => {
    expect(() => nullOnAccessDenial("boom")).toThrow();
  });

  it("works as a bare .catch() handler on a rejected promise", async () => {
    await expect(
      Promise.reject(new ForbiddenError("denied")).catch(nullOnAccessDenial),
    ).resolves.toBeNull();

    const fault = new Error("Connection terminated unexpectedly");
    await expect(Promise.reject(fault).catch(nullOnAccessDenial)).rejects.toBe(fault);
  });
});
