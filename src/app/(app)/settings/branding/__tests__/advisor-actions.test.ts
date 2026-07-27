// src/app/(app)/settings/branding/__tests__/advisor-actions.test.ts
//
// Advisor logo/favicon upload + remove server actions (Task 15a Step 2).
// Mirrors the firm-level actions.test.ts harness, with three additions that
// the firm version has no need for:
//   - the gate is `assertCanEditAdvisorBranding`, NOT requireOrgAdminOrOwner
//     (a granted advisor editing their own brand is the whole feature);
//   - the blob pathname is advisor-scoped but keeps the `firms/<firmId>/`
//     prefix that the purge depends on;
//   - `advisorUserId` resolves absent/blank to self, matching the route's
//     `resolveTarget`.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockPutAdvisor = vi.fn();
const mockDel = vi.fn();
const mockGetAdvisorProfile = vi.fn();
const mockUpsertAdvisorProfile = vi.fn();
const mockRecordAudit = vi.fn();
const mockRevalidatePath = vi.fn();
const mockAssertCanEdit = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth(), clerkClient: vi.fn() }));
vi.mock("@/lib/branding/blob", () => ({
  putAdvisorBrandingAsset: (...a: unknown[]) => mockPutAdvisor(...a),
  deleteBrandingAsset: (...a: unknown[]) => mockDel(...a),
}));
vi.mock("@/lib/branding/advisor-profile", () => ({
  getAdvisorProfile: (...a: unknown[]) => mockGetAdvisorProfile(...a),
  upsertAdvisorProfile: (...a: unknown[]) => mockUpsertAdvisorProfile(...a),
}));
vi.mock("@/lib/branding/advisor-authz", () => ({
  assertCanEditAdvisorBranding: (...a: unknown[]) => mockAssertCanEdit(...a),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => mockRecordAudit(...a) }));
vi.mock("next/cache", () => ({ revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a) }));

import {
  uploadAdvisorBrandingAsset,
  removeAdvisorBrandingAsset,
} from "../advisor-actions";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const BLOB_URL = "https://s1.public.blob.vercel-storage.com/firms/org_1/advisors/adv_1/branding/logo-Rk3.png";
// Old assets must sit under the SAME advisor prefix, or the deletion guard
// (correctly) refuses to del() them.
const OWN_OLD = "https://s1.public.blob.vercel-storage.com/firms/org_1/advisors/adv_1/branding/logo-Old1.png";
const OWN_OLD_FAV = "https://s1.public.blob.vercel-storage.com/firms/org_1/advisors/adv_1/branding/favicon-Old2.png";
const OTHER_ADVISOR_OLD = "https://s1.public.blob.vercel-storage.com/firms/org_1/advisors/adv_other/branding/logo-Old3.png";
// Same Blob store, different firm — the exact URL an attacker would lift from
// a branded public intake page.
const VICTIM_ASSET = "https://s1.public.blob.vercel-storage.com/firms/VICTIM_ORG/advisors/v1/branding/logo-Zz9.png";

function fileFormData(name: string, mime: string, body: Buffer): FormData {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(body)], name, { type: mime }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ orgId: "org_1", userId: "adv_1" });
  mockAssertCanEdit.mockResolvedValue(undefined);
  mockGetAdvisorProfile.mockResolvedValue(null);
  mockUpsertAdvisorProfile.mockResolvedValue({});
  mockPutAdvisor.mockResolvedValue({ url: BLOB_URL });
});

describe("uploadAdvisorBrandingAsset — authorization", () => {
  it("gates on assertCanEditAdvisorBranding with (orgId, callerUserId, target)", async () => {
    await uploadAdvisorBrandingAsset("logo", fileFormData("l.png", "image/png", PNG));
    expect(mockAssertCanEdit).toHaveBeenCalledWith("org_1", "adv_1", "adv_1");
  });

  it("passes the EXPLICIT advisorUserId as the target, not the caller", async () => {
    // Admin-mode edit. If the action ignored the argument and always used
    // the caller, the gate would be asked the wrong question and the asset
    // would land on the admin's own profile.
    await uploadAdvisorBrandingAsset(
      "logo",
      fileFormData("l.png", "image/png", PNG),
      "adv_other",
    );
    expect(mockAssertCanEdit).toHaveBeenCalledWith("org_1", "adv_1", "adv_other");
    expect(mockPutAdvisor).toHaveBeenCalledWith(
      expect.objectContaining({ advisorUserId: "adv_other" }),
    );
    expect(mockUpsertAdvisorProfile).toHaveBeenCalledWith(
      "org_1",
      "adv_other",
      expect.anything(),
      "adv_1",
    );
  });

  it("treats a blank/whitespace advisorUserId as self", async () => {
    await uploadAdvisorBrandingAsset("logo", fileFormData("l.png", "image/png", PNG), "   ");
    expect(mockAssertCanEdit).toHaveBeenCalledWith("org_1", "adv_1", "adv_1");
  });

  it("does NOT upload or write when the gate throws", async () => {
    mockAssertCanEdit.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      uploadAdvisorBrandingAsset("logo", fileFormData("l.png", "image/png", PNG)),
    ).rejects.toThrow("Forbidden");
    expect(mockPutAdvisor).not.toHaveBeenCalled();
    expect(mockUpsertAdvisorProfile).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("refuses to act when there is no active org", async () => {
    mockAuth.mockResolvedValue({ orgId: null, userId: "adv_1" });
    const result = await uploadAdvisorBrandingAsset(
      "logo",
      fileFormData("l.png", "image/png", PNG),
    );
    expect(result.ok).toBe(false);
    expect(mockPutAdvisor).not.toHaveBeenCalled();
    expect(mockUpsertAdvisorProfile).not.toHaveBeenCalled();
  });

  it("refuses to act when there is no signed-in user", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_1", userId: null });
    const result = await uploadAdvisorBrandingAsset(
      "logo",
      fileFormData("l.png", "image/png", PNG),
    );
    expect(result.ok).toBe(false);
    expect(mockAssertCanEdit).not.toHaveBeenCalled();
    expect(mockPutAdvisor).not.toHaveBeenCalled();
  });
});

