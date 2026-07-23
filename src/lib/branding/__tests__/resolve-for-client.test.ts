import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdvisorProfileRow } from "@/db/schema";
import { PDF_THEME } from "@/components/pdf/theme";

const mocks = vi.hoisted(() => ({
  getBranding: vi.fn(),
  getAdvisorProfile: vi.fn(),
  getOrganization: vi.fn(),
}));

vi.mock("@/lib/branding/db", () => ({ getBranding: mocks.getBranding }));
vi.mock("@/lib/branding/advisor-profile", () => ({
  getAdvisorProfile: mocks.getAdvisorProfile,
}));
// The firm-only fall-through path (resolveIntakeBranding/resolveBranding) calls
// resolveFirmName, which hits Clerk live. Mock the boundary so name resolution
// is deterministic and no real network call (nor console.warn) ever happens.
vi.mock("@clerk/nextjs/server", () => ({
  clerkClient: vi.fn(async () => ({
    organizations: { getOrganization: mocks.getOrganization },
  })),
}));

import {
  resolveBrandingForClient,
  resolveIntakeBrandingForClient,
} from "../resolve-for-client";

const FIRM = {
  logoUrl: "https://cdn.example/firm.png",
  faviconUrl: "https://cdn.example/firm-fav.png",
  primaryColor: "#0066cc",
  displayName: "Firm Cached",
};

function advisorRow(overrides: Partial<AdvisorProfileRow>): AdvisorProfileRow {
  return {
    id: "adv-row-1",
    firmId: "org_a",
    advisorUserId: "adv_a",
    brandingEnabled: false,
    brandName: null,
    logoUrl: null,
    faviconUrl: null,
    primaryColor: null,
    contactEmail: null,
    contactPhone: null,
    website: null,
    address: null,
    emailFromName: null,
    emailReplyTo: null,
    updatedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
const originalFetch = globalThis.fetch;

function mockLogoFetch() {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    headers: new Headers({ "content-type": "image/png" }),
    arrayBuffer: async () => PNG.buffer,
  }) as unknown as typeof fetch;
}

describe("resolveIntakeBrandingForClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clerk reachable but unnamed by default; falls back to cached display_name.
    mocks.getOrganization.mockResolvedValue({ name: "" });
  });

  it("uses firm branding when advisor branding is disabled", async () => {
    mocks.getBranding.mockResolvedValue(FIRM);
    mocks.getAdvisorProfile.mockResolvedValue(
      advisorRow({ brandingEnabled: false, logoUrl: "adv.png", brandName: "Summit" }),
    );

    const res = await resolveIntakeBrandingForClient("org_a", "adv_a");

    expect(res).toEqual({
      logoUrl: FIRM.logoUrl,
      firmName: FIRM.displayName,
      faviconUrl: FIRM.faviconUrl,
    });
  });

  it("uses firm branding when the advisor has no profile row at all", async () => {
    mocks.getBranding.mockResolvedValue(FIRM);
    mocks.getAdvisorProfile.mockResolvedValue(null);

    const res = await resolveIntakeBrandingForClient("org_a", "adv_a");

    expect(res?.logoUrl).toBe(FIRM.logoUrl);
  });

  it("overlays advisor overrides when branding is enabled", async () => {
    mocks.getBranding.mockResolvedValue(FIRM);
    mocks.getAdvisorProfile.mockResolvedValue(
      advisorRow({
        brandingEnabled: true,
        logoUrl: "https://cdn.example/adv.png",
        brandName: "Summit Advisory",
        faviconUrl: "https://cdn.example/adv-fav.png",
      }),
    );

    const res = await resolveIntakeBrandingForClient("org_a", "adv_a");

    expect(res).toEqual({
      logoUrl: "https://cdn.example/adv.png",
      firmName: "Summit Advisory",
      faviconUrl: "https://cdn.example/adv-fav.png",
    });
    // brandName was set, so the live-Clerk lookup should never be consulted.
    expect(mocks.getOrganization).not.toHaveBeenCalled();
  });

  it("falls back per field: enabled but null overrides keep firm values", async () => {
    mocks.getBranding.mockResolvedValue(FIRM);
    mocks.getAdvisorProfile.mockResolvedValue(
      advisorRow({ brandingEnabled: true, logoUrl: null, brandName: null, faviconUrl: null }),
    );

    const res = await resolveIntakeBrandingForClient("org_a", "adv_a");

    expect(res).toEqual({
      logoUrl: FIRM.logoUrl,
      firmName: FIRM.displayName,
      faviconUrl: FIRM.faviconUrl,
    });
  });

  it("uses the advisor's own logo even when the firm has none", async () => {
    mocks.getBranding.mockResolvedValue({ ...FIRM, logoUrl: null });
    mocks.getAdvisorProfile.mockResolvedValue(
      advisorRow({ brandingEnabled: true, logoUrl: "https://cdn.example/adv.png" }),
    );

    const res = await resolveIntakeBrandingForClient("org_a", "adv_a");

    expect(res?.logoUrl).toBe("https://cdn.example/adv.png");
  });

  it("returns null when neither advisor nor firm has a usable logo", async () => {
    mocks.getBranding.mockResolvedValue({ ...FIRM, logoUrl: null });
    mocks.getAdvisorProfile.mockResolvedValue(
      advisorRow({ brandingEnabled: true, logoUrl: null }),
    );

    expect(await resolveIntakeBrandingForClient("org_a", "adv_a")).toBeNull();
  });

  it("falls through to the live Clerk org name (not the stale cached name) when brandName is unset", async () => {
    mocks.getBranding.mockResolvedValue(FIRM);
    mocks.getAdvisorProfile.mockResolvedValue(
      advisorRow({
        brandingEnabled: true,
        logoUrl: "https://cdn.example/adv.png",
        brandName: null,
      }),
    );
    mocks.getOrganization.mockResolvedValue({ name: "Live Renamed Firm" });

    const res = await resolveIntakeBrandingForClient("org_a", "adv_a");

    expect(res?.firmName).toBe("Live Renamed Firm");
  });
});

