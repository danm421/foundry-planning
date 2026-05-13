import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.fn();
const mockPut = vi.fn();
const mockDel = vi.fn();
const mockSetLogo = vi.fn();
const mockSetFavicon = vi.fn();
const mockSetColor = vi.fn();
const mockGetBranding = vi.fn();
const mockRecordAudit = vi.fn();
const mockRevalidatePath = vi.fn();
const mockRequireAdminOrOwner = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({
  auth: () => mockAuth(),
}));
vi.mock("@/lib/branding/blob", () => ({
  putBrandingAsset: (...a: unknown[]) => mockPut(...a),
  deleteBrandingAsset: (...a: unknown[]) => mockDel(...a),
}));
vi.mock("@/lib/branding/db", () => ({
  getBranding: (...a: unknown[]) => mockGetBranding(...a),
  setLogoUrl: (...a: unknown[]) => mockSetLogo(...a),
  setFaviconUrl: (...a: unknown[]) => mockSetFavicon(...a),
  setPrimaryColor: (...a: unknown[]) => mockSetColor(...a),
}));
vi.mock("@/lib/audit", () => ({
  recordAudit: (...a: unknown[]) => mockRecordAudit(...a),
}));
vi.mock("next/cache", () => ({
  revalidatePath: (...a: unknown[]) => mockRevalidatePath(...a),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAdminOrOwner: () => mockRequireAdminOrOwner(),
  ForbiddenError: class ForbiddenError extends Error {},
}));

import {
  uploadBrandingAsset,
  removeBrandingAsset,
  setPrimaryColorAction,
} from "../actions";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

function fileFormData(name: string, mime: string, body: Buffer): FormData {
  const fd = new FormData();
  fd.set("file", new File([new Uint8Array(body)], name, { type: mime }));
  return fd;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuth.mockResolvedValue({ orgId: "org_1" });
  mockRequireAdminOrOwner.mockResolvedValue(undefined);
  mockGetBranding.mockResolvedValue({ logoUrl: null, faviconUrl: null, primaryColor: null });
  mockPut.mockResolvedValue({ url: "https://blob/x" });
});

describe("uploadBrandingAsset", () => {
  it("rejects non-admin callers", async () => {
    const { ForbiddenError } = await import("@/lib/authz");
    mockRequireAdminOrOwner.mockRejectedValueOnce(new ForbiddenError("nope"));
    await expect(
      uploadBrandingAsset("logo", fileFormData("logo.png", "image/png", PNG)),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("uploads a valid logo, writes db, audits, revalidates", async () => {
    const result = await uploadBrandingAsset("logo", fileFormData("logo.png", "image/png", PNG));
    expect(result).toEqual({ ok: true, url: "https://blob/x" });
    expect(mockPut).toHaveBeenCalledWith(
      expect.objectContaining({ firmId: "org_1", kind: "logo", contentType: "image/png" }),
    );
    expect(mockSetLogo).toHaveBeenCalledWith("org_1", "https://blob/x");
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "firm.branding_logo_changed",
        firmId: "org_1",
        metadata: expect.objectContaining({ after: "https://blob/x" }),
      }),
    );
    expect(mockRevalidatePath).toHaveBeenCalled();
  });

  it("deletes the old blob when replacing", async () => {
    mockGetBranding.mockResolvedValueOnce({
      logoUrl: "https://blob/old",
      faviconUrl: null,
      primaryColor: null,
    });
    await uploadBrandingAsset("logo", fileFormData("logo.png", "image/png", PNG));
    expect(mockDel).toHaveBeenCalledWith("https://blob/old");
  });

  it("does not roll back the DB write if old-blob delete fails", async () => {
    mockGetBranding.mockResolvedValueOnce({
      logoUrl: "https://blob/old",
      faviconUrl: null,
      primaryColor: null,
    });
    mockDel.mockRejectedValueOnce(new Error("blob down"));
    const result = await uploadBrandingAsset("logo", fileFormData("logo.png", "image/png", PNG));
    expect(result.ok).toBe(true);
    expect(mockSetLogo).toHaveBeenCalled();
  });

  it("rejects mismatched MIME / magic bytes", async () => {
    const result = await uploadBrandingAsset(
      "logo",
      fileFormData("fake.png", "image/png", Buffer.from("not a real png")),
    );
    expect(result.ok).toBe(false);
    expect(mockPut).not.toHaveBeenCalled();
  });

  it("rejects oversized files", async () => {
    const big = Buffer.concat([PNG, Buffer.alloc(2 * 1024 * 1024 + 1)]);
    const result = await uploadBrandingAsset("logo", fileFormData("big.png", "image/png", big));
    expect(result.ok).toBe(false);
    expect(mockPut).not.toHaveBeenCalled();
  });
});

describe("removeBrandingAsset", () => {
  it("rejects non-admin callers", async () => {
    const { ForbiddenError } = await import("@/lib/authz");
    mockRequireAdminOrOwner.mockRejectedValueOnce(new ForbiddenError("nope"));
    await expect(removeBrandingAsset("logo")).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockSetLogo).not.toHaveBeenCalled();
    expect(mockDel).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("clears db column and deletes blob", async () => {
    mockGetBranding.mockResolvedValueOnce({
      logoUrl: "https://blob/old",
      faviconUrl: null,
      primaryColor: null,
    });
    const result = await removeBrandingAsset("logo");
    expect(result).toEqual({ ok: true });
    expect(mockSetLogo).toHaveBeenCalledWith("org_1", null);
    expect(mockDel).toHaveBeenCalledWith("https://blob/old");
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "firm.branding_logo_changed" }),
    );
  });

  it("noops when there's nothing to remove", async () => {
    const result = await removeBrandingAsset("logo");
    expect(result).toEqual({ ok: true, noop: true });
    expect(mockSetLogo).not.toHaveBeenCalled();
    expect(mockDel).not.toHaveBeenCalled();
  });
});

describe("setPrimaryColorAction", () => {
  it("rejects non-admin callers", async () => {
    const { ForbiddenError } = await import("@/lib/authz");
    mockRequireAdminOrOwner.mockRejectedValueOnce(new ForbiddenError("nope"));
    await expect(setPrimaryColorAction("#0a2bff")).rejects.toBeInstanceOf(ForbiddenError);
    expect(mockSetColor).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("normalizes and writes valid hex", async () => {
    const result = await setPrimaryColorAction("#0A2BFF");
    expect(result).toEqual({ ok: true });
    expect(mockSetColor).toHaveBeenCalledWith("org_1", "#0a2bff");
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "firm.branding_color_changed" }),
    );
  });

  it("clears with null", async () => {
    const result = await setPrimaryColorAction(null);
    expect(result).toEqual({ ok: true });
    expect(mockSetColor).toHaveBeenCalledWith("org_1", null);
  });

  it("rejects invalid hex", async () => {
    const result = await setPrimaryColorAction("not a color");
    expect(result.ok).toBe(false);
    expect(mockSetColor).not.toHaveBeenCalled();
  });
});
