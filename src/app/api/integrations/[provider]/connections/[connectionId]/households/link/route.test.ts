import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/integrations/connection-access", () => ({ getOwnedConnection: vi.fn() }));
vi.mock("@/lib/integrations/households", () => ({
  linkHouseholdOnConnection: vi.fn(),
  unlinkHousehold: vi.fn(),
  getHouseholdLinkForClient: vi.fn(),
}));
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/lib/activity/resolve-actors", () => ({ resolveActors: vi.fn() }));

import { POST, DELETE } from "./route";
import { auth } from "@clerk/nextjs/server";
import { getOwnedConnection } from "@/lib/integrations/connection-access";
import {
  linkHouseholdOnConnection,
  unlinkHousehold,
  getHouseholdLinkForClient,
} from "@/lib/integrations/households";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { resolveActors } from "@/lib/activity/resolve-actors";
import { ForbiddenError, requireActiveSubscriptionForFirm } from "@/lib/authz";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONN = "11111111-1111-4111-8111-111111111111";
const OTHER_CONN = "22222222-2222-4222-8222-222222222222";
const connection = { id: CONN, firmId: "firm_1", providerId: "orion", ownerUserId: "u1", scope: null };

const ORIGINAL_ORION_ENABLED = process.env.ORION_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.ORION_ENABLED = "true";
  (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
  (getOwnedConnection as any).mockResolvedValue(connection);
  (requireClientEditAccess as any).mockResolvedValue({
    client: { id: "c1" }, firmId: "firm_1", access: "own",
  });
  (linkHouseholdOnConnection as any).mockResolvedValue({ ok: true });
  (getHouseholdLinkForClient as any).mockResolvedValue({
    id: "L1", clientId: "c1", provider: "orion", connectionId: CONN, externalHouseholdId: "hh1",
  });
  (resolveActors as any).mockResolvedValue(new Map());
});
afterEach(() => {
  if (ORIGINAL_ORION_ENABLED === undefined) delete process.env.ORION_ENABLED;
  else process.env.ORION_ENABLED = ORIGINAL_ORION_ENABLED;
});

const ctx = () => ({ params: Promise.resolve({ provider: "orion", connectionId: CONN }) });
const url = `https://app.test/api/integrations/orion/connections/${CONN}/households/link`;
const post = (body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body) });
const del = (body: unknown) => new Request(url, { method: "DELETE", body: JSON.stringify(body) });
const good = { clientId: "c1", externalHouseholdId: "hh1" };