describe("uploadAdvisorBrandingAsset — happy path", () => {
  it("uploads, persists the returned URL on the advisor profile, audits, revalidates", async () => {
    const result = await uploadAdvisorBrandingAsset(
      "logo",
      fileFormData("l.png", "image/png", PNG),
    );

    expect(result).toEqual({ ok: true, url: BLOB_URL });
    expect(mockPutAdvisor).toHaveBeenCalledWith(
      expect.objectContaining({
        firmId: "org_1",
        advisorUserId: "adv_1",
        kind: "logo",
        contentType: "image/png",
      }),
    );
    // The URL written must be the one BLOB returned — not the file name,
    // not a guessed path.
    expect(mockUpsertAdvisorProfile).toHaveBeenCalledWith(
      "org_1",
      "adv_1",
      { logoUrl: BLOB_URL },
      "adv_1",
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "advisor_branding.asset_changed",
        resourceType: "advisor_profile",
        resourceId: "adv_1",
        firmId: "org_1",
        metadata: { kind: "logo", before: null, after: BLOB_URL },
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings/branding");
  });

  it("writes faviconUrl (not logoUrl) for kind=favicon", async () => {
    // A column mix-up passes every status-only assertion.
    await uploadAdvisorBrandingAsset("favicon", fileFormData("f.png", "image/png", PNG));
    expect(mockUpsertAdvisorProfile).toHaveBeenCalledWith(
      "org_1",
      "adv_1",
      { faviconUrl: BLOB_URL },
      "adv_1",
    );
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ kind: "favicon" }) }),
    );
  });

  it("deletes the replaced blob and reports it as `before` in the audit row", async () => {
    mockGetAdvisorProfile.mockResolvedValue({ logoUrl: OWN_OLD, faviconUrl: null });
    await uploadAdvisorBrandingAsset("logo", fileFormData("l.png", "image/png", PNG));
    expect(mockDel).toHaveBeenCalledWith(OWN_OLD);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ before: OWN_OLD }),
      }),
    );
  });

  it("does not delete the OTHER kind's blob when replacing one", async () => {
    mockGetAdvisorProfile.mockResolvedValue({
      logoUrl: OWN_OLD,
      faviconUrl: OWN_OLD_FAV,
    });
    await uploadAdvisorBrandingAsset("logo", fileFormData("l.png", "image/png", PNG));
    expect(mockDel).toHaveBeenCalledWith(OWN_OLD);
    expect(mockDel).not.toHaveBeenCalledWith(OWN_OLD_FAV);
  });

  it("still succeeds when the old-blob delete fails (orphan tolerated)", async () => {
    mockGetAdvisorProfile.mockResolvedValue({ logoUrl: OWN_OLD, faviconUrl: null });
    mockDel.mockRejectedValueOnce(new Error("blob down"));
    const result = await uploadAdvisorBrandingAsset(
      "logo",
      fileFormData("l.png", "image/png", PNG),
    );
    expect(result.ok).toBe(true);
    expect(mockUpsertAdvisorProfile).toHaveBeenCalled();
  });
});

