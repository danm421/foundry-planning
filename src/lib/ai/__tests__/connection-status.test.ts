import { describe, it, expect, vi, beforeEach } from "vitest";

const mockSetStatus = vi.fn();
const mockClearCache = vi.fn();

// Both of the real module's imports are stubbed, and both have to be: the real
// `@/lib/integrations/connections` reaches `@/db`, and the real `@/lib/ai/resolve`
// pulls in Clerk on top of it. Neither belongs in a unit test of two small
// functions.
vi.mock("@/lib/integrations/connections", () => ({
  setConnectionStatus: (...a: unknown[]) => mockSetStatus(...a),
}));
vi.mock("@/lib/ai/resolve", () => ({
  clearAiCredentialCache: (...a: unknown[]) => mockClearCache(...a),
}));

import { isAzureAuthFailure, markAiConnectionError } from "../connection-status";

// A BLOCK body, not `() => mockSetStatus.mockReset()`. `mockReset()` returns
// the mock, an arrow's implicit return hands that mock to vitest as the test's
// TEARDOWN, and vitest calls it — a phantom invocation landing in exactly the
// call-count assertions below, and reading as a flake rather than a bug.
beforeEach(() => {
  mockSetStatus.mockReset();
  mockClearCache.mockReset();
});

describe("isAzureAuthFailure", () => {
  it("recognizes a 401", () => {
    expect(isAzureAuthFailure({ status: 401 })).toBe(true);
  });

  it("recognizes a 403", () => {
    expect(isAzureAuthFailure({ status: 403 })).toBe(true);
  });

  it("does NOT treat a rate limit as an auth failure", () => {
    expect(isAzureAuthFailure({ status: 429 })).toBe(false);
  });

  it("does NOT treat a server error as an auth failure", () => {
    expect(isAzureAuthFailure({ status: 500 })).toBe(false);
  });

  it("does NOT treat a timeout as an auth failure", () => {
    expect(isAzureAuthFailure(new Error("timed out"))).toBe(false);
  });

  it("compares the status STRICTLY, so a string never counts", () => {
    // `==` would make "401" an auth failure. Nothing in the SDK produces a
    // string status today, so only this assertion stands between a loosened
    // comparison and a firm's connection being flagged by a stray shape.
    expect(isAzureAuthFailure({ status: "401" })).toBe(false);
  });

  it("survives a thrown null or a plain string", () => {
    // `err` is `unknown` — a rejected promise can carry anything, and reading
    // `.status` off null throws. The optional chain is what stops this helper
    // from replacing the AI failure with a TypeError.
    expect(isAzureAuthFailure(null)).toBe(false);
    expect(isAzureAuthFailure(undefined)).toBe(false);
    expect(isAzureAuthFailure("boom")).toBe(false);
  });
});

describe("markAiConnectionError", () => {
  it("flips the firm's azure_openai connection to error", async () => {
    await markAiConnectionError("org_acme", "invalid key");
    expect(mockSetStatus).toHaveBeenCalledWith("org_acme", "azure_openai", "error", "invalid key");
  });

  it("drops that firm's cached credentials, so the next call sees the new status", async () => {
    // Without this the resolver keeps serving the just-rejected credentials
    // from its 60s cache on this instance: callers get raw Azure 401s instead
    // of the `ai_firm_connection_unavailable` sentinel they branch on, and
    // every call in a burst re-writes the status row.
    await markAiConnectionError("org_acme", "invalid key");
    expect(mockClearCache).toHaveBeenCalledWith("org_acme");
  });

  it("clears the cache only AFTER the status write has landed", async () => {
    // Order, not just presence: clearing first lets a concurrent request
    // re-read the row that still says "connected" and re-cache the very
    // credentials being flagged, putting the stale entry straight back.
    await markAiConnectionError("org_acme", "invalid key");
    expect(mockSetStatus.mock.invocationCallOrder[0]).toBeLessThan(
      mockClearCache.mock.invocationCallOrder[0],
    );
  });

  it("never throws — a status write must not mask the original AI failure", async () => {
    mockSetStatus.mockRejectedValue(new Error("db down"));
    await expect(markAiConnectionError("org_acme", "invalid key")).resolves.toBeUndefined();
  });

  it("leaves the cache alone when the status write failed", async () => {
    // The row still says "connected", so dropping the entry only buys a DB
    // read per call in the burst — it cannot produce the sentinel, because
    // there is no `error` row to read.
    mockSetStatus.mockRejectedValue(new Error("db down"));
    await markAiConnectionError("org_acme", "invalid key");
    expect(mockClearCache).not.toHaveBeenCalled();
  });
});
