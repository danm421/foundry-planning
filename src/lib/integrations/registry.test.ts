import { afterEach, describe, expect, it, vi } from "vitest";
import { getProvider, isProviderId, listProviders } from "./registry";

describe("provider registry", () => {
  it("resolves orion", () => {
    expect(getProvider("orion").id).toBe("orion");
    expect(getProvider("orion").label).toBe("Orion Advisor Tech");
  });

  it("resolves schwab", () => {
    expect(getProvider("schwab").id).toBe("schwab");
    expect(getProvider("schwab").label).toBe("Schwab Advisor Services");
  });

  it("narrows valid ids and rejects unknown ones", () => {
    expect(isProviderId("orion")).toBe(true);
    expect(isProviderId("addepar")).toBe(true);
    expect(isProviderId("")).toBe(false);
  });

  it("lists every registered provider", () => {
    expect(listProviders().map((p) => p.id).sort()).toEqual([
      "addepar",
      "azure_openai",
      "orion",
      "schwab",
    ]);
  });
});

describe("provider registry auth kinds", () => {
  it("orion and schwab are oauth providers with an oauth impl", () => {
    for (const id of ["orion", "schwab"] as const) {
      const p = getProvider(id);
      expect(p.authKind).toBe("oauth");
      expect(p.oauth).toBeDefined();
      if (!p.syncs) throw new Error(`expected ${id} to sync`);
      expect(p.autoCommitExact).toBe(true);
    }
  });

  it("every registered provider declares an authKind", () => {
    for (const p of listProviders()) {
      expect(["oauth", "byok"]).toContain(p.authKind);
    }
  });

  it("addepar is a byok provider, flag-gated, no oauth, review-before-commit", () => {
    const p = getProvider("addepar");
    expect(p.authKind).toBe("byok");
    expect(p.oauth).toBeUndefined();
    if (!p.syncs) throw new Error("expected addepar to sync");
    expect(p.autoCommitExact).toBe(false);
    const prev = process.env.ADDEPAR_ENABLED;
    process.env.ADDEPAR_ENABLED = "true";
    expect(p.isEnabled()).toBe(true);
    process.env.ADDEPAR_ENABLED = "false";
    expect(p.isEnabled()).toBe(false);
    process.env.ADDEPAR_ENABLED = prev;
  });
});

describe("azure_openai provider", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is a recognized provider id", () => {
    expect(isProviderId("azure_openai")).toBe(true);
  });

  it("is byok, firm-scoped, and does not sync accounts", () => {
    const p = getProvider("azure_openai");
    expect(p.authKind).toBe("byok");
    expect(p.scope).toBe("firm");
    expect(p.syncs).toBe(false);
  });

  it("is disabled unless AZURE_BYOK_ENABLED is exactly 'true'", () => {
    vi.stubEnv("AZURE_BYOK_ENABLED", "");
    expect(getProvider("azure_openai").isEnabled()).toBe(false);
    vi.stubEnv("AZURE_BYOK_ENABLED", "1");
    expect(getProvider("azure_openai").isEnabled()).toBe(false);
    vi.stubEnv("AZURE_BYOK_ENABLED", "true");
    expect(getProvider("azure_openai").isEnabled()).toBe(true);
  });

  it("is listed alongside the syncing providers", () => {
    expect(listProviders().map((p) => p.id)).toContain("azure_openai");
  });
});
