import { describe, it, expect } from "vitest";
import { ClerkAPIResponseError } from "@clerk/nextjs/errors";
import { isMissingOrganizationError } from "@/lib/ops/growth/clerk-errors";

function clerkError(
  status: number,
  errors: { code: string; message: string }[],
): ClerkAPIResponseError {
  return new ClerkAPIResponseError("Clerk error", { data: errors, status });
}

describe("isMissingOrganizationError", () => {
  it("is true for a 404 resource_not_found — the missing-org shape", () => {
    expect(
      isMissingOrganizationError(
        clerkError(404, [{ code: "resource_not_found", message: "Not Found" }]),
      ),
    ).toBe(true);
  });

  it("is false for a 401 authentication_invalid — the catch must not be blanket", () => {
    expect(
      isMissingOrganizationError(
        clerkError(401, [{ code: "authentication_invalid", message: "Invalid token" }]),
      ),
    ).toBe(false);
  });

  it("is false for a 429 rate-limit error", () => {
    expect(
      isMissingOrganizationError(
        clerkError(429, [{ code: "rate_limit_exceeded", message: "Too many requests" }]),
      ),
    ).toBe(false);
  });

  it("is false for a 404 whose code is not resource_not_found", () => {
    expect(
      isMissingOrganizationError(
        clerkError(404, [{ code: "something_else", message: "Not Found" }]),
      ),
    ).toBe(false);
  });

  it("is false for a plain, non-Clerk Error", () => {
    expect(isMissingOrganizationError(new Error("boom"))).toBe(false);
  });

  it("is false — and does not throw — for null and undefined", () => {
    expect(() => isMissingOrganizationError(null)).not.toThrow();
    expect(() => isMissingOrganizationError(undefined)).not.toThrow();
    expect(isMissingOrganizationError(null)).toBe(false);
    expect(isMissingOrganizationError(undefined)).toBe(false);
  });
});
