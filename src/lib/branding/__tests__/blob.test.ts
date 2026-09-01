// src/lib/branding/__tests__/blob.test.ts
//
// The advisor asset pathname is load-bearing beyond cosmetics: purge and any
// future prefix-listing key off the `firms/<firmId>/` prefix, and dropping
// the advisor segment would make two advisors in one firm overwrite each
// other's slot.

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockPut = vi.fn();
vi.mock("@vercel/blob", () => ({
  put: (...a: unknown[]) => mockPut(...a),
  del: vi.fn(),
}));
vi.mock("@/lib/blob-store", () => ({ publicBlobToken: () => "vercel_blob_rw_TEST" }));

import {
  putAdvisorBrandingAsset,
  putBrandingAsset,
  putSignupBrandingAsset,
} from "../blob";

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

beforeEach(() => {
  mockPut.mockReset();
  mockPut.mockResolvedValue({ url: "https://s1.public.blob.vercel-storage.com/x" });
});

describe("putAdvisorBrandingAsset", () => {
  it("writes under firms/<firmId>/advisors/<advisorUserId>/branding/<kind>", async () => {
    await putAdvisorBrandingAsset({
      firmId: "org_1",
      advisorUserId: "user_abc",
      kind: "logo",
      bytes: PNG,
      contentType: "image/png",
    });

    expect(mockPut).toHaveBeenCalledTimes(1);
    expect(mockPut.mock.calls[0][0]).toBe(
      "firms/org_1/advisors/user_abc/branding/logo",
    );
  });

  it("keeps the firms/<firmId>/ prefix the purge depends on", async () => {
    await putAdvisorBrandingAsset({
      firmId: "org_9",
      advisorUserId: "user_z",
      kind: "favicon",
      bytes: PNG,
      contentType: "image/png",
    });
    expect(mockPut.mock.calls[0][0].startsWith("firms/org_9/")).toBe(true);
  });

  it("does not collide with the FIRM-level path for the same firm+kind", async () => {
    await putBrandingAsset({ firmId: "org_1", kind: "logo", bytes: PNG, contentType: "image/png" });
    await putAdvisorBrandingAsset({
      firmId: "org_1",
      advisorUserId: "user_abc",
      kind: "logo",
      bytes: PNG,
      contentType: "image/png",
    });
    expect(mockPut.mock.calls[0][0]).not.toBe(mockPut.mock.calls[1][0]);
  });

  it("does not collide across advisors in the same firm", async () => {
    for (const advisorUserId of ["user_a", "user_b"]) {
      await putAdvisorBrandingAsset({
        firmId: "org_1",
        advisorUserId,
        kind: "logo",
        bytes: PNG,
        contentType: "image/png",
      });
    }
    expect(mockPut.mock.calls[0][0]).not.toBe(mockPut.mock.calls[1][0]);
  });

  it("uploads publicly with a random suffix and the PUBLIC store token", async () => {
    // access:public is required (PDF renderers / email clients fetch these
    // unauthenticated); the explicit public token is required or the put
    // runs against the private store and throws.
    await putAdvisorBrandingAsset({
      firmId: "org_1",
      advisorUserId: "user_abc",
      kind: "logo",
      bytes: PNG,
      contentType: "image/webp",
    });
    expect(mockPut.mock.calls[0][2]).toEqual(
      expect.objectContaining({
        access: "public",
        addRandomSuffix: true,
        contentType: "image/webp",
        token: "vercel_blob_rw_TEST",
      }),
    );
  });

  it("returns the URL Blob reported, not a constructed one", async () => {
    mockPut.mockResolvedValue({ url: "https://s1.public.blob.vercel-storage.com/real-Ab9.png" });
    const out = await putAdvisorBrandingAsset({
      firmId: "org_1",
      advisorUserId: "user_abc",
      kind: "logo",
      bytes: PNG,
      contentType: "image/png",
    });
    expect(out).toEqual({ url: "https://s1.public.blob.vercel-storage.com/real-Ab9.png" });
  });
});

describe("putSignupBrandingAsset", () => {
  it("keys the path on the Clerk userId, because there is no firm yet", async () => {
    mockPut.mockResolvedValue({ url: "https://blob.example/x.png" });
    const { url } = await putSignupBrandingAsset({
      userId: "user_2abc",
      kind: "logo",
      bytes: Buffer.from([1, 2, 3]),
      contentType: "image/png",
    });
    expect(mockPut).toHaveBeenCalledWith(
      "signups/user_2abc/branding/logo",
      expect.anything(),
      expect.objectContaining({
        access: "public",
        addRandomSuffix: true,
        contentType: "image/png",
      }),
    );
    expect(url).toBe("https://blob.example/x.png");
  });
});
