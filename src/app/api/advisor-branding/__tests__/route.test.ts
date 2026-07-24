// src/app/api/advisor-branding/__tests__/route.test.ts
//
// Unit tests for the advisor-branding API: GET/PUT at ../route and the
// admin-only grant toggle at ../[advisorUserId]/enabled/route. Mocks at the
// lib boundary (`requireOrgAndUser`, `requireOrgAdminOrOwner`,
// `getAdvisorProfile` / `upsertAdvisorProfile` / `setAdvisorBrandingEnabled`,
// `recordAudit`) so the suite runs without a live database. `authErrorResponse`
// and `ForbiddenError` are the REAL implementations (via importActual) so the
// 401/403 mapping itself is exercised, not just stubbed to pass.
//
// Per the Task 14 brief: assertions target the arguments handed to
// `upsertAdvisorProfile` / `setAdvisorBrandingEnabled`, not merely response
// status — this branch has twice shipped vacuously-passing tests where a
// wrong implementation computed a value and discarded it.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Auth mocks ──────────────────────────────────────────────────────────────
const requireOrgAndUserMock = vi.fn();
vi.mock("@/lib/db-helpers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/db-helpers")>("@/lib/db-helpers");
  return {
    ...actual,
    requireOrgAndUser: () => requireOrgAndUserMock(),
  };
});

const requireOrgAdminOrOwnerMock = vi.fn();
vi.mock("@/lib/authz", async () => {
  const actual = await vi.importActual<typeof import("@/lib/authz")>("@/lib/authz");
  return {
    ...actual,
    requireOrgAdminOrOwner: () => requireOrgAdminOrOwnerMock(),
  };
});

// ── Branding data-access mocks ──────────────────────────────────────────────
const getAdvisorProfileMock = vi.fn();
const upsertAdvisorProfileMock = vi.fn();
const setAdvisorBrandingEnabledMock = vi.fn();
vi.mock("@/lib/branding/advisor-profile", () => ({
  getAdvisorProfile: (...args: unknown[]) => getAdvisorProfileMock(...args),
  upsertAdvisorProfile: (...args: unknown[]) => upsertAdvisorProfileMock(...args),
  setAdvisorBrandingEnabled: (...args: unknown[]) => setAdvisorBrandingEnabledMock(...args),
}));

// ── Audit mock ───────────────────────────────────────────────────────────────
const recordAuditMock = vi.fn();
vi.mock("@/lib/audit", () => ({
  recordAudit: (args: unknown) => recordAuditMock(args),
}));

import { ForbiddenError } from "@/lib/authz";
import { GET, PUT } from "../route";
import { PATCH } from "../[advisorUserId]/enabled/route";

// ── Request helpers ──────────────────────────────────────────────────────────
function getReq(qs = "") {
  return new Request(`http://localhost/api/advisor-branding${qs}`);
}
function putReq(body: unknown, qs = "") {
  return new Request(`http://localhost/api/advisor-branding${qs}`, {
    method: "PUT",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}
function patchReq(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/advisor-branding/target/enabled", {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  requireOrgAndUserMock.mockReset();
  requireOrgAdminOrOwnerMock.mockReset();
  getAdvisorProfileMock.mockReset();
  upsertAdvisorProfileMock.mockReset();
  setAdvisorBrandingEnabledMock.mockReset();
  recordAuditMock.mockReset();

  requireOrgAndUserMock.mockResolvedValue({ orgId: "firm-1", userId: "member-1" });
  upsertAdvisorProfileMock.mockImplementation(
    (firmId: string, advisorUserId: string, fields: Record<string, unknown>) =>
      Promise.resolve({ firmId, advisorUserId, brandingEnabled: false, ...fields }),
  );
  setAdvisorBrandingEnabledMock.mockResolvedValue(undefined);
  recordAuditMock.mockResolvedValue(undefined);
});

// ── PATCH /api/advisor-branding/[advisorUserId]/enabled ──────────────────────
describe("PATCH /api/advisor-branding/[advisorUserId]/enabled", () => {
  it("admin PATCH enables a member: 200, setAdvisorBrandingEnabled called with (firmId, target, true, actor)", async () => {
    requireOrgAdminOrOwnerMock.mockResolvedValue(undefined);
    requireOrgAndUserMock.mockResolvedValue({ orgId: "firm-1", userId: "admin-1" });

    const res = await PATCH(patchReq({ enabled: true }), {
      params: Promise.resolve({ advisorUserId: "member-1" }),
    });

    expect(res.status).toBe(200);
    expect(setAdvisorBrandingEnabledMock).toHaveBeenCalledWith(
      "firm-1",
      "member-1",
      true,
      "admin-1",
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "advisor_branding.grant",
        resourceType: "advisor_profile",
        resourceId: "member-1",
        firmId: "firm-1",
      }),
    );
  });

  it("non-admin PATCH -> 403, never calls setAdvisorBrandingEnabled", async () => {
    requireOrgAdminOrOwnerMock.mockRejectedValue(new ForbiddenError());

    const res = await PATCH(patchReq({ enabled: true }), {
      params: Promise.resolve({ advisorUserId: "member-1" }),
    });

    expect(res.status).toBe(403);
    expect(setAdvisorBrandingEnabledMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });
});

