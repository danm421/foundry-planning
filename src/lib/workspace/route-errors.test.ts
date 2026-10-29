// src/lib/workspace/route-errors.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";
import { workspaceErrorResponse } from "./route-errors";
import {
  ProviderRequestError,
  ProviderThrottledError,
  WorkspaceNotConnectedError,
  WorkspaceReconnectRequiredError,
} from "./errors";
import { MicrosoftAuthError } from "./microsoft/oauth";

async function read(res: Response): Promise<{ status: number; body: unknown }> {
  return { status: res.status, body: await res.json() };
}

describe("workspaceErrorResponse", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Every argument the 500 branch logged, flattened to one string. */
  function logged(): string {
    return JSON.stringify(consoleError.mock.calls);
  }

  it.each(["firm_not_approved", "member_off", "connect"] as const)(
    "WorkspaceNotConnectedError %s → 409 with the pane state",
    async (state) => {
      expect(await read(workspaceErrorResponse(new WorkspaceNotConnectedError(state)))).toEqual({
        status: 409,
        body: { error: state },
      });
    },
  );

  it("(Review Focus 1) WorkspaceReconnectRequiredError → 409 needs_reconnect", async () => {
    expect(await read(workspaceErrorResponse(new WorkspaceReconnectRequiredError()))).toEqual({
      status: 409,
      body: { error: "needs_reconnect" },
    });
  });

  it("(Review Focus 2) ProviderThrottledError → 503 throttled", async () => {
    expect(await read(workspaceErrorResponse(new ProviderThrottledError("microsoft", null)))).toEqual({
      status: 503,
      body: { error: "throttled" },
    });
  });

  it("ProviderRequestError 403 → 403 not_allowed", async () => {
    expect(await read(workspaceErrorResponse(new ProviderRequestError("microsoft", 403, "ErrorAccessDenied", "req-1")))).toEqual({
      status: 403,
      body: { error: "not_allowed" },
    });
  });

  it("ProviderRequestError 404 → 404 not_found", async () => {
    expect(await read(workspaceErrorResponse(new ProviderRequestError("microsoft", 404, "ErrorItemNotFound", "req-1")))).toEqual({
      status: 404,
      body: { error: "not_found" },
    });
  });

  it("auth errors go through authErrorResponse", async () => {
    expect(await read(workspaceErrorResponse(new UnauthorizedError()))).toEqual({
      status: 401,
      body: { error: "Unauthorized" },
    });
    expect(await read(workspaceErrorResponse(new ForbiddenError("Admin access required")))).toEqual({
      status: 403,
      body: { error: "Admin access required" },
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("any other ProviderRequestError → 500, logging its name, status and request-id only", async () => {
    const res = workspaceErrorResponse(new ProviderRequestError("microsoft", 400, "ErrorInvalidRequest", "req-400"));

    expect(await read(res)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(consoleError).toHaveBeenCalledTimes(1);
    expect(logged()).toContain("ProviderRequestError");
    expect(logged()).toContain("400");
    expect(logged()).toContain("req-400");
  });

  it("an unknown error → 500, logging its name and never its message", async () => {
    // A rethrown DB error's message carries query parameters (encrypted tokens, email).
    const dbError = new Error('Failed query: update "workspace_connections" params: v1:secret-ciphertext');

    expect(await read(workspaceErrorResponse(dbError))).toEqual({
      status: 500,
      body: { error: "Internal server error" },
    });
    expect(logged()).toContain("Error");
    expect(logged()).not.toContain("secret");
  });

  it("a non-reconnect Microsoft refresh failure → 500, not a reconnect prompt", async () => {
    const res = workspaceErrorResponse(new MicrosoftAuthError("temporarily_unavailable", 503));

    expect(await read(res)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(logged()).toContain("MicrosoftAuthError");
  });

  it("(R7) an expired client secret logs Microsoft's short code, so it reads apart from an outage", async () => {
    const res = workspaceErrorResponse(new MicrosoftAuthError("invalid_client", 401));

    expect(await read(res)).toEqual({ status: 500, body: { error: "Internal server error" } });
    expect(consoleError).toHaveBeenCalledWith(expect.any(String), { name: "MicrosoftAuthError", code: "invalid_client" });
  });

  it("a thrown non-Error → 500 without crashing the mapper", async () => {
    expect(await read(workspaceErrorResponse("boom secret"))).toEqual({
      status: 500,
      body: { error: "Internal server error" },
    });
    expect(logged()).not.toContain("secret");
  });
});
