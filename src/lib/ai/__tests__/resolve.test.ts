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

/** A `connected` row carrying the given key, as getConnection returns it
 *  (already decrypted). */
function connectedRow(apiKey: string) {
  return {
    status: "connected",
    accessToken: JSON.stringify({ apiKey }),
    scope: FIRM_CONFIG,
  };
}

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
    mockGetConnection.mockResolvedValue(connectedRow("firm-key"));

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

  it("THROWS when the connection READ itself fails — a DB or decrypt error is not a fallback", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_unreadable" });
    // getConnection decrypts inside itself: a rotated or unset
    // CREDENTIAL_ENCRYPTION_KEY, or a malformed envelope, rejects here rather
    // than inside the codecs. We cannot tell whether this firm is connected, so
    // reaching for our own key is exactly the wrong move.
    mockGetConnection.mockRejectedValue(new Error("Unrecognized secret envelope"));

    let creds: unknown;
    let err: unknown;
    await resolveAiCredentials().then(
      (c) => {
        creds = c;
      },
      (e) => {
        err = e;
      },
    );

    // No credentials of ANY source reached the caller...
    expect(creds).toBeUndefined();
    // ...and the failure arrived as the sentinel, not the raw crypto message.
    expect((err as Error).message).toBe("ai_firm_connection_unavailable");
    expect((err as Error).cause).toBeInstanceOf(Error);
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
  //
  // Only `source: "firm"` answers are cached. A cached `foundry` answer would
  // keep serving OUR key to a firm that has just connected theirs, from every
  // instance the connect mutation's clear did not reach.

  it("serves a repeat call for a CONNECTED firm from cache, without a second read", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_cache" });
    mockGetConnection.mockResolvedValue(connectedRow("firm-key"));

    const first = await resolveAiCredentials();
    const second = await resolveAiCredentials();

    expect(mockGetConnection).toHaveBeenCalledTimes(1);
    expect(second.apiKey).toBe(first.apiKey);
  });

  it("does NOT cache an unconnected firm — every call re-reads, so connecting takes effect at once", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_notyet" });
    mockGetConnection.mockResolvedValue(null);

    const before = await resolveAiCredentials();
    expect(before.source).toBe("foundry");

    // The firm connects. Another instance never saw the clear — but there is
    // nothing cached to go stale, so the very next call is already theirs.
    mockGetConnection.mockResolvedValue(connectedRow("brand-new-firm-key"));
    const after = await resolveAiCredentials();

    expect(mockGetConnection).toHaveBeenCalledTimes(2);
    expect(after.source).toBe("firm");
    expect(after.apiKey).toBe("brand-new-firm-key");
  });

  it("caches per firm and never hands one firm another firm's credentials", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_a" });
    mockGetConnection.mockResolvedValue(connectedRow("key-a"));
    const a = await resolveAiCredentials();

    mockAuth.mockResolvedValue({ orgId: "org_b" });
    mockGetConnection.mockResolvedValue(connectedRow("key-b"));
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
    mockGetConnection.mockResolvedValue(connectedRow("key-cached"));
    await resolveAiCredentials();

    mockAuth.mockResolvedValue({ orgId: null });
    await expect(resolveAiCredentials()).rejects.toThrow("ai_no_firm_context");
  });

  it("does not cache a failure — a repaired connection resolves on the next call", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_repair" });
    mockGetConnection.mockResolvedValue({
      status: "error",
      accessToken: JSON.stringify({ apiKey: "firm-key" }),
      scope: FIRM_CONFIG,
    });
    await expect(resolveAiCredentials()).rejects.toThrow("ai_firm_connection_unavailable");

    mockGetConnection.mockResolvedValue(connectedRow("firm-key"));
    const creds = await resolveAiCredentials();
    expect(creds.source).toBe("firm");
    expect(creds.apiKey).toBe("firm-key");
  });

  it("re-reads after the cache is cleared for that firm", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_clear" });
    mockGetConnection.mockResolvedValue(connectedRow("key-before"));

    await resolveAiCredentials();
    clearAiCredentialCache("org_clear");
    mockGetConnection.mockResolvedValue(connectedRow("key-after"));
    const after = await resolveAiCredentials();

    expect(mockGetConnection).toHaveBeenCalledTimes(2);
    expect(after.apiKey).toBe("key-after");
  });

  it("clearing one firm leaves another firm's cache entry alone", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_keep" });
    mockGetConnection.mockResolvedValue(connectedRow("key-keep"));
    await resolveAiCredentials();

    clearAiCredentialCache("org_other");
    await resolveAiCredentials();

    expect(mockGetConnection).toHaveBeenCalledTimes(1);
  });

  it("clearing with an EMPTY firm id is a no-op, not a clear-all", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_intact" });
    mockGetConnection.mockResolvedValue(connectedRow("key-intact"));
    await resolveAiCredentials();

    // A caller that failed to populate its firm id must not wipe every firm.
    clearAiCredentialCache("");
    await resolveAiCredentials();

    expect(mockGetConnection).toHaveBeenCalledTimes(1);
  });

  it("hands back frozen credentials, so a caller cannot corrupt the cached entry", async () => {
    mockAuth.mockResolvedValue({ orgId: "org_frozen" });
    mockGetConnection.mockResolvedValue(connectedRow("key-frozen"));

    const creds = await resolveAiCredentials();
    expect(() => {
      creds.apiKey = "tampered";
    }).toThrow();
    expect(() => {
      creds.deployments.chat = "tampered";
    }).toThrow();

    const again = await resolveAiCredentials();
    expect(again.apiKey).toBe("key-frozen");
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

  it("falls back to the default api version when the env var is EMPTY, not just unset", () => {
    // An empty string is unguarded below, so `??` would let "" through and build
    // a client that 400s on every call.
    vi.stubEnv("AZURE_API_VERSION", "");
    expect(foundrySystemCredentials().apiVersion).toBe("2024-12-01-preview");
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
