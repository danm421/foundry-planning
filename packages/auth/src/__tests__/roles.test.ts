import { describe, it, expect } from "vitest";
import { requireRole, AdminAuthError } from "..";
import type { ActingContext } from "..";

const base = (role: ActingContext["role"]): ActingContext => ({
  actorAdminId: "a1",
  role,
  impersonation: null,
});

describe("requireRole", () => {
  it("passes when role matches", () => {
    expect(() => requireRole(base("operator"), ["operator", "superadmin"]))
      .not.toThrow();
  });

  it("throws 403 when role does not match", () => {
    expect(() => requireRole(base("support"), ["operator"])).toThrow(
      AdminAuthError,
    );
    try {
      requireRole(base("support"), ["operator"]);
    } catch (err) {
      expect((err as AdminAuthError).status).toBe(403);
    }
  });

  it("superadmin implicitly satisfies any requirement", () => {
    expect(() => requireRole(base("superadmin"), ["support"])).not.toThrow();
  });
});
