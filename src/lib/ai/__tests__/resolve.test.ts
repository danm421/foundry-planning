import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockAuth = vi.fn();
const mockGetConnection = vi.fn();

vi.mock("@clerk/nextjs/server", () => ({ auth: () => mockAuth() }));
vi.mock("@/lib/integrations/connections", () => ({
  getConnection: (...a: unknown[]) => mockGetConnection(...a),
}));

import {
  resolveAiCredentials,
  foundrySystemCredentials,
  clearAiCredentialCache,
} from "../resolve";

const FIRM_CONFIG = JSON.stringify({
  endpoint: "https://acme-ria.openai.azure.com",
  apiVersion: "2030-01-01",
  chatDeployment: "firm-chat",
  miniDeployment: "firm-mini",
  embeddingDeployment: "firm-embed",
});

function stubFoundryEnv() {
  vi.stubEnv("AZURE_ENDPOINT", "https://foundry.openai.azure.com");
  vi.stubEnv("AZURE_API_KEY", "foundry-key");
  vi.stubEnv("AZURE_API_VERSION", "2024-12-01-preview");
  vi.stubEnv("AZURE_ANALYSIS_MODEL", "gpt-5.4");
  vi.stubEnv("AZURE_MODEL", "gpt-5.4-mini");
  vi.stubEnv("AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT", "text-embedding-3-small");
}

beforeEach(() => {
  clearAiCredentialCache();
  mockAuth.mockReset();
  mockGetConnection.mockReset();
  stubFoundryEnv();
});

afterEach(() => vi.unstubAllEnvs());

describe("resolveAiCredentials", () => {
  it("returns the FIRM's endpoint, key and deployments when connected", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_acme" });
    mockGetConnection.mockResolvedValue({
      status: "connected",
      accessToken: JSON.stringify({ apiKey: "firm-key" }),
      scope: FIRM_CONFIG,
    });

    const creds = await resolveAiCredentials();

    expect(creds.source).toBe("firm");
    expect(creds.endpoint).toBe("https://acme-ria.openai.azure.com");
    expect(creds.apiKey).toBe("firm-key");
    expect(creds.apiVersion).toBe("2030-01-01");
    expect(creds.deployments).toEqual({
      chat: "firm-chat",
      mini: "firm-mini",
      embedding: "firm-embed",
    });
    // The whole point: Foundry Planning's own values must not leak through.
    expect(creds.apiKey).not.toBe("foundry-key");
    expect(creds.endpoint).not.toContain("foundry");
  });

  it("reads the connection for THIS firm and the azure_openai provider", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_acme" });
    mockGetConnection.mockResolvedValue(null);

    await resolveAiCredentials();

    expect(mockGetConnection).toHaveBeenCalledWith("org_acme", "azure_openai");
  });

  it("returns FOUNDRY's credentials when the firm has no connection", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_plain" });
    mockGetConnection.mockResolvedValue(null);

    const creds = await resolveAiCredentials();

    expect(creds.source).toBe("foundry");
    expect(creds.apiKey).toBe("foundry-key");
    expect(creds.deployments.chat).toBe("gpt-5.4");
    expect(creds.deployments.mini).toBe("gpt-5.4-mini");
  });

  it("returns FOUNDRY's credentials when a connection exists but is disconnected", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_off" });
    mockGetConnection.mockResolvedValue({
      status: "disconnected",
      accessToken: null,
      scope: null,
    });

    const creds = await resolveAiCredentials();
    expect(creds.source).toBe("foundry");
  });

  // ---- The load-bearing tests. These are the compliance promise. ----

  it("THROWS when there is no org context, and never returns Foundry's key", async () => {
    mockAuth.mockResolvedValue({ orgId: null });

    await expect(resolveAiCredentials()).rejects.toThrow("ai_no_firm_context");
    expect(mockGetConnection).not.toHaveBeenCalled();
  });

  it("THROWS when the firm's connection is in error — no fallback to Foundry", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_broken" });
    mockGetConnection.mockResolvedValue({
      status: "error",
      accessToken: JSON.stringify({ apiKey: "firm-key" }),
      scope: FIRM_CONFIG,
    });

    await expect(resolveAiCredentials()).rejects.toThrow("ai_firm_connection_unavailable");
  });

  it("THROWS rather than falling back when a connected row has an unreadable config", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_corrupt" });
    mockGetConnection.mockResolvedValue({
      status: "connected",
      accessToken: JSON.stringify({ apiKey: "firm-key" }),
      scope: "{{not json",
    });

    // The exact sentinel, not a bare toThrow(): a raw ZodError escaping here
    // would still satisfy `.rejects.toThrow()` while breaking the closed set of
    // error strings every caller branches on.
    await expect(resolveAiCredentials()).rejects.toThrow("ai_firm_connection_unavailable");
  });

  it("THROWS rather than falling back when a connected row has no stored secret", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_nokey" });
    mockGetConnection.mockResolvedValue({
      status: "connected",
      accessToken: null,
      scope: FIRM_CONFIG,
    });

    await expect(resolveAiCredentials()).rejects.toThrow("ai_firm_connection_unavailable");
  });

  it("keeps the firm's key out of the thrown error when the secret blob is corrupt", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_badsecret" });
    mockGetConnection.mockResolvedValue({
      status: "connected",
      // A legacy raw key rather than the JSON blob: JSON.parse would embed its
      // first bytes in the SyntaxError message.
      accessToken: "sk-super-secret-firm-key-bytes",
      scope: FIRM_CONFIG,
    });

    let err: unknown;
    await resolveAiCredentials().catch((e) => {
      err = e;
    });
    expect((err as Error).message).toBe("ai_firm_connection_unavailable");
    expect((err as Error).message).not.toContain("sk-super-secret");
  });

  // ---- Cache behaviour ----

  it("caches per firm and never hands one firm another firm's credentials", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_a" });
    mockGetConnection.mockResolvedValue({
      status: "connected",
      accessToken: JSON.stringify({ apiKey: "key-a" }),
      scope: FIRM_CONFIG,
    });
    const a = await resolveAiCredentials();

    mockAuth.mockResolvedValue({ orgId: "org_b" });
    mockGetConnection.mockResolvedValue({
      status: "connected",
      accessToken: JSON.stringify({ apiKey: "key-b" }),
      scope: FIRM_CONFIG,
    });
    const b = await resolveAiCredentials();

    expect(a.apiKey).toBe("key-a");
    expect(b.apiKey).toBe("key-b");

    // And back: firm A's own slot survives firm B's resolve. A single-slot cache
    // (or one keyed by anything other than the firm) hands A the key-b row the
    // mock is still returning.
    mockAuth.mockResolvedValue({ orgId: "org_a" });
    const aAgain = await resolveAiCredentials();
    expect(aAgain.apiKey).toBe("key-a");
  });

  it("cannot serve a cached firm entry to a caller with no org context", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_cached" });
    mockGetConnection.mockResolvedValue({
      status: "connected",
      accessToken: JSON.stringify({ apiKey: "key-cached" }),
      scope: FIRM_CONFIG,
    });
    await resolveAiCredentials();

    mockAuth.mockResolvedValue({ orgId: null });
    await expect(resolveAiCredentials()).rejects.toThrow("ai_no_firm_context");
  });

  it("serves a repeat call from cache without a second connection read", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_cache" });
    mockGetConnection.mockResolvedValue(null);

    await resolveAiCredentials();
    await resolveAiCredentials();

    expect(mockGetConnection).toHaveBeenCalledTimes(1);
  });

  it("does not cache a failure — a repaired connection resolves on the next call", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_repair" });
    mockGetConnection.mockResolvedValue({
      status: "error",
      accessToken: JSON.stringify({ apiKey: "firm-key" }),
      scope: FIRM_CONFIG,
    });
    await expect(resolveAiCredentials()).rejects.toThrow("ai_firm_connection_unavailable");

    mockGetConnection.mockResolvedValue({
      status: "connected",
      accessToken: JSON.stringify({ apiKey: "firm-key" }),
      scope: FIRM_CONFIG,
    });
    const creds = await resolveAiCredentials();
    expect(creds.source).toBe("firm");
    expect(creds.apiKey).toBe("firm-key");
  });

  it("re-reads after the cache is cleared for that firm", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_clear" });
    mockGetConnection.mockResolvedValue(null);

    await resolveAiCredentials();
    clearAiCredentialCache("org_clear");
    await resolveAiCredentials();

    expect(mockGetConnection).toHaveBeenCalledTimes(2);
  });

  it("clearing one firm leaves another firm's cache entry alone", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_keep" });
    mockGetConnection.mockResolvedValue(null);
    await resolveAiCredentials();

    clearAiCredentialCache("org_other");
    await resolveAiCredentials();

    expect(mockGetConnection).toHaveBeenCalledTimes(1);
  });
});

