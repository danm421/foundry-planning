import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PDF_THEME } from "@/components/pdf/theme";

const mocks = vi.hoisted(() => ({
  getBranding: vi.fn(),
  getFirmDisplayName: vi.fn(),
}));

vi.mock("@/lib/branding/db", () => ({ getBranding: mocks.getBranding }));
vi.mock("../firm-name", () => ({ getFirmDisplayName: mocks.getFirmDisplayName }));

const originalFetch = globalThis.fetch;

describe("resolveBranding", () => {
  beforeEach(() => {
    mocks.getBranding.mockReset();
    mocks.getFirmDisplayName.mockReset();
    mocks.getFirmDisplayName.mockResolvedValue("Acme Wealth");
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns resolved branding when all fields present", async () => {
    mocks.getBranding.mockResolvedValue({
      logoUrl: "https://cdn.example/logo.png",
      primaryColor: "#0066cc",
      faviconUrl: null,
    });
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => png.buffer,
    }) as unknown as typeof fetch;

    const { resolveBranding } = await import("../branding");
    const res = await resolveBranding("firm-1");

    expect(res.primaryColor).toBe("#0066cc");
    expect(res.firmName).toBe("Acme Wealth");
    expect(res.logoDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("falls back to PDF_THEME.accent on invalid primaryColor", async () => {
    mocks.getBranding.mockResolvedValue({
      logoUrl: null,
      primaryColor: "not-a-color",
      faviconUrl: null,
    });
    const { resolveBranding } = await import("../branding");
    const res = await resolveBranding("firm-1");
    expect(res.primaryColor).toBe(PDF_THEME.accent);
    expect(res.logoDataUrl).toBeNull();
  });

  it("downgrades to null logo when fetch fails", async () => {
    mocks.getBranding.mockResolvedValue({
      logoUrl: "https://cdn.example/logo.png",
      primaryColor: "#0066cc",
      faviconUrl: null,
    });
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("boom")) as unknown as typeof fetch;
    const { resolveBranding } = await import("../branding");
    const res = await resolveBranding("firm-1");
    expect(res.logoDataUrl).toBeNull();
    expect(res.firmName).toBe("Acme Wealth");
  });

  it("downgrades to null logo when payload exceeds 1MB", async () => {
    mocks.getBranding.mockResolvedValue({
      logoUrl: "https://cdn.example/logo.png",
      primaryColor: "#0066cc",
      faviconUrl: null,
    });
    const huge = new Uint8Array(1_100_000);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => huge.buffer,
    }) as unknown as typeof fetch;
    const { resolveBranding } = await import("../branding");
    const res = await resolveBranding("firm-1");
    expect(res.logoDataUrl).toBeNull();
  });

  it("returns defaults when getBranding returns null", async () => {
    mocks.getBranding.mockResolvedValue(null);
    const { resolveBranding } = await import("../branding");
    const res = await resolveBranding("firm-1");
    expect(res.primaryColor).toBe(PDF_THEME.accent);
    expect(res.firmName).toBe("Acme Wealth");
    expect(res.logoDataUrl).toBeNull();
  });
});
