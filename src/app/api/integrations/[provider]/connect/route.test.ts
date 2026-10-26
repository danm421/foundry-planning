// src/app/api/integrations/[provider]/connect/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/integrations/connections", () => ({
  createByokConnection: vi.fn(),
  upsertByokConnection: vi.fn(),        // Azure's branch
  createOauthState: vi.fn(),            // imported by GET in the same module
}));
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
// The real authErrorResponse/ForbiddenError, so a refused admin gate is a 403.
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return {
    ...actual,
    requireOrgAdminOrOwner: vi.fn(),           // no-op resolve = an admin
    requireActiveSubscriptionForFirm: vi.fn(), // no-op resolve = subscription active
  };
});
vi.mock("@/lib/integrations/providers/addepar/client", () => ({
  testAddeparConnection: vi.fn(),        // resolves = credentials valid
  addeparClient: {},                     // referenced at module scope by providers/addepar/index.ts
}));
vi.mock("@/lib/integrations/providers/orion/oauth", () => ({
  orionOAuth: {
    buildAuthorizeUrl: vi.fn(() => "https://orion.test/oauth/authorize?state=s"),
    exchangeCodeForTokens: vi.fn(),
    refreshTokens: vi.fn(),
  },
}));
vi.mock("@/lib/ai/verify-connection", () => ({ verifyAzureConnection: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationOauthLimit: vi.fn(),
  rateLimitErrorResponse: vi.fn(),
}));

import { GET, POST } from "./route";
import { auth } from "@clerk/nextjs/server";
import { testAddeparConnection } from "@/lib/integrations/providers/addepar/client";
import {
  decodeAddeparConfig,
  decodeAddeparSecret,
} from "@/lib/integrations/providers/addepar/credentials";
import {
  createByokConnection,
  createOauthState,
  upsertByokConnection,
} from "@/lib/integrations/connections";
import { recordAudit } from "@/lib/audit";
import { CredentialsRejected } from "@/lib/integrations/errors";
import { ForbiddenError, requireOrgAdminOrOwner } from "@/lib/authz";
import { verifyAzureConnection } from "@/lib/ai/verify-connection";
import { checkIntegrationOauthLimit } from "@/lib/rate-limit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockAuth = auth as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockTestConnection = testAddeparConnection as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockCreate = createByokConnection as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRequireAdmin = requireOrgAdminOrOwner as any;

function req(body: unknown, provider = "addepar") {
  return new Request(`http://x/api/integrations/${provider}/connect`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
}
const ctx = { params: Promise.resolve({ provider: "addepar" }) };
const good = {
  apiBase: "https://ethos.addepar.com", addeparFirmId: "42", apiKey: "k", apiSecret: "s", name: "Ethos",
};
const asMember = () => mockRequireAdmin.mockRejectedValue(new ForbiddenError("Organization admin role required"));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADDEPAR_ENABLED", "true");
  mockAuth.mockResolvedValue({ orgId: "firm_1", userId: "u1" });
  mockRequireAdmin.mockResolvedValue(undefined);
  mockCreate.mockResolvedValue("conn-1");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (checkIntegrationOauthLimit as any).mockResolvedValue({ allowed: true });
});
afterEach(() => {
  vi.unstubAllEnvs();
});

it("rejects when attestation is not checked", async () => {
  const res = await POST(req({ ...good, attestation: false }), ctx);
  expect(res.status).toBe(400);
  expect(createByokConnection).not.toHaveBeenCalled();
});

it("rejects a missing, blank or over-long name before testing anything", async () => {
  // JSON drops an undefined key, so the first body has no name at all.
  for (const body of [{ ...good, name: undefined }, { ...good, name: "   " }, { ...good, name: "x".repeat(61) }]) {
    const res = await POST(req({ ...body, attestation: true }), ctx);
    expect(res.status).toBe(400);
  }
  expect(testAddeparConnection).not.toHaveBeenCalled();
  expect(createByokConnection).not.toHaveBeenCalled();
});

it("404s when the provider flag is off", async () => {
  vi.stubEnv("ADDEPAR_ENABLED", "");
  const res = await POST(req({ ...good, attestation: true }), ctx);
  expect(res.status).toBe(404);
});

it("returns 400 when the credential test fails", async () => {
  mockTestConnection.mockRejectedValueOnce(new Error("401"));
  const res = await POST(req({ ...good, attestation: true }), ctx);
  expect(res.status).toBe(400);
  expect(createByokConnection).not.toHaveBeenCalled();
  expect(recordAudit).not.toHaveBeenCalled();
});