// ── PUT /api/advisor-branding ──────────────────────────────────────────────
describe("PUT /api/advisor-branding", () => {
  it("member PUT on own profile WITH brandingEnabled -> 200, upserts against own id, never consults the admin gate", async () => {
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });
    requireOrgAdminOrOwnerMock.mockRejectedValue(new ForbiddenError()); // must never fire

    const res = await PUT(putReq({ brandName: "My Brand" }));

    expect(res.status).toBe(200);
    expect(requireOrgAdminOrOwnerMock).not.toHaveBeenCalled();
    expect(upsertAdvisorProfileMock).toHaveBeenCalledWith(
      "firm-1",
      "member-1",
      expect.objectContaining({ brandName: "My Brand" }),
      "member-1",
    );
  });

  it("member PUT on own profile WITHOUT brandingEnabled -> 403, never upserts", async () => {
    getAdvisorProfileMock.mockResolvedValue(null);
    requireOrgAdminOrOwnerMock.mockRejectedValue(new ForbiddenError());

    const res = await PUT(putReq({ brandName: "Nope" }));

    expect(res.status).toBe(403);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("member PUT on someone else's profile (?advisorUserId=other) -> 403, own profile is never even consulted", async () => {
    requireOrgAdminOrOwnerMock.mockRejectedValue(new ForbiddenError());

    const res = await PUT(putReq({ brandName: "Hack" }, "?advisorUserId=other-1"));

    expect(res.status).toBe(403);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
    expect(getAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("admin PUT on anyone -> 200, including a target whose own grant is OFF; upserts the TARGET id, not the admin's", async () => {
    requireOrgAndUserMock.mockResolvedValue({ orgId: "firm-1", userId: "admin-1" });
    requireOrgAdminOrOwnerMock.mockResolvedValue(undefined);
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: false });

    const res = await PUT(putReq({ brandName: "Prepped Brand" }, "?advisorUserId=member-2"));

    expect(res.status).toBe(200);
    expect(upsertAdvisorProfileMock).toHaveBeenCalledWith(
      "firm-1",
      "member-2",
      expect.objectContaining({ brandName: "Prepped Brand" }),
      "admin-1",
    );
  });

  it("PUT with an unknown field -> 400 (proves .strict()), never upserts", async () => {
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });

    const res = await PUT(putReq({ brandName: "ok", notARealField: "bad" }));

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it('PUT with "" for a URL field -> 200 and stores null, NOT ""', async () => {
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });

    const res = await PUT(putReq({ logoUrl: "" }));

    expect(res.status).toBe(200);
    expect(upsertAdvisorProfileMock).toHaveBeenCalledTimes(1);
    const fieldsArg = upsertAdvisorProfileMock.mock.calls[0][2] as Record<string, unknown>;
    expect(fieldsArg).toHaveProperty("logoUrl");
    expect(fieldsArg.logoUrl).toBeNull();
  });
});

// ── GET /api/advisor-branding ───────────────────────────────────────────────
describe("GET /api/advisor-branding", () => {
  it("GET own profile -> 200, resolves via own userId, never consults the admin gate", async () => {
    getAdvisorProfileMock.mockResolvedValue({ brandName: "Mine" });

    const res = await GET(getReq());

    expect(res.status).toBe(200);
    expect(getAdvisorProfileMock).toHaveBeenCalledWith("firm-1", "member-1");
    expect(requireOrgAdminOrOwnerMock).not.toHaveBeenCalled();
  });

  it("GET ?advisorUserId=other as non-admin -> 403, never reads the target's profile", async () => {
    requireOrgAdminOrOwnerMock.mockRejectedValue(new ForbiddenError());

    const res = await GET(getReq("?advisorUserId=other-1"));

    expect(res.status).toBe(403);
    expect(getAdvisorProfileMock).not.toHaveBeenCalled();
  });
});
