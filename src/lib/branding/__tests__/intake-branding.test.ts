import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getBranding: vi.fn(),
  getOrganization: vi.fn(),
}));

vi.mock("@/lib/branding/db", () => ({ getBranding: mocks.getBranding }));
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    organizations: { getOrganization: mocks.getOrganization },
  })),
}));

describe("resolveIntakeBranding", () => {
  beforeEach(() => {
    mocks.getBranding.mockReset();
    mocks.getOrganization.mockReset();
    mocks.getOrganization.mockResolvedValue({ name: "" });
  });

  it("returns null when the firm row is missing", async () => {
    mocks.getBranding.mockResolvedValue(null);
    const { resolveIntakeBranding } = await import("../branding");
    expect(await resolveIntakeBranding("firm-1")).toBeNull();
  });

  it("returns null (and never calls Clerk) when no logo is set", async () => {
    mocks.getBranding.mockResolvedValue({
      logoUrl: null,
      primaryColor: "#0066cc",
      faviconUrl: "https://cdn.example/fav.png",
      displayName: "Acme Wealth",
    });
    const { resolveIntakeBranding } = await import("../branding");
    expect(await resolveIntakeBranding("firm-1")).toBeNull();
    expect(mocks.getOrganization).not.toHaveBeenCalled();
  });

  it("returns branding with the live Clerk org name when a logo is set", async () => {
    mocks.getBranding.mockResolvedValue({
      logoUrl: "https://cdn.example/logo.png",
      primaryColor: null,
      faviconUrl: "https://cdn.example/fav.png",
      displayName: "Stale Name",
    });
    mocks.getOrganization.mockResolvedValue({ name: "Ethos Financial Group" });
    const { resolveIntakeBranding } = await import("../branding");
    expect(await resolveIntakeBranding("org-1")).toEqual({
      logoUrl: "https://cdn.example/logo.png",
      firmName: "Ethos Financial Group",
      faviconUrl: "https://cdn.example/fav.png",
    });
  });

  it("falls back to cached display_name when Clerk is unreachable", async () => {
    mocks.getBranding.mockResolvedValue({
      logoUrl: "https://cdn.example/logo.png",
      primaryColor: null,
      faviconUrl: null,
      displayName: "Acme Wealth",
    });
    mocks.getOrganization.mockRejectedValue(new Error("clerk down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { resolveIntakeBranding } = await import("../branding");
    const res = await resolveIntakeBranding("org-1");
    expect(res?.firmName).toBe("Acme Wealth");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("falls back to 'Foundry Planning' when no name resolves anywhere", async () => {
    mocks.getBranding.mockResolvedValue({
      logoUrl: "https://cdn.example/logo.png",
      primaryColor: null,
      faviconUrl: null,
      displayName: null,
    });
    const { resolveIntakeBranding } = await import("../branding");
    expect((await resolveIntakeBranding("org-1"))?.firmName).toBe(
      "Foundry Planning",
    );
  });
});
