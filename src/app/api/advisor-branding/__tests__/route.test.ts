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
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });

    const res = await PUT(putReq({ logoUrl: "" }));

    expect(res.status).toBe(200);
    expect(upsertAdvisorProfileMock).toHaveBeenCalledTimes(1);
    const fieldsArg = upsertAdvisorProfileMock.mock.calls[0][2] as Record<string, unknown>;
    expect(fieldsArg).toHaveProperty("logoUrl");
    expect(fieldsArg.logoUrl).toBeNull();
  });

  it("PUT with a malformed emailReplyTo -> 400, never upserts", async () => {
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });

    const res = await PUT(putReq({ emailReplyTo: "not-an-email" }));

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("PUT with a malformed logoUrl -> 400, never upserts", async () => {
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });

    const res = await PUT(putReq({ logoUrl: "not-a-url" }));

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

// ── logoUrl / faviconUrl host lock (Task 15a Step 3) ───────────────────────
//
// These two columns feed `loadLogo()`, which does a bare server-side
// fetch(url) with no allowlist, and `resolveIntakeBrandingForClient`, which
// hands the raw URL to the client portal (where `img-src` allows only
// *.public.blob.vercel-storage.com). Free-text URLs there are an
// authenticated SSRF with an image response channel plus a CSP violation
// waiting for the header to go enforcing. `website` is deliberately NOT
// locked — it is a real external site.
describe("PUT /api/advisor-branding — asset URL host lock", () => {
  const BLOB = "https://abc123xyz.public.blob.vercel-storage.com/firms/f1/advisors/a1/branding/logo-Rk3.png";

  beforeEach(() => {
    getAdvisorProfileMock.mockResolvedValue({ brandingEnabled: true });
  });

  it("accepts a URL on our public blob host and stores it verbatim", async () => {
    const res = await PUT(putReq({ logoUrl: BLOB }));

    expect(res.status).toBe(200);
    expect(upsertAdvisorProfileMock).toHaveBeenCalledWith(
      "firm-1",
      "member-1",
      expect.objectContaining({ logoUrl: BLOB }),
      "member-1",
    );
  });

  it("rejects a logoUrl on a foreign host -> 400, never upserts", async () => {
    // The SSRF case: a well-formed https URL that is not ours.
    const res = await PUT(putReq({ logoUrl: "https://evil.example.com/logo.png" }));

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("rejects a logoUrl pointing at an internal address -> 400, never upserts", async () => {
    const res = await PUT(putReq({ logoUrl: "http://169.254.169.254/latest/meta-data/" }));

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("rejects a faviconUrl on a foreign host -> 400, never upserts", async () => {
    // Proves the lock is on BOTH columns, not just the one that was tested.
    const res = await PUT(putReq({ faviconUrl: "https://evil.example.com/fav.png" }));

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("rejects a host that merely ENDS WITH our domain as a suffix -> 400", async () => {
    // `evilpublic.blob.vercel-storage.com` passes an unanchored
    // `endsWith`/`includes` check and is attacker-registrable.
    const res = await PUT(
      putReq({ logoUrl: "https://evilpublic.blob.vercel-storage.com/logo.png" }),
    );

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("rejects a host that merely CONTAINS our domain as a prefix -> 400", async () => {
    // `...vercel-storage.com.evil.io` passes a naive `includes` check.
    const res = await PUT(
      putReq({ logoUrl: "https://public.blob.vercel-storage.com.evil.io/logo.png" }),
    );

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("rejects our domain smuggled into the userinfo section -> 400", async () => {
    // https://<userinfo>@evil.io/ — the real host is evil.io. Only a real
    // URL parse (not a substring test) gets this right.
    const res = await PUT(
      putReq({ logoUrl: "https://abc.public.blob.vercel-storage.com@evil.io/logo.png" }),
    );

    expect(res.status).toBe(400);
    expect(upsertAdvisorProfileMock).not.toHaveBeenCalled();
  });

  it("still accepts explicit null on logoUrl (the clear path stays open)", async () => {
    const res = await PUT(putReq({ logoUrl: null }));

    expect(res.status).toBe(200);
    const fields = upsertAdvisorProfileMock.mock.calls[0][2] as Record<string, unknown>;
    expect(fields.logoUrl).toBeNull();
  });

  it("still accepts an ordinary external URL for `website` (the lock is not over-broad)", async () => {
    // Guards the opposite failure: a lock applied to every URL field would
    // break the advisor's real website and pass every test above.
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
