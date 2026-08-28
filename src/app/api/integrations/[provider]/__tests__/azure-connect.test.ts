import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { decodeAzureSecret, decodeAzureConfig } from "@/lib/ai/credentials";

const mockVerify = vi.fn();
const mockUpsert = vi.fn();
const mockDisconnect = vi.fn();
const mockAudit = vi.fn();
const mockClearCache = vi.fn();
const mockGetConnection = vi.fn();
const mockSetStatus = vi.fn();

// This mock list is the routes' REAL import graph, not a guess — read from
// the top of connect/route.ts, test/route.ts and disconnect/route.ts before
// writing this file. Two modules are deliberately left UNMOCKED even though
// the routes import them:
//   - "@/lib/integrations/registry" / "../_provider" — the real registry is
//     what proves azure_openai resolves as byok behind AZURE_BYOK_ENABLED;
//     mocking it would make every test here vacuous about the wiring itself.
//   - "@/lib/integrations/errors" — ProviderNotConfigured is used in an
//     `instanceof` check in connect's GET; a mocked class breaks that check.
// "@/lib/ai/credentials" is ALSO left unmocked (decodeAzureSecret/
// decodeAzureConfig above are the real codecs) so the success-path tests can
// decode what the route actually persisted, rather than trusting call counts.
vi.mock("@clerk/nextjs/server", () => ({
  auth: async () => ({ orgId: "org_acme", userId: "user_1" }),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAdminOrOwner: async () => {},
  authErrorResponse: () => null,
}));
vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationOauthLimit: async () => ({ allowed: true }),
  rateLimitErrorResponse: () => new Response("rate limited", { status: 429 }),
}));
vi.mock("@/lib/ai/verify-connection", () => ({ verifyAzureConnection: (...a: unknown[]) => mockVerify(...a) }));
vi.mock("@/lib/integrations/connections", () => ({
  upsertByokConnection: (...a: unknown[]) => mockUpsert(...a),
  disconnectConnection: (...a: unknown[]) => mockDisconnect(...a),
  createOauthState: async () => {},
  // recheck's two: it reads the stored row and writes the outcome back.
  getConnection: (...a: unknown[]) => mockGetConnection(...a),
  setConnectionStatus: (...a: unknown[]) => mockSetStatus(...a),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => mockAudit(...a) }));
vi.mock("@/lib/ai/resolve", () => ({ clearAiCredentialCache: (...a: unknown[]) => mockClearCache(...a) }));

import { POST as connectPost } from "../connect/route";
import { POST as testPost } from "../test/route";
import { POST as disconnectPost } from "../disconnect/route";
import { POST as recheckPost } from "../recheck/route";

const params = Promise.resolve({ provider: "azure_openai" });

const VALID = {
  endpoint: "https://acme-ria.openai.azure.com",
  apiKey: "firm-key",
  apiVersion: "2024-12-01-preview",
  chatDeployment: "gpt-5.4",
  miniDeployment: "gpt-5.4-mini",
  embeddingDeployment: "text-embedding-3-small",
};

