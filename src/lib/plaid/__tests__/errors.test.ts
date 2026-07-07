import { describe, expect, it } from "vitest";
import { REAUTH_CODES, REVOKED_CODES, needsUserAction } from "../errors";

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