describe("foundrySystemCredentials", () => {
  it("reads Foundry Planning's own env and is labelled as such", () => {
    const creds = foundrySystemCredentials();
    expect(creds.source).toBe("foundry");
    expect(creds.apiKey).toBe("foundry-key");
  });

  it("throws when Foundry Planning's own key is unset", () => {
    vi.stubEnv("AZURE_API_KEY", "");
    expect(() => foundrySystemCredentials()).toThrow("ai_not_configured");
  });

  it("throws when the endpoint or a chat deployment is unset", () => {
    vi.stubEnv("AZURE_ENDPOINT", "");
    expect(() => foundrySystemCredentials()).toThrow("ai_not_configured");
    stubFoundryEnv();
    vi.stubEnv("AZURE_ANALYSIS_MODEL", "");
    expect(() => foundrySystemCredentials()).toThrow("ai_not_configured");
    stubFoundryEnv();
    vi.stubEnv("AZURE_MODEL", "");
    expect(() => foundrySystemCredentials()).toThrow("ai_not_configured");
  });

  it("allows an empty embedding deployment — the embedding path fails closed on its own", () => {
    vi.stubEnv("AZURE_OPENAI_EMBEDDINGS_DEPLOYMENT", "");
    const creds = foundrySystemCredentials();
    expect(creds.deployments.embedding).toBe("");
    expect(creds.deployments.chat).toBe("gpt-5.4");
  });

  it("propagates ai_not_configured rather than resolving a firm with no connection", async () => {
    vi.stubEnv("AZURE_API_KEY", "");
    mockAuth.mockResolvedValue({ orgId: "org_unconfigured" });
    mockGetConnection.mockResolvedValue(null);

    await expect(resolveAiCredentials()).rejects.toThrow("ai_not_configured");
  });
});
