// src/lib/branding/__tests__/advisor-authz.test.ts
//
// The advisor-brand edit rule, extracted from the PUT handler so the upload
// server action shares ONE copy (two copies drift, and the drift is a
// privilege bug). These cases are written against the wrong implementations,
// not the right one — each enumerated mutant below must fail at least one:
//
//   M1 always calls requireOrgAdminOrOwner  -> "self WITH grant" fails
//   M2 never calls requireOrgAdminOrOwner   -> "self WITHOUT grant" fails
//   M3 reads the TARGET's grant, not the caller's own
//                                           -> "other target whose grant is ON" fails
//   M4 swaps the (firmId, advisorUserId) positional args
//                                           -> the explicit toHaveBeenCalledWith fails
//   M5 gates on `own` truthiness, not `own.brandingEnabled`
//                                           -> "profile exists, grant off" fails
//   M6 admin may not edit an off-grant profile
//                                           -> "admin preps an off-grant brand" fails

import { describe, it, expect, vi, beforeEach } from "vitest";

const requireOrgAdminOrOwnerMock = vi.fn();
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return { ...actual, requireOrgAdminOrOwner: () => requireOrgAdminOrOwnerMock() };
});

const getAdvisorProfileMock = vi.fn();
vi.mock("@/lib/branding/advisor-profile", () => ({
  getAdvisorProfile: (...args: unknown[]) => getAdvisorProfileMock(...args),
}));

import { ForbiddenError } from "@/lib/authz";
import { assertCanEditAdvisorBranding } from "../advisor-authz";

beforeEach(() => {
  requireOrgAdminOrOwnerMock.mockReset();
  getAdvisorProfileMock.mockReset();
});

describe("assertCanEditAdvisorBranding — editing your own brand", () => {
  it("resolves when your OWN grant is on, and never consults the admin gate", async () => {
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });
    // If the helper reaches for the admin gate at all, this rejection surfaces.
    requireOrgAdminOrOwnerMock.mockRejectedValue(new ForbiddenError());

    await expect(
      assertCanEditAdvisorBranding("firm-1", "member-1", "member-1"),
    ).resolves.toBeUndefined();

    expect(requireOrgAdminOrOwnerMock).not.toHaveBeenCalled();
    // Positional-arg proof: (firmId, advisorUserId) — a swap reads a
    // nonexistent firm and would silently deny every granted advisor.
    expect(getAdvisorProfileMock).toHaveBeenCalledWith("firm-1", "member-1");
  });

  it("throws when you have NO profile row and you are not an admin", async () => {
    getAdvisorProfileMock.mockResolvedValue(null);
    requireOrgAdminOrOwnerMock.mockRejectedValue(new ForbiddenError());

    await expect(
      assertCanEditAdvisorBranding("firm-1", "member-1", "member-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws when your profile EXISTS but the grant is off and you are not an admin", async () => {
    // Distinguishes `if (!own)` from `if (!own?.brandingEnabled)`.
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: false, brandName: "Old" });
    requireOrgAdminOrOwnerMock.mockRejectedValue(new ForbiddenError());

    await expect(
      assertCanEditAdvisorBranding("firm-1", "member-1", "member-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(requireOrgAdminOrOwnerMock).toHaveBeenCalled();
  });

  it("resolves for an ADMIN editing their own off-grant profile (the fallback path)", async () => {
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: false });
    requireOrgAdminOrOwnerMock.mockResolvedValue(undefined);

    await expect(
      assertCanEditAdvisorBranding("firm-1", "admin-1", "admin-1"),
    ).resolves.toBeUndefined();
  });
});

describe("assertCanEditAdvisorBranding — editing SOMEONE ELSE's brand", () => {
  it("throws for a non-admin even when the TARGET's grant is on", async () => {
    // The load-bearing case. An implementation that authorizes off the
    // target's brandingEnabled instead of the caller's own passes every
    // other test in this file and hands any member write access to every
    // granted advisor's brand.
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });
    requireOrgAdminOrOwnerMock.mockRejectedValue(new ForbiddenError());

    await expect(
      assertCanEditAdvisorBranding("firm-1", "member-1", "other-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
    // and it must not even read the target's row to decide
    expect(getAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("throws for a non-admin when the caller's OWN grant is on", async () => {
    // Symmetric guard: holding your own grant must not extend to other people.
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });
    requireOrgAdminOrOwnerMock.mockRejectedValue(new ForbiddenError());

    await expect(
      assertCanEditAdvisorBranding("firm-1", "member-1", "other-1"),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("resolves for an admin, including when the target's grant is OFF (brand prep)", async () => {
    requireOrgAdminOrOwnerMock.mockResolvedValue(undefined);
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: false });

    await expect(
      assertCanEditAdvisorBranding("firm-1", "admin-1", "member-2"),
    ).resolves.toBeUndefined();
    expect(requireOrgAdminOrOwnerMock).toHaveBeenCalledTimes(1);
    // No profile read is needed on the admin path — the grant is irrelevant.
    expect(getAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("propagates a non-Forbidden failure from the admin gate untouched (no swallow)", async () => {
    // A `catch {}` around the gate would turn an auth outage into an open door.
    requireOrgAdminOrOwnerMock.mockRejectedValue(new Error("clerk unavailable"));

    await expect(
      assertCanEditAdvisorBranding("firm-1", "member-1", "other-1"),
    ).rejects.toThrow("clerk unavailable");
  });
});
