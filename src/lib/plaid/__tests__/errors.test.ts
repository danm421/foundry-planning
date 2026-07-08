import { describe, expect, it } from "vitest";
import {
  REAUTH_CODES,
  REVOKED_CODES,
  needsUserAction,
  redactPlaidError,
} from "../errors";

// A Plaid SDK error is an Axios error: `config.data` is the serialized REQUEST
// body (contains the plaintext access_token) and `config.headers` carry
// PLAID-SECRET. This fixture mirrors that shape so we can prove redaction drops
// both credentials.
function fakePlaidAxiosError() {
  return {
    isAxiosError: true,
    message: "Request failed with status code 400",
    code: "ERR_BAD_REQUEST",
    config: {
      url: "https://production.plaid.com/accounts/get",
      data: JSON.stringify({ access_token: "access-production-SUPER-SECRET-TOKEN" }),
      headers: {
        "PLAID-CLIENT-ID": "client-id-123",
        "PLAID-SECRET": "prod-secret-DO-NOT-LEAK",
      },
    },
    request: { path: "/accounts/get" },
    response: {
      status: 400,
      data: { error_code: "INVALID_ACCESS_TOKEN", error_message: "the provided access token is invalid" },
    },
  };
}

describe("plaid error code sets", () => {
  it("REAUTH_CODES covers login-required and pending webhook codes", () => {
    for (const c of ["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION", "PENDING_DISCONNECT"]) {
      expect(REAUTH_CODES.has(c)).toBe(true);
    }
  });
  it("REVOKED_CODES covers revocation codes and does not overlap REAUTH", () => {
    for (const c of ["USER_PERMISSION_REVOKED", "USER_ACCOUNT_REVOKED"]) {
      expect(REVOKED_CODES.has(c)).toBe(true);
      expect(REAUTH_CODES.has(c)).toBe(false);
    }
  });
  it("needsUserAction is true for both sets, false otherwise", () => {
    expect(needsUserAction("PENDING_DISCONNECT")).toBe(true);
    expect(needsUserAction("USER_PERMISSION_REVOKED")).toBe(true);
    expect(needsUserAction("INTERNAL_SERVER_ERROR")).toBe(false);
    expect(needsUserAction(null)).toBe(false);
  });
});

describe("redactPlaidError", () => {
  it("redacts an Axios/Plaid error to code+message, dropping token and secret", () => {
    const redacted = redactPlaidError(fakePlaidAxiosError());
    // The whole serialized value must not contain the access token or secret.
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("SUPER-SECRET-TOKEN");
    expect(serialized).not.toContain("prod-secret-DO-NOT-LEAK");
    expect(serialized).not.toContain("access_token");
    // …but keeps the useful diagnostic fields.
    expect(redacted).toMatchObject({
      plaidErrorCode: "INVALID_ACCESS_TOKEN",
      plaidErrorMessage: "the provided access token is invalid",
    });
    // No config/request/response carried through.
    expect(redacted).not.toHaveProperty("config");
    expect(redacted).not.toHaveProperty("request");
    expect(redacted).not.toHaveProperty("response");
  });

  it("passes a plain non-Axios Error through unchanged (stack preserved for debugging)", () => {
    const dbErr = new Error("duplicate key value violates unique constraint");
    expect(redactPlaidError(dbErr)).toBe(dbErr);
  });

  it("passes a bare string/unknown through unchanged", () => {
    expect(redactPlaidError("boom")).toBe("boom");
    expect(redactPlaidError(undefined)).toBe(undefined);
  });
});