describe("resolveBrandingForClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getOrganization.mockResolvedValue({ name: "" });
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("uses firm branding when advisor branding is disabled", async () => {
    mocks.getBranding.mockResolvedValue(FIRM);
    mocks.getAdvisorProfile.mockResolvedValue(
      advisorRow({ brandingEnabled: false, primaryColor: "#ff0000", brandName: "Summit" }),
    );
    mockLogoFetch();

    const res = await resolveBrandingForClient("org_a", "adv_a");

    expect(res.firmName).toBe(FIRM.displayName);
    expect(res.primaryColor).toBe(FIRM.primaryColor);
  });

  it("overlays advisor overrides when branding is enabled", async () => {
    mocks.getBranding.mockResolvedValue(FIRM);
    mocks.getAdvisorProfile.mockResolvedValue(
      advisorRow({
        brandingEnabled: true,
        brandName: "Summit Advisory",
        primaryColor: "#00aa88",
        logoUrl: "https://cdn.example/adv.png",
      }),
    );
    mockLogoFetch();

    const res = await resolveBrandingForClient("org_a", "adv_a");

    expect(res.firmName).toBe("Summit Advisory");
    expect(res.primaryColor).toBe("#00aa88");
    expect(res.logoDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("falls back per field: enabled but null overrides keep firm values", async () => {
    mocks.getBranding.mockResolvedValue(FIRM);
    mocks.getAdvisorProfile.mockResolvedValue(
      advisorRow({ brandingEnabled: true, brandName: null, primaryColor: null, logoUrl: null }),
    );
    mockLogoFetch();

    const res = await resolveBrandingForClient("org_a", "adv_a");

    expect(res.firmName).toBe(FIRM.displayName);
    expect(res.primaryColor).toBe(FIRM.primaryColor);
    // Firm's own logo, loaded via the base resolution.
    expect(res.logoDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("sanitizes an invalid advisor primaryColor to the PDF theme default", async () => {
    mocks.getBranding.mockResolvedValue(FIRM);
    mocks.getAdvisorProfile.mockResolvedValue(
      advisorRow({ brandingEnabled: true, primaryColor: "not-a-color" }),
    );
    mockLogoFetch();

    const res = await resolveBrandingForClient("org_a", "adv_a");

    expect(res.primaryColor).toBe(PDF_THEME.accent);
  });

  it("falls through to the live Clerk org name when brandName is unset", async () => {
    mocks.getBranding.mockResolvedValue(FIRM);
    mocks.getAdvisorProfile.mockResolvedValue(
      advisorRow({ brandingEnabled: true, brandName: null }),
    );
    mocks.getOrganization.mockResolvedValue({ name: "Live Renamed Firm" });
    mockLogoFetch();

    const res = await resolveBrandingForClient("org_a", "adv_a");

    expect(res.firmName).toBe("Live Renamed Firm");
  });
});