function req(body: unknown): Request {
  return new Request("https://x/api/integrations/azure_openai/connect", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.stubEnv("AZURE_BYOK_ENABLED", "true");
  mockVerify.mockReset();
  mockUpsert.mockReset();
  mockDisconnect.mockReset();
  mockAudit.mockReset();
  mockClearCache.mockReset();
  mockGetConnection.mockReset();
  mockSetStatus.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST connect (azure_openai)", () => {
  it("persists nothing when verification fails", async () => {
    mockVerify.mockResolvedValue({
      ok: false,
      checks: [{ name: "embedding", ok: false, detail: "different model" }],
    });

    const res = await connectPost(req({ ...VALID, attestation: true }), { params });

    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("reports which check failed — embedding", async () => {
    mockVerify.mockResolvedValue({
      ok: false,
      checks: [
        { name: "chat", ok: true },
        { name: "mini", ok: true },
        { name: "embedding", ok: false, detail: "different model from the planning library" },
      ],
    });

    const res = await connectPost(req({ ...VALID, attestation: true }), { params });
    const body = await res.json();

    expect(body.checks.find((c: { name: string }) => c.name === "embedding").ok).toBe(false);
    expect(body.error).toBe("Embedding model: different model from the planning library");
  });

  it("reports which check failed — chat, labelled 'Main model'", async () => {
    // firstFailureMessage's chat/mini branches are otherwise unexercised: the
    // test above only ever hits the ternary's embedding fallback, so a swap
    // of "Main model" and "Fast model" would survive unnoticed.
    mockVerify.mockResolvedValue({
      ok: false,
      checks: [
        { name: "chat", ok: false, detail: "DeploymentNotFound" },
        { name: "mini", ok: true },
        { name: "embedding", ok: true },
      ],
    });

    const res = await connectPost(req({ ...VALID, attestation: true }), { params });
    const body = await res.json();

    expect(body.error).toBe("Main model: DeploymentNotFound");
  });

  it("reports which check failed — mini, labelled 'Fast model'", async () => {
    mockVerify.mockResolvedValue({
      ok: false,
      checks: [
        { name: "chat", ok: true },
        { name: "mini", ok: false, detail: "DeploymentNotFound" },
        { name: "embedding", ok: true },
      ],
    });

    const res = await connectPost(req({ ...VALID, attestation: true }), { params });
    const body = await res.json();

    expect(body.error).toBe("Fast model: DeploymentNotFound");
  });

  it("stores, audits and clears the cache when all checks pass", async () => {
    mockVerify.mockResolvedValue({ ok: true, checks: [] });

    const res = await connectPost(req({ ...VALID, attestation: true }), { params });

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockClearCache).toHaveBeenCalledWith("org_acme");

    // Decode what was actually handed to upsertByokConnection, rather than
    // trusting the call count — a wrong-field swap or a wrong-owner write
    // would still leave these counts at exactly 1.
    const arg = mockUpsert.mock.calls[0][0];
    expect(arg).toMatchObject({ firmId: "org_acme", providerId: "azure_openai", userId: "user_1" });
    expect(decodeAzureSecret(arg.secretBlob)).toEqual({ apiKey: VALID.apiKey });
    expect(decodeAzureConfig(arg.configBlob)).toEqual({
      endpoint: VALID.endpoint,
      apiVersion: VALID.apiVersion,
      chatDeployment: VALID.chatDeployment,
      miniDeployment: VALID.miniDeployment,
      embeddingDeployment: VALID.embeddingDeployment,
    });

    // Exact (not objectContaining) on `metadata`: a leaked apiKey field
    // would add a key and fail this match.
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        firmId: "org_acme",
        metadata: { provider: "azure_openai", endpoint: VALID.endpoint },
      }),
    );
  });

  it("rejects a non-Azure endpoint before any network call", async () => {
    const res = await connectPost(
      req({ ...VALID, endpoint: "https://evil.example.com", attestation: true }),
      { params },
    );
    expect(res.status).toBe(400);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("requires the attestation", async () => {
    const res = await connectPost(req(VALID), { params });
    expect(res.status).toBe(400);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("never echoes the api key back", async () => {
    mockVerify.mockResolvedValue({ ok: true, checks: [] });
    const res = await connectPost(req({ ...VALID, attestation: true }), { params });
    expect(JSON.stringify(await res.json())).not.toContain("firm-key");
  });
});

describe("POST test (azure_openai)", () => {
  it("stores nothing on success", async () => {
    mockVerify.mockResolvedValue({ ok: true, checks: [] });

    const res = await testPost(req(VALID), { params });

    expect(res.status).toBe(200);
    expect(mockUpsert).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("returns each check so the admin sees which deployment is wrong", async () => {
    mockVerify.mockResolvedValue({
      ok: false,
      checks: [
        { name: "chat", ok: true },
        { name: "mini", ok: false, detail: "DeploymentNotFound" },
        { name: "embedding", ok: true },
      ],
    });

    const res = await testPost(req(VALID), { params });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.checks).toHaveLength(3);
  });
});

describe("POST disconnect", () => {
  it("clears the AI credential cache when disconnecting azure_openai", async () => {
    const res = await disconnectPost(req({}), { params });

    expect(res.status).toBe(200);
    expect(mockClearCache).toHaveBeenCalledWith("org_acme");
  });

  it("clears the cache only AFTER disconnectConnection has actually run", async () => {
    // A comment alone doesn't guard against a reordering: if the cache clear
    // ran first, a concurrent request could re-cache the very credentials
    // about to be revoked, and a disconnected firm would keep working for
    // the resolver's TTL. invocationCallOrder pins the sequence, not just
    // that both were called.
    await disconnectPost(req({}), { params });

    expect(mockDisconnect).toHaveBeenCalledTimes(1);
    expect(mockClearCache).toHaveBeenCalledTimes(1);
    expect(mockDisconnect.mock.invocationCallOrder[0]).toBeLessThan(
      mockClearCache.mock.invocationCallOrder[0],
    );
  });

  it("does not clear the cache when disconnecting a non-azure provider", async () => {
    // addepar's own kill-switch, so resolveProvider doesn't return null.
    vi.stubEnv("ADDEPAR_ENABLED", "true");
    const addeparParams = Promise.resolve({ provider: "addepar" });

    const res = await disconnectPost(req({}), { params: addeparParams });

    expect(res.status).toBe(200);
    expect(mockClearCache).not.toHaveBeenCalled();
  });
});

/**
 * Recheck re-verifies what is ALREADY STORED, so unlike connect and test it
 * takes no body — everything it needs comes off the connection row. It is also
 * the only path that can clear an `error` badge, and the only way a Forge-side
 * auth failure is ever reflected at all.
 *
 * `@/lib/ai/credentials` is real here (see the header note), so the encoded
 * blobs below are what the route genuinely has to decode.
 */
describe("POST recheck (azure_openai)", () => {
  const STORED_CONFIG = JSON.stringify({
    endpoint: VALID.endpoint,
    apiVersion: VALID.apiVersion,
    chatDeployment: VALID.chatDeployment,
    miniDeployment: VALID.miniDeployment,
    embeddingDeployment: VALID.embeddingDeployment,
  });

  function connectedRow(over: Partial<{ accessToken: string | null; scope: string | null; status: string }> = {}) {
    return {
      status: "connected",
      accessToken: JSON.stringify({ apiKey: "stored-firm-key" }),
      scope: STORED_CONFIG,
      ...over,
    };
  }

  it("404s for a non-azure provider", async () => {
    // Addepar has no stored-credential verifier, so this route must not be a
    // second, unaudited way to poke at its connection row.
    vi.stubEnv("ADDEPAR_ENABLED", "true");
    const res = await recheckPost(req({}), { params: Promise.resolve({ provider: "addepar" }) });

    expect(res.status).toBe(404);
    expect(mockGetConnection).not.toHaveBeenCalled();
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("404s when the firm has no connection at all", async () => {
    mockGetConnection.mockResolvedValue(null);

    const res = await recheckPost(req({}), { params });

    expect(res.status).toBe(404);
    expect(mockVerify).not.toHaveBeenCalled();
    // Nothing to flip: writing `error` on a firm that never connected would
    // invent a row, and the card would offer a reconnect for nothing.
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("404s on a DISCONNECTED connection rather than reviving it", async () => {
    mockGetConnection.mockResolvedValue(connectedRow({ status: "disconnected" }));

    const res = await recheckPost(req({}), { params });

    expect(res.status).toBe(404);
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockSetStatus).not.toHaveBeenCalled();
  });

  it("verifies the STORED credentials, not anything sent in the request", async () => {
    mockGetConnection.mockResolvedValue(connectedRow());
    mockVerify.mockResolvedValue({ ok: true, checks: [] });

    // A body is sent and must be ignored: accepting one would let an admin
    // "recheck" a healthy connection into a badge for credentials that were
    // never stored.
    await recheckPost(req({ ...VALID, apiKey: "attacker-supplied" }), { params });

    expect(mockVerify).toHaveBeenCalledWith({
      source: "firm",
      endpoint: VALID.endpoint,
      apiKey: "stored-firm-key",
      apiVersion: VALID.apiVersion,
      deployments: {
        chat: VALID.chatDeployment,
        mini: VALID.miniDeployment,
        embedding: VALID.embeddingDeployment,
      },
    });
  });

  it("clears the error badge and the credential cache when every check passes", async () => {
    mockGetConnection.mockResolvedValue(connectedRow());
    mockVerify.mockResolvedValue({ ok: true, checks: [] });

    const res = await recheckPost(req({}), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, checks: [] });
    // `null` for the detail, not undefined and not a leftover message: the row
    // is what the badge reads, and a stale "Main model: DeploymentNotFound"
    // beside a green badge is worse than either alone.
    expect(mockSetStatus).toHaveBeenCalledWith("org_acme", "azure_openai", "connected", null);
    expect(mockClearCache).toHaveBeenCalledWith("org_acme");
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "integration.recheck",
        firmId: "org_acme",
        metadata: { provider: "azure_openai", ok: true },
      }),
    );
  });

  it("writes the first failure onto the row when a check fails", async () => {
    mockGetConnection.mockResolvedValue(connectedRow());
    mockVerify.mockResolvedValue({
      ok: false,
      checks: [
        { name: "chat", ok: true },
        { name: "mini", ok: false, detail: "DeploymentNotFound" },
        { name: "embedding", ok: true },
      ],
    });

    const res = await recheckPost(req({}), { params });
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(body.checks).toHaveLength(3);
    expect(mockSetStatus).toHaveBeenCalledWith(
      "org_acme",
      "azure_openai",
      "error",
      "Fast model: DeploymentNotFound",
    );
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { provider: "azure_openai", ok: false } }),
    );
  });

  it("clears the cache only AFTER the status write has landed", async () => {
    // Same hazard disconnect guards against: clearing first lets a concurrent
    // request re-read the pre-write row and put the stale entry straight back.
    mockGetConnection.mockResolvedValue(connectedRow());
    mockVerify.mockResolvedValue({ ok: true, checks: [] });

    await recheckPost(req({}), { params });

    expect(mockSetStatus.mock.invocationCallOrder[0]).toBeLessThan(
      mockClearCache.mock.invocationCallOrder[0],
    );
  });

  it("treats an unreadable stored secret as a failed check, not a 500", async () => {
    // This is the one button whose entire purpose is telling an admin what is
    // wrong. "Internal server error" tells them nothing, and would leave the
    // row on `connected` claiming AI works.
    mockGetConnection.mockResolvedValue(connectedRow({ accessToken: null }));

    const res = await recheckPost(req({}), { params });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, checks: [] });
    expect(mockVerify).not.toHaveBeenCalled();
    expect(mockSetStatus).toHaveBeenCalledWith(
      "org_acme",
      "azure_openai",
      "error",
      "Stored credentials could not be read. Reconnect to fix this.",
    );
  });

  it("treats a corrupt stored config the same way, quoting none of it", async () => {
    mockGetConnection.mockResolvedValue(connectedRow({ scope: "not json at all" }));

    const res = await recheckPost(req({}), { params });

    expect(res.status).toBe(200);
    expect(mockSetStatus).toHaveBeenCalledWith(
      "org_acme",
      "azure_openai",
      "error",
      "Stored credentials could not be read. Reconnect to fix this.",
    );
    // JSON.parse's SyntaxError embeds the first ~10 characters of its input, so
    // a message built from `err.message` would put stored bytes on the row —
    // and the row is read back into a UI.
    const detail = String(mockSetStatus.mock.calls[0][3]);
    expect(detail).not.toContain("not json");
    expect(detail).not.toContain('{"apiKey"');
  });

  it("never lets the stored api key into the response body", async () => {
    mockGetConnection.mockResolvedValue(connectedRow());
    mockVerify.mockResolvedValue({ ok: true, checks: [] });

    const res = await recheckPost(req({}), { params });

    // Constraint 7. AiCredentials bundles the key with the four fields a status
    // UI wants, so one careless `NextResponse.json(creds)` leaks it; the type
    // system gives no help here at all.
    expect(JSON.stringify(await res.json())).not.toContain("stored-firm-key");
    // Nor into the audit trail, which is read back by humans.
    expect(JSON.stringify(mockAudit.mock.calls)).not.toContain("stored-firm-key");
  });
});
