// Unit tests for the shared best-effort Plaid revoke loop (PII audit F3).
// The helper is used by flows where nobody is watching (firm purge cron,
// client delete) — a Plaid failure must be swallowed, logged redacted, and
// must not stop the remaining tokens from being revoked.
import { describe, it, expect, beforeEach, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  itemRemove: vi.fn(),
  getPlaidClient: vi.fn(),
}));
vi.mock("@/lib/plaid/client", () => ({ getPlaidClient: mocks.getPlaidClient }));
vi.mock("@/lib/plaid/crypto", () => ({ decrypt: (v: string) => `decrypted-${v}` }));

import { revokePlaidTokens } from "../revoke";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getPlaidClient.mockReturnValue({ itemRemove: mocks.itemRemove });
  mocks.itemRemove.mockResolvedValue({ request_id: "rq" });
});

describe("revokePlaidTokens", () => {
  it("calls itemRemove once per token with the decrypted token", async () => {
    await revokePlaidTokens(["enc-1", "enc-2"], "test-ctx");
    expect(mocks.itemRemove).toHaveBeenCalledTimes(2);
    expect(mocks.itemRemove).toHaveBeenCalledWith({ access_token: "decrypted-enc-1" });
    expect(mocks.itemRemove).toHaveBeenCalledWith({ access_token: "decrypted-enc-2" });
  });

  it("swallows a failed itemRemove and still revokes the remaining tokens", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.itemRemove.mockRejectedValueOnce(new Error("502"));
    await expect(revokePlaidTokens(["enc-1", "enc-2"], "test-ctx")).resolves.toBeUndefined();
    expect(mocks.itemRemove).toHaveBeenCalledTimes(2);
    errSpy.mockRestore();
  });

  it("logs Plaid failures redacted — never the raw Axios error", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const axiosErr = Object.assign(new Error("boom"), {
      isAxiosError: true,
      config: { data: '{"access_token":"live-secret"}' },
      response: { data: { error_code: "INTERNAL_SERVER_ERROR", error_message: "oops" } },
    });
    mocks.itemRemove.mockRejectedValueOnce(axiosErr);
    await revokePlaidTokens(["enc-1"], "test-ctx");
    expect(errSpy).toHaveBeenCalledTimes(1);
    const logged = errSpy.mock.calls[0];
    expect(logged).not.toContain(axiosErr);
    expect(logged).toContainEqual({
      plaidErrorCode: "INTERNAL_SERVER_ERROR",
      plaidErrorMessage: "oops",
    });
    errSpy.mockRestore();
  });

  it("never instantiates the Plaid client when there are no tokens", async () => {
    await revokePlaidTokens([], "test-ctx");
    expect(mocks.getPlaidClient).not.toHaveBeenCalled();
  });
});
