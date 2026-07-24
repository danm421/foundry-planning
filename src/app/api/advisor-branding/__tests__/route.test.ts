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
        metadata: { enabled: true },
      }),
    );
  });

  it("admin PATCH revokes a member: 200, setAdvisorBrandingEnabled called with enabled=false, audit metadata says enabled: false", async () => {
    requireOrgAdminOrOwnerMock.mockResolvedValue(undefined);
    requireOrgAndUserMock.mockResolvedValue({ orgId: "firm-1", userId: "admin-1" });

    const res = await PATCH(patchReq({ enabled: false }), {
      params: Promise.resolve({ advisorUserId: "member-1" }),
    });

    expect(res.status).toBe(200);
    expect(setAdvisorBrandingEnabledMock).toHaveBeenCalledWith(
      "firm-1",
      "member-1",
      false,
      "admin-1",
    );
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { enabled: false } }),
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

  it("PATCH with enabled: \"yes\" (non-boolean) -> 400, never calls setAdvisorBrandingEnabled", async () => {
    requireOrgAdminOrOwnerMock.mockResolvedValue(undefined);

    const res = await PATCH(patchReq({ enabled: "yes" }), {
      params: Promise.resolve({ advisorUserId: "member-1" }),
    });

    expect(res.status).toBe(400);
    expect(setAdvisorBrandingEnabledMock).not.toHaveBeenCalled();
  });

  it("PATCH with an empty body -> 400, never calls setAdvisorBrandingEnabled", async () => {
    requireOrgAdminOrOwnerMock.mockResolvedValue(undefined);

    const res = await PATCH(patchReq({}), {
      params: Promise.resolve({ advisorUserId: "member-1" }),
    });

    expect(res.status).toBe(400);
    expect(setAdvisorBrandingEnabledMock).not.toHaveBeenCalled();
  });

  it("PATCH with an unknown field -> 400 (proves .strict()), never calls setAdvisorBrandingEnabled", async () => {
    requireOrgAdminOrOwnerMock.mockResolvedValue(undefined);

    const res = await PATCH(patchReq({ enabled: true, notARealField: "bad" }), {
      params: Promise.resolve({ advisorUserId: "member-1" }),
    });

    expect(res.status).toBe(400);
    expect(setAdvisorBrandingEnabledMock).not.toHaveBeenCalled();
  });
});

// ── PUT /api/advisor-branding ──────────────────────────────────────────────
describe("PUT /api/advisor-branding", () => {
  it("member PUT on own profile WITH brandingEnabled -> 200, upserts against own id, never consults the admin gate, records audit with fieldsChanged", async () => {
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
    expect(recordAuditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "advisor_branding.update",
        resourceType: "advisor_profile",
        resourceId: "member-1",
        firmId: "firm-1",
        metadata: expect.objectContaining({ fieldsChanged: ["brandName"] }),
      }),
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
    // Was written against `logoUrl`, which is no longer a PUT-able field
    // (see the host-lock removal below). Repointed to `website`, the URL
    // field that remains — the property under test is the trimToNull
    // preprocessor, which is shared and unchanged.
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });

    const res = await PUT(putReq({ website: "" }));

    expect(res.status).toBe(200);
    expect(upsertAdvisorProfileMock).toHaveBeenCalledTimes(1);
    const fieldsArg = upsertAdvisorProfileMock.mock.calls[0][2] as Record<string, unknown>;
    expect(fieldsArg).toHaveProperty("website");
    expect(fieldsArg.website).toBeNull();
  });

  it("PUT with a malformed emailReplyTo -> 400, never upserts", async () => {
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });

    const res = await PUT(putReq({ emailReplyTo: "not-an-email" }));

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("PUT with a malformed website URL -> 400, never upserts", async () => {
    // Also repointed from `logoUrl`. Left on `logoUrl` it would still have
    // gone green — but via `.strict()`, not URL validation, silently losing
    // the malformed-URL coverage it was written for.
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });

    const res = await PUT(putReq({ website: "not-a-url" }));

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("PUT with website: javascript:alert(1) -> 400, never upserts", async () => {
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });

    const res = await PUT(putReq({ website: "javascript:alert(1)" }));

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });
});

// ── logoUrl / faviconUrl are NOT PUT-able (Task 15a review, Finding A) ──
//
// These two columns feed `deleteBrandingAsset()` on the replace/remove paths,
// which will `del()` ANY object in our public Blob store given its URL. A
// host check cannot distinguish our object from another tenant's --
// `*.public.blob.vercel-storage.com` is the shared multi-tenant Blob
// hostname, and every firm's assets live in one store. So a validated
// free-text URL still let an advisor point `logoUrl` at another firm's logo
// and then call remove, permanently deleting it.
//
// The fix is that the fields are no longer part of the schema at all: they
// are written only by the upload/remove server actions, from the URL Blob
// itself returned. `.strict()` turns any PUT carrying them into a 400.
describe("PUT /api/advisor-branding — logoUrl/faviconUrl are action-only", () => {
  const BLOB =
    "https://abc123xyz.public.blob.vercel-storage.com/firms/f1/advisors/a1/branding/logo-Rk3.png";

  beforeEach(() => {
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });
  });

  it("rejects logoUrl even when it IS a real blob URL -> 400, never upserts", async () => {
    // The blob host is no longer a passport: this is exactly the shape a
    // legitimate upload produces, and the API still refuses it.
    const res = await PUT(putReq({ logoUrl: BLOB }));

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("rejects faviconUrl on a blob URL -> 400, never upserts", async () => {
    const res = await PUT(putReq({ faviconUrl: BLOB }));

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("rejects ANOTHER firm's blob URL -> 400 (the deletion attack, closed)", async () => {
    // Lifted from a branded intake page's rendered <img src>. Under the old
    // host lock this was accepted, and a follow-up remove would have del()'d
    // the victim firm's live logo.
    const res = await PUT(
      putReq({
        logoUrl:
          "https://abc123xyz.public.blob.vercel-storage.com/firms/VICTIM/advisors/v1/branding/logo-Zz9.png",
      }),
    );

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("rejects logoUrl: null too — clearing goes through removeAdvisorBrandingAsset", async () => {
    // `.strict()` keys off the KEY, not the value. Clearing must go through
    // the action so the blob is deleted alongside the column.
    const res = await PUT(putReq({ logoUrl: null }));

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("does not leak the two fields into fieldsChanged on an otherwise-valid PUT", async () => {
    // A partial-strip implementation that dropped the keys instead of
    // rejecting would return 200 here and quietly ignore the asset field.
    const res = await PUT(putReq({ brandName: "Ok", logoUrl: BLOB }));

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
    expect(recordAuditMock).not.toHaveBeenCalled();
  });

  it("still accepts an ordinary external URL for `website` (the field set was not over-pruned)", async () => {
    // Guards the opposite failure: pruning every URL field would break the
    // advisor's real website and pass every test above.
    const res = await PUT(putReq({ website: "https://advisor-firm.example.com/about" }));

    expect(res.status).toBe(200);
    expect(upsertAdvisorProfileMock).toHaveBeenCalledWith(
      "firm-1",
      "member-1",
      expect.objectContaining({ website: "https://advisor-firm.example.com/about" }),
      "member-1",
    );
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
