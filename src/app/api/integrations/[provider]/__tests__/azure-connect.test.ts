import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockVerify = vi.fn();
const mockUpsert = vi.fn();
const mockAudit = vi.fn();
const mockClearCache = vi.fn();

// This mock list is the routes' REAL import graph, not a guess — read from
// the top of connect/route.ts, test/route.ts and disconnect/route.ts before
// writing this file. Two modules are deliberately left UNMOCKED even though
// the routes import them:
//   - "@/lib/integrations/registry" / "../_provider" — the real registry is
//     what proves azure_openai resolves as byok behind AZURE_BYOK_ENABLED;
//     mocking it would make every test here vacuous about the wiring itself.
//   - "@/lib/integrations/errors" — ProviderNotConfigured is used in an
//     `instanceof` check in connect's GET; a mocked class breaks that check.
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
  disconnectConnection: async () => {},
  createOauthState: async () => {},
}));
vi.mock("@/lib/audit", () => ({ recordAudit: (...a: unknown[]) => mockAudit(...a) }));
vi.mock("@/lib/ai/resolve", () => ({ clearAiCredentialCache: (...a: unknown[]) => mockClearCache(...a) }));

import { POST as connectPost } from "../connect/route";
import { POST as testPost } from "../test/route";
import { POST as disconnectPost } from "../disconnect/route";

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
  mockAudit.mockReset();
  mockClearCache.mockReset();
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

  it("reports which check failed", async () => {
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
    expect(body.error).toMatch(/embedding/i);
  });

  it("stores, audits and clears the cache when all checks pass", async () => {
    mockVerify.mockResolvedValue({ ok: true, checks: [] });

    const res = await connectPost(req({ ...VALID, attestation: true }), { params });

    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockClearCache).toHaveBeenCalledWith("org_acme");
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

    const body = await (await testPost(req(VALID), { params })).json();
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

  it("does not clear the cache when disconnecting a non-azure provider", async () => {
    // addepar's own kill-switch, so resolveProvider doesn't return null.
    vi.stubEnv("ADDEPAR_ENABLED", "true");
    const addeparParams = Promise.resolve({ provider: "addepar" });

    const res = await disconnectPost(req({}), { params: addeparParams });

    expect(res.status).toBe(200);
    expect(mockClearCache).not.toHaveBeenCalled();
  });
});
