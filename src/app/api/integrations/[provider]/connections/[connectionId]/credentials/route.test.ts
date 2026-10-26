import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});
vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/integrations/connection-access", () => ({ getOwnedConnection: vi.fn() }));
vi.mock("@/lib/integrations/connections", () => ({ updateByokCredentials: vi.fn() }));
vi.mock("@/lib/integrations/providers/addepar/client", () => ({
  testAddeparConnection: vi.fn(), // resolves = credentials valid
  addeparClient: {}, // referenced at module scope by providers/addepar/index.ts
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({
  checkIntegrationOauthLimit: vi.fn(),
  rateLimitErrorResponse: vi.fn(() => new Response(JSON.stringify({ error: "rl" }), { status: 429 })),
}));

import { POST } from "./route";
import { auth } from "@clerk/nextjs/server";
import { getOwnedConnection } from "@/lib/integrations/connection-access";
import { updateByokCredentials } from "@/lib/integrations/connections";
import { testAddeparConnection } from "@/lib/integrations/providers/addepar/client";
import {
  decodeAddeparConfig,
  encodeAddeparConfig,
  decodeAddeparSecret,
} from "@/lib/integrations/providers/addepar/credentials";
import { CredentialsRejected } from "@/lib/integrations/errors";
import { recordAudit } from "@/lib/audit";
import { checkIntegrationOauthLimit } from "@/lib/rate-limit";
import { requireActiveSubscriptionForFirm } from "@/lib/authz";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONN = "11111111-1111-4111-8111-111111111111";
const connection = {
  id: CONN,
  firmId: "firm_1",
  providerId: "addepar",
  ownerUserId: "u1",
  status: "error",
  scope: encodeAddeparConfig({ apiBase: "https://ethos.addepar.com", addeparFirmId: "1069" }),
};
const good = {
  apiBase: "https://ethos.addepar.com",
  addeparFirmId: "1069",
  apiKey: "new-key",
  apiSecret: "new-secret",
  attestation: true,
  name: "  Ethos  ",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ADDEPAR_ENABLED", "true");
  vi.stubEnv("ORION_ENABLED", "true");
  (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
  (getOwnedConnection as any).mockResolvedValue(connection);
  (checkIntegrationOauthLimit as any).mockResolvedValue({ allowed: true });
  (testAddeparConnection as any).mockResolvedValue(undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

const ctx = (provider = "addepar") => ({ params: Promise.resolve({ provider, connectionId: CONN }) });
const post = (body: unknown, provider = "addepar") =>
  new Request(`https://app.test/api/integrations/${provider}/connections/${CONN}/credentials`, {
    method: "POST",
    body: JSON.stringify(body),
  });

describe("POST …/connections/[connectionId]/credentials", () => {
  it("tests the new key, stores it on the same connection, and audits a reconnect", async () => {
    const res = await POST(post(good), ctx());

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(requireActiveSubscriptionForFirm).toHaveBeenCalledWith("firm_1");
    expect(checkIntegrationOauthLimit).toHaveBeenCalledWith("addepar:u1");
    expect(testAddeparConnection).toHaveBeenCalledTimes(1);

    const arg = (updateByokCredentials as any).mock.calls[0][0];
    expect(arg).toMatchObject({ connectionId: CONN, name: "Ethos", userId: "u1" });
    expect(decodeAddeparSecret(arg.secretBlob)).toEqual({ apiKey: "new-key", apiSecret: "new-secret" });
    expect(decodeAddeparConfig(arg.configBlob)).toEqual({
      apiBase: "https://ethos.addepar.com",
      addeparFirmId: "1069",
    });
    // Tested before anything is stored.
    expect((testAddeparConnection as any).mock.invocationCallOrder[0]).toBeLessThan(
      (updateByokCredentials as any).mock.invocationCallOrder[0],
    );
    expect(recordAudit).toHaveBeenCalledWith({
      action: "integration.connect",
      resourceType: "integration_connection",
      resourceId: CONN,
      firmId: "firm_1",
      metadata: { provider: "addepar", connectionId: CONN, reconnect: true },
    });
  });

  it("400 and nothing stored when the key reaches a different Addepar firm", async () => {
    const res = await POST(post({ ...good, addeparFirmId: "2222" }), ctx());

    expect(res.status).toBe(400);
    const { error } = await res.json();
    expect(error).toContain("1069");
    expect(updateByokCredentials).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("allows a changed API base for the same Addepar firm", async () => {
    const res = await POST(post({ ...good, apiBase: "https://ethos-new.addepar.com" }), ctx());

    expect(res.status).toBe(200);
    const arg = (updateByokCredentials as any).mock.calls[0][0];
    expect(decodeAddeparConfig(arg.configBlob)).toEqual({
      apiBase: "https://ethos-new.addepar.com",
      addeparFirmId: "1069",
    });
  });

  it("404 for a colleague's connection", async () => {
    (getOwnedConnection as any).mockResolvedValue(null);

    const res = await POST(post(good), ctx());

    expect(res.status).toBe(404);
    expect(testAddeparConnection).not.toHaveBeenCalled();
    expect(updateByokCredentials).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("400 and nothing stored when the test fails", async () => {
    (testAddeparConnection as any).mockRejectedValue(
      new CredentialsRejected("Check the API key, secret and firm ID."),
    );

    const res = await POST(post(good), ctx());

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Check the API key, secret and firm ID." });
    expect(updateByokCredentials).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("400 without a name or the attestation — nothing tested", async () => {
    expect((await POST(post({ ...good, name: "   " }), ctx())).status).toBe(400);
    expect((await POST(post({ ...good, attestation: false }), ctx())).status).toBe(400);
    expect(testAddeparConnection).not.toHaveBeenCalled();
    expect(updateByokCredentials).not.toHaveBeenCalled();
  });

  it("404 for an OAuth connection: only Addepar takes a typed key", async () => {
    (getOwnedConnection as any).mockResolvedValue({ ...connection, providerId: "orion" });

    const res = await POST(post(good, "orion"), ctx("orion"));

    expect(res.status).toBe(404);
    expect(testAddeparConnection).not.toHaveBeenCalled();
    expect(updateByokCredentials).not.toHaveBeenCalled();
  });
});
