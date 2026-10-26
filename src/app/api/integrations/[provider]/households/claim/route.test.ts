// src/app/api/integrations/[provider]/households/claim/route.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: vi.fn() }));
vi.mock("@/lib/rate-limit", async (orig) => ({
  ...(await orig<typeof import("@/lib/rate-limit")>()),
  checkIntegrationClaimLimit: vi.fn(),
}));
vi.mock("@/lib/integrations/auth", () => ({ connectionCallContext: vi.fn() }));
vi.mock("@/lib/integrations/connection-access", () => ({ getOwnedConnection: vi.fn() }));
vi.mock("@/lib/integrations/households", () => ({ claimHousehold: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { POST } from "./route";
import { auth } from "@clerk/nextjs/server";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { checkIntegrationClaimLimit } from "@/lib/rate-limit";
import { connectionCallContext } from "@/lib/integrations/auth";
import { getOwnedConnection } from "@/lib/integrations/connection-access";
import { claimHousehold } from "@/lib/integrations/households";
import { recordAudit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/authz";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONN = "11111111-1111-4111-8111-111111111111";
const connection = { id: CONN, firmId: "firm_1", providerId: "addepar", ownerUserId: "u1", scope: "{}" };

const saved = process.env.ADDEPAR_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADDEPAR_ENABLED = "true";
  (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
  (requireClientEditAccess as any).mockResolvedValue({
    client: { id: "c1" }, firmId: "firm_1", access: "own",
  });
  (checkIntegrationClaimLimit as any).mockResolvedValue({ allowed: true });
  (getOwnedConnection as any).mockResolvedValue(connection);
  (connectionCallContext as any).mockResolvedValue({ connectionId: CONN });
  (claimHousehold as any).mockResolvedValue({ ok: true, name: "Doe Family" });
});
afterEach(() => {
  if (saved === undefined) delete process.env.ADDEPAR_ENABLED;
  else process.env.ADDEPAR_ENABLED = saved;
});

const ctx = { params: Promise.resolve({ provider: "addepar" }) };
const post = (body: unknown) =>
  new Request("https://app.test/api/integrations/addepar/households/claim", {
    method: "POST",
    body: JSON.stringify(body),
  });
const good = { clientId: "c1", externalHouseholdId: "1234567", connectionId: CONN };

describe("POST …/households/claim", () => {
  it("lets a NON-ADMIN advisor with edit access claim", async () => {
    const res = await POST(post(good), ctx);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, name: "Doe Family" });
  });

  it("claims through the caller's own connection and its call context", async () => {
    await POST(post(good), ctx);
    expect(getOwnedConnection).toHaveBeenCalledWith({ connectionId: CONN, firmId: "firm_1", userId: "u1" });
    expect(connectionCallContext).toHaveBeenCalledWith(CONN);
    expect(claimHousehold).toHaveBeenCalledWith(
      expect.objectContaining({
        connection,
        clientId: "c1",
        externalHouseholdId: "1234567",
        userId: "u1",
      }),
    );
  });

  it("404 for a connectionId the caller doesn't own", async () => {
    (getOwnedConnection as any).mockResolvedValue(null);
    const res = await POST(post(good), ctx);
    expect(res.status).toBe(404);
    expect(connectionCallContext).not.toHaveBeenCalled();
    expect(claimHousehold).not.toHaveBeenCalled();
    expect(checkIntegrationClaimLimit).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("404 when the connection belongs to another provider than the URL", async () => {
    (getOwnedConnection as any).mockResolvedValue({ ...connection, providerId: "orion" });
    const res = await POST(post(good), ctx);
    expect(res.status).toBe(404);
    expect(claimHousehold).not.toHaveBeenCalled();
  });

  it("400s a missing connectionId without spending the rate limit", async () => {
    const res = await POST(post({ clientId: "c1", externalHouseholdId: "1234567" }), ctx);
    expect(res.status).toBe(400);
    expect(getOwnedConnection).not.toHaveBeenCalled();
    expect(checkIntegrationClaimLimit).not.toHaveBeenCalled();
  });

  it("403s when the caller lacks edit access, without calling the provider", async () => {
    (requireClientEditAccess as any).mockRejectedValue(new ForbiddenError("Edit access required"));
    const res = await POST(post(good), ctx);
    expect(res.status).toBe(403);
    expect(claimHousehold).not.toHaveBeenCalled();
  });

  it("403s a CROSS-FIRM shared client — a share is not integration access", async () => {
    (requireClientEditAccess as any).mockResolvedValue({
      client: { id: "c1" }, firmId: "firm_other", access: "shared",
    });
    const res = await POST(post(good), ctx);
    expect(res.status).toBe(403);
    expect(claimHousehold).not.toHaveBeenCalled();
  });

  it("keys the rate limit on the USER, not the firm", async () => {
    await POST(post(good), ctx);
    // Pinned exactly, not `toContain`: dropping the `${provider.id}:` prefix
    // would still contain "u1" and would silently merge every provider's
    // budget into one bucket per user.
    const key = (checkIntegrationClaimLimit as any).mock.calls[0][0] as string;
    expect(key).toBe("addepar:u1");
  });

  it("does not reach the provider when rate limited", async () => {
    (checkIntegrationClaimLimit as any).mockResolvedValue({ allowed: false, reason: "exceeded" });
    const res = await POST(post(good), ctx);
    expect(res.status).toBe(429);
    expect(claimHousehold).not.toHaveBeenCalled();
  });

  // THE load-bearing test: the two failure reasons must be indistinguishable.
  it("returns a BYTE-IDENTICAL response for unknown vs already-linked", async () => {
    (claimHousehold as any).mockResolvedValue({ ok: false, reason: "unknown_household" });
    const a = await POST(post(good), ctx);
    const aBody = await a.text();

    (claimHousehold as any).mockResolvedValue({ ok: false, reason: "already_linked" });
    const b = await POST(post(good), ctx);
    const bBody = await b.text();

    expect(a.status).toBe(b.status);
    expect(a.status).toBe(409);
    expect(aBody).toBe(bBody);
    // Pin the literal spec string, not just "the two bodies match each
    // other" — a reworded OPAQUE constant would otherwise go unnoticed, and
    // Task 7's dialog copy depends on this exact text.
    expect(aBody).toBe(JSON.stringify({ error: "That household ID isn't available to link." }));
    expect([...a.headers.entries()]).toEqual([...b.headers.entries()]);
  });

  it("audits the TRUE reason with clientId NULLED off the client's timeline", async () => {
    // A failure row must not carry clientId: the client activity feed and
    // overview both filter on it and are reachable with only READ access —
    // weaker than the edit access this route demands. Leaving it set would
    // let the very advisor who was refused recover the true reason by
    // reading their own client's activity feed. The attempted client id
    // still rides in metadata for the admin audit query.
    (claimHousehold as any).mockResolvedValue({ ok: false, reason: "already_linked" });
    await POST(post(good), ctx);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "integration.household.claim",
        resourceType: "integration_household_link",
        resourceId: good.externalHouseholdId,
        clientId: null,
        firmId: "firm_1",
        metadata: expect.objectContaining({
          outcome: "already_linked",
          attemptedClientId: "c1",
          connectionId: CONN,
        }),
      }),
    );
  });

  it("audits an UNKNOWN-household claim the same way — clientId nulled, true reason kept", async () => {
    (claimHousehold as any).mockResolvedValue({ ok: false, reason: "unknown_household" });
    await POST(post(good), ctx);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: null,
        metadata: expect.objectContaining({
          outcome: "unknown_household",
          attemptedClientId: "c1",
        }),
      }),
    );
  });

  it("audits a successful claim too, WITH clientId — it's genuine client history", async () => {
    await POST(post(good), ctx);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "integration.household.claim",
        resourceType: "integration_household_link",
        resourceId: good.externalHouseholdId,
        clientId: "c1",
        metadata: expect.objectContaining({ outcome: "ok", connectionId: CONN }),
      }),
    );
  });

  it("400s a missing household id without spending the rate limit", async () => {
    const res = await POST(post({ clientId: "c1", connectionId: CONN }), ctx);
    expect(res.status).toBe(400);
    expect(checkIntegrationClaimLimit).not.toHaveBeenCalled();
  });

  it("404s when the provider flag is off", async () => {
    delete process.env.ADDEPAR_ENABLED;
    const res = await POST(post(good), ctx);
    expect(res.status).toBe(404);
  });
});