it("tells the advisor to check the key and secret when Addepar rejects them", async () => {
  mockTestConnection.mockRejectedValueOnce(new CredentialsRejected("Check the API key, secret and firm ID."));
  const res = await POST(req({ ...good, attestation: true }), ctx);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: "Check the API key, secret and firm ID." });
});

it("keeps a non-credential failure's internals out of the message", async () => {
  mockTestConnection.mockRejectedValueOnce(new Error("Addepar /v1/groups failed: 500"));
  const res = await POST(req({ ...good, attestation: true }), ctx);
  expect((await res.json()).error).not.toMatch(/500/);
});

it("validates credentials, creates the advisor's connection, audits, and returns its id", async () => {
  const res = await POST(req({ ...good, name: "  Ethos  ", attestation: true }), ctx);

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ok: true, connectionId: "conn-1" });
  expect(testAddeparConnection).toHaveBeenCalled();
  // Tested before anything is stored.
  expect(mockTestConnection.mock.invocationCallOrder[0]).toBeLessThan(mockCreate.mock.invocationCallOrder[0]);
  // Never the firm-level upsert, which can touch any Addepar row in the firm.
  expect(upsertByokConnection).not.toHaveBeenCalled();

  const arg = mockCreate.mock.calls[0][0];
  expect(arg).toMatchObject({ firmId: "firm_1", ownerUserId: "u1", name: "Ethos" });
  expect(decodeAddeparSecret(arg.secretBlob)).toEqual({ apiKey: "k", apiSecret: "s" });
  expect(decodeAddeparConfig(arg.configBlob)).toEqual({ apiBase: "https://ethos.addepar.com", addeparFirmId: "42" });
  expect(recordAudit).toHaveBeenCalledWith({
    action: "integration.connect",
    resourceType: "integration_connection",
    resourceId: "conn-1",
    firmId: "firm_1",
    metadata: { provider: "addepar", connectionId: "conn-1" },
  });
});

describe("who may connect", () => {
  it("an advisor who isn't an admin can add an Addepar connection", async () => {
    asMember();

    const res = await POST(req({ ...good, attestation: true }), ctx);

    expect(res.status).toBe(200);
    expect(createByokConnection).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: "u1" }));
    // Bucketed per advisor, so one advisor's attempts can't 429 a colleague.
    expect(checkIntegrationOauthLimit).toHaveBeenCalledWith("addepar:u1");
  });

  it("two connects create two connections", async () => {
    mockCreate.mockResolvedValueOnce("conn-a").mockResolvedValueOnce("conn-b");

    const first = await POST(req({ ...good, attestation: true }), ctx);
    const second = await POST(req({ ...good, name: "Ethos 2", attestation: true }), ctx);

    expect(createByokConnection).toHaveBeenCalledTimes(2);
    expect((await first.json()).connectionId).toBe("conn-a");
    expect((await second.json()).connectionId).toBe("conn-b");
  });

  it("Azure connect still needs an admin", async () => {
    vi.stubEnv("AZURE_BYOK_ENABLED", "true");
    asMember();

    const res = await POST(
      req({
        endpoint: "https://acme-ria.openai.azure.com",
        apiKey: "firm-key",
        apiVersion: "2024-12-01-preview",
        chatDeployment: "gpt-5.4",
        miniDeployment: "gpt-5.4-mini",
        embeddingDeployment: "text-embedding-3-small",
        attestation: true,
      }, "azure_openai"),
      { params: Promise.resolve({ provider: "azure_openai" }) },
    );

    expect(res.status).toBe(403);
    expect(verifyAzureConnection).not.toHaveBeenCalled();
    expect(upsertByokConnection).not.toHaveBeenCalled();
    expect(createByokConnection).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("an advisor who isn't an admin can start an OAuth connect", async () => {
    vi.stubEnv("ORION_ENABLED", "true");
    asMember();

    const res = await GET(
      new Request("https://app.test/api/integrations/orion/connect"),
      { params: Promise.resolve({ provider: "orion" }) },
    );

    expect([302, 307]).toContain(res.status);
    expect(res.headers.get("location")).toBe("https://orion.test/oauth/authorize?state=s");
    expect(createOauthState).toHaveBeenCalledWith(
      expect.objectContaining({ firmId: "firm_1", providerId: "orion", userId: "u1" }),
    );
    expect(checkIntegrationOauthLimit).toHaveBeenCalledWith("orion:u1");
  });
});