describe("POST …/connections/[connectionId]/households/link", () => {
  it("links through the owned connection and audits with connectionId", async () => {
    const res = await POST(post(good), ctx());
    expect(res.status).toBe(200);
    expect(getOwnedConnection).toHaveBeenCalledWith({ connectionId: CONN, firmId: "firm_1", userId: "u1" });
    expect(requireActiveSubscriptionForFirm).toHaveBeenCalledWith("firm_1");
    expect(requireClientEditAccess).toHaveBeenCalledWith("c1");
    expect(linkHouseholdOnConnection).toHaveBeenCalledWith({
      connection,
      clientId: "c1",
      externalHouseholdId: "hh1",
      userId: "u1",
    });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "integration.household.link",
      resourceType: "integration_household_link",
      resourceId: "hh1",
      clientId: "c1",
      firmId: "firm_1",
      metadata: { provider: "orion", externalHouseholdId: "hh1", connectionId: CONN },
    });
  });

  it("409 with linkedByName when the client is linked elsewhere", async () => {
    (linkHouseholdOnConnection as any).mockResolvedValue({
      ok: false, reason: "client_linked_elsewhere", linkedByUserId: "user_sarah",
    });
    (resolveActors as any).mockResolvedValue(new Map([["user_sarah", { name: "Sarah Kim", isSystem: false }]]));

    const res = await POST(post(good), ctx());

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.linkedByName).toBe("Sarah Kim");
    expect(typeof body.error).toBe("string");
    expect(resolveActors).toHaveBeenCalledWith(["user_sarah"]);
    // A refusal changes nothing, so there is nothing to audit.
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("409 when the household is held by another client, naming its linker", async () => {
    (linkHouseholdOnConnection as any).mockResolvedValue({
      ok: false, reason: "household_linked_elsewhere", linkedByUserId: "user_sarah",
    });
    (resolveActors as any).mockResolvedValue(new Map([["user_sarah", { name: "Sarah Kim", isSystem: false }]]));
    const res = await POST(post(good), ctx());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ linkedByName: "Sarah Kim" });
  });

  it("404 for a colleague's connection id — nothing linked or audited", async () => {
    (getOwnedConnection as any).mockResolvedValue(null);
    const res = await POST(post(good), ctx());
    expect(res.status).toBe(404);
    expect(linkHouseholdOnConnection).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("400 without clientId or externalHouseholdId", async () => {
    expect((await POST(post({ clientId: "c1" }), ctx())).status).toBe(400);
    expect((await POST(post({ externalHouseholdId: "hh1" }), ctx())).status).toBe(400);
    expect(linkHouseholdOnConnection).not.toHaveBeenCalled();
  });

  it("403 on a lapsed subscription — nothing linked", async () => {
    (requireActiveSubscriptionForFirm as any).mockRejectedValueOnce(
      new ForbiddenError("Active subscription required"),
    );
    const res = await POST(post(good), ctx());
    expect(res.status).toBe(403);
    expect(linkHouseholdOnConnection).not.toHaveBeenCalled();
  });

  it("403 when the caller can't edit the client (out of firm, or no access)", async () => {
    (requireClientEditAccess as any).mockRejectedValue(new ForbiddenError("Client not found or access denied"));
    const res = await POST(post(good), ctx());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Client not found or access denied" });
    expect(linkHouseholdOnConnection).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("403 for a cross-firm share — a share is not integration access", async () => {
    (requireClientEditAccess as any).mockResolvedValue({
      client: { id: "c1" }, firmId: "firm_other", access: "shared",
    });
    const res = await POST(post(good), ctx());
    expect(res.status).toBe(403);
    expect(linkHouseholdOnConnection).not.toHaveBeenCalled();
  });
});

describe("DELETE …/connections/[connectionId]/households/link", () => {
  it("unlinks the client's link on this connection and audits it with connectionId", async () => {
    const res = await DELETE(del({ clientId: "c1" }), ctx());
    expect(res.status).toBe(200);
    expect(unlinkHousehold).toHaveBeenCalledWith(CONN, "c1");
    expect(recordAudit).toHaveBeenCalledWith({
      action: "integration.household.unlink",
      resourceType: "integration_household_link",
      resourceId: "hh1",
      clientId: "c1",
      firmId: "firm_1",
      metadata: { provider: "orion", externalHouseholdId: "hh1", connectionId: CONN },
    });
    // The link row is read BEFORE it is deleted: it holds the external id
    // the audit row needs, and the connection it must belong to.
    const readOrder = (getHouseholdLinkForClient as any).mock.invocationCallOrder[0];
    const deleteOrder = (unlinkHousehold as any).mock.invocationCallOrder[0];
    expect(readOrder).toBeLessThan(deleteOrder);
    // Unlinking is the connection owner's action, and stays open on a lapsed
    // subscription: severing a provider's hold on a client is never billing's
    // to block.
    expect(requireClientEditAccess).not.toHaveBeenCalled();
    expect(requireActiveSubscriptionForFirm).not.toHaveBeenCalled();
  });

  it("404 when the client's link is on another connection", async () => {
    (getHouseholdLinkForClient as any).mockResolvedValue({
      id: "L9", clientId: "c1", provider: "orion", connectionId: OTHER_CONN, externalHouseholdId: "hh9",
    });
    const res = await DELETE(del({ clientId: "c1" }), ctx());
    expect(res.status).toBe(404);
    expect(unlinkHousehold).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("404 when the client has no link at all", async () => {
    (getHouseholdLinkForClient as any).mockResolvedValue(null);
    const res = await DELETE(del({ clientId: "c1" }), ctx());
    expect(res.status).toBe(404);
    expect(unlinkHousehold).not.toHaveBeenCalled();
  });

  it("404 for a colleague's connection id", async () => {
    (getOwnedConnection as any).mockResolvedValue(null);
    const res = await DELETE(del({ clientId: "c1" }), ctx());
    expect(res.status).toBe(404);
    expect(getHouseholdLinkForClient).not.toHaveBeenCalled();
    expect(unlinkHousehold).not.toHaveBeenCalled();
  });

  it("400 without clientId", async () => {
    const res = await DELETE(del({}), ctx());
    expect(res.status).toBe(400);
    expect(unlinkHousehold).not.toHaveBeenCalled();
  });
});