describe("uploadAdvisorBrandingAsset — validation", () => {
  it("rejects a non-image body whose MIME claims PNG, without uploading", async () => {
    const result = await uploadAdvisorBrandingAsset(
      "logo",
      fileFormData("fake.png", "image/png", Buffer.from("not a real png")),
    );
    expect(result.ok).toBe(false);
    expect(mockPutAdvisor).not.toHaveBeenCalled();
    expect(mockUpsertAdvisorProfile).not.toHaveBeenCalled();
  });

  it("applies the FAVICON rules to kind=favicon (JPEG is a logo-only MIME)", async () => {
    // Proves validateFavicon is used, not validateLogo for both kinds.
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    const result = await uploadAdvisorBrandingAsset(
      "favicon",
      fileFormData("f.jpg", "image/jpeg", JPEG),
    );
    expect(result.ok).toBe(false);
    expect(mockPutAdvisor).not.toHaveBeenCalled();
  });

  it("rejects a missing file", async () => {
    const result = await uploadAdvisorBrandingAsset("logo", new FormData());
    expect(result.ok).toBe(false);
    expect(mockPutAdvisor).not.toHaveBeenCalled();
  });

  it("returns an error instead of throwing when the blob PUT fails, and writes nothing", async () => {
    // An uncaught throw in a server action takes out the whole page via the
    // error boundary instead of surfacing a toast.
    mockPutAdvisor.mockRejectedValueOnce(new Error("Cannot use public access on a private store"));
    const result = await uploadAdvisorBrandingAsset(
      "logo",
      fileFormData("l.png", "image/png", PNG),
    );
    expect(result.ok).toBe(false);
    expect(mockUpsertAdvisorProfile).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});

describe("removeAdvisorBrandingAsset", () => {
  it("gates on assertCanEditAdvisorBranding and writes nothing when it throws", async () => {
    mockAssertCanEdit.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(removeAdvisorBrandingAsset("logo")).rejects.toThrow("Forbidden");
    expect(mockUpsertAdvisorProfile).not.toHaveBeenCalled();
    expect(mockDel).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("nulls the column, deletes the blob, audits after -> null", async () => {
    mockGetAdvisorProfile.mockResolvedValue({ logoUrl: OWN_OLD, faviconUrl: null });
    const result = await removeAdvisorBrandingAsset("logo");

    expect(result).toEqual({ ok: true });
    expect(mockUpsertAdvisorProfile).toHaveBeenCalledWith(
      "org_1",
      "adv_1",
      { logoUrl: null },
      "adv_1",
    );
    expect(mockDel).toHaveBeenCalledWith(OWN_OLD);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "advisor_branding.asset_changed",
        resourceId: "adv_1",
        metadata: { kind: "logo", before: OWN_OLD, after: null },
      }),
    );
  });

  it("removes the TARGET's asset in admin mode, not the caller's", async () => {
    mockGetAdvisorProfile.mockResolvedValue({ logoUrl: OTHER_ADVISOR_OLD, faviconUrl: null });
    await removeAdvisorBrandingAsset("logo", "adv_other");
    expect(mockGetAdvisorProfile).toHaveBeenCalledWith("org_1", "adv_other");
    expect(mockUpsertAdvisorProfile).toHaveBeenCalledWith(
      "org_1",
      "adv_other",
      { logoUrl: null },
      "adv_1",
    );
    // The prefix guard is keyed to the TARGET, not the caller — an admin
    // clearing someone else's asset must still be able to delete it.
    expect(mockDel).toHaveBeenCalledWith(OTHER_ADVISOR_OLD);
  });

  it("revalidates /settings/branding after a remove", async () => {
    // Finding G: without this, an implementation that forgot revalidatePath
    // on the remove path passed every other case here, and the advisor kept
    // seeing the deleted logo until a hard refresh.
    mockGetAdvisorProfile.mockResolvedValue({ logoUrl: OWN_OLD, faviconUrl: null });
    await removeAdvisorBrandingAsset("logo");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/settings/branding");
  });

  it("noops (no write, no delete, no audit) when there is nothing to remove", async () => {
    mockGetAdvisorProfile.mockResolvedValue({ logoUrl: null, faviconUrl: null });
    const result = await removeAdvisorBrandingAsset("logo");
    expect(result).toEqual({ ok: true, noop: true });
    expect(mockUpsertAdvisorProfile).not.toHaveBeenCalled();
    expect(mockDel).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("noops when the advisor has no profile row at all", async () => {
    mockGetAdvisorProfile.mockResolvedValue(null);
    const result = await removeAdvisorBrandingAsset("favicon");
    expect(result).toEqual({ ok: true, noop: true });
    expect(mockUpsertAdvisorProfile).not.toHaveBeenCalled();
  });
});

// ── Blob deletion guard (defense in depth) ─────────────────────────────────
//
// `deleteBrandingAsset` will del() ANY object in our public store given its
// URL, and it is fed straight out of a DB column with no constraint on it.
// The API can no longer write that column, so this is redundant today — but
// del() is irreversible and the 15a review found this exact assumption wrong
// once already. Guard the dangerous call itself, not just its callers.
describe("blob deletion is confined to the advisor's own prefix", () => {
  it("refuses to delete another FIRM's asset while still clearing the column", async () => {
    // The attack the review found: a URL lifted from a victim firm's branded
    // intake page. Even if it somehow lands in the column, remove must not
    // destroy the victim's live logo.
    mockGetAdvisorProfile.mockResolvedValue({ logoUrl: VICTIM_ASSET, faviconUrl: null });

    const result = await removeAdvisorBrandingAsset("logo");

    expect(result).toEqual({ ok: true });
    expect(mockDel).not.toHaveBeenCalled();
    // The advisor's own column is still cleared — we refuse the DELETE, not
    // the user's action.
    expect(mockUpsertAdvisorProfile).toHaveBeenCalledWith(
      "org_1",
      "adv_1",
      { logoUrl: null },
      "adv_1",
    );
  });

  it("refuses to delete ANOTHER ADVISOR's asset in the same firm", async () => {
    // Firm-level scoping is not enough — the prefix is per advisor.
    mockGetAdvisorProfile.mockResolvedValue({ logoUrl: OTHER_ADVISOR_OLD, faviconUrl: null });

    await removeAdvisorBrandingAsset("logo"); // target = adv_1, asset = adv_other

    expect(mockDel).not.toHaveBeenCalled();
  });

  it("refuses on the REPLACE path too, and the upload still succeeds", async () => {
    mockGetAdvisorProfile.mockResolvedValue({ logoUrl: VICTIM_ASSET, faviconUrl: null });

    const result = await uploadAdvisorBrandingAsset(
      "logo",
      fileFormData("l.png", "image/png", PNG),
    );

    expect(result).toEqual({ ok: true, url: BLOB_URL });
    expect(mockDel).not.toHaveBeenCalled();
  });

  it("refuses a non-blob / unparseable URL rather than throwing", async () => {
    mockGetAdvisorProfile.mockResolvedValue({ logoUrl: "not-a-url-at-all", faviconUrl: null });
    await expect(removeAdvisorBrandingAsset("logo")).resolves.toEqual({ ok: true });
    expect(mockDel).not.toHaveBeenCalled();
  });

  it("refuses a URL whose prefix only PARTIALLY matches the advisor id", async () => {
    // `/firms/org_1/advisors/adv_12/` must not pass a guard written for
    // `adv_1` — the trailing slash is what makes the prefix unambiguous.
    mockGetAdvisorProfile.mockResolvedValue({
      logoUrl: "https://s1.public.blob.vercel-storage.com/firms/org_1/advisors/adv_12/branding/logo-X.png",
      faviconUrl: null,
    });
    await removeAdvisorBrandingAsset("logo");
    expect(mockDel).not.toHaveBeenCalled();
  });

  it("still deletes a legitimately-owned asset (the guard is not a no-op ban)", async () => {
    mockGetAdvisorProfile.mockResolvedValue({ logoUrl: OWN_OLD, faviconUrl: null });
    await removeAdvisorBrandingAsset("logo");
    expect(mockDel).toHaveBeenCalledWith(OWN_OLD);
  });
});

// ── Finding F: ForbiddenError must not escape a "use server" function ──────
describe("a revoked grant surfaces as an error result, not a crash", () => {
  it("upload returns { ok: false } instead of throwing ForbiddenError", async () => {
    // An admin revokes the grant while the advisor has the page open. An
    // uncaught throw here white-screens the whole page via the error
    // boundary — which is exactly why the Blob failure below is caught.
    const { ForbiddenError } = await import("@/lib/authz");
    mockAssertCanEdit.mockRejectedValueOnce(new ForbiddenError("nope"));

    const result = await uploadAdvisorBrandingAsset(
      "logo",
      fileFormData("l.png", "image/png", PNG),
    );

    expect(result.ok).toBe(false);
    expect(mockPutAdvisor).not.toHaveBeenCalled();
    expect(mockUpsertAdvisorProfile).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("remove returns { ok: false } instead of throwing ForbiddenError", async () => {
    const { ForbiddenError } = await import("@/lib/authz");
    mockAssertCanEdit.mockRejectedValueOnce(new ForbiddenError("nope"));

    const result = await removeAdvisorBrandingAsset("logo");

    expect(result.ok).toBe(false);
    expect(mockUpsertAdvisorProfile).not.toHaveBeenCalled();
    expect(mockDel).not.toHaveBeenCalled();
  });

  it("still THROWS on a non-Forbidden gate failure (no blanket swallow)", async () => {
    // A bare `catch` would turn a Clerk outage into a silent "permission
    // denied" toast and hide a real incident.
    mockAssertCanEdit.mockRejectedValueOnce(new Error("clerk unavailable"));
    await expect(
      uploadAdvisorBrandingAsset("logo", fileFormData("l.png", "image/png", PNG)),
    ).rejects.toThrow("clerk unavailable");
  });
});
