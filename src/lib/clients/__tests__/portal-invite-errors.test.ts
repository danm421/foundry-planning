import { describe, it, expect } from "vitest";
import { ClerkAPIResponseError } from "@clerk/nextjs/errors";
import { clerkInviteErrorResponse } from "@/lib/clients/portal-invite-errors";

function clerkError(
  status: number,
  errors: { code: string; message: string }[],
): ClerkAPIResponseError {
  return new ClerkAPIResponseError("Clerk error", { data: errors, status });
}

describe("clerkInviteErrorResponse", () => {
  it("maps an existing account (form_identifier_exists) to a 409 with a distinct message", () => {
    const res = clerkInviteErrorResponse(
      clerkError(422, [
        { code: "form_identifier_exists", message: "That email address is taken." },
      ]),
    );
    expect(res?.status).toBe(409);
    expect(res?.error).toMatch(/already has an account/i);
  });

  it("maps a pending invitation (duplicate_record) to a 409 with a distinct message", () => {
    const res = clerkInviteErrorResponse(
      clerkError(400, [
        { code: "duplicate_record", message: "There is already a pending invitation." },
      ]),
    );
    expect(res?.status).toBe(409);
    expect(res?.error).toMatch(/already pending/i);
  });

  it("echoes the Clerk message for other 4xx Clerk errors instead of a 500", () => {
    const res = clerkInviteErrorResponse(
      clerkError(422, [{ code: "form_param_format_invalid", message: "Bad email." }]),
    );
    expect(res?.status).toBe(422);
    expect(res?.error).toBe("Bad email.");
  });

  it("returns null for a 5xx Clerk error (so the route keeps its generic 500)", () => {
    const res = clerkInviteErrorResponse(
      clerkError(500, [{ code: "internal", message: "boom" }]),
    );
    expect(res).toBeNull();
  });

  it("returns null for non-Clerk errors", () => {
    expect(clerkInviteErrorResponse(new Error("network down"))).toBeNull();
    expect(clerkInviteErrorResponse(undefined)).toBeNull();
  });
});
