import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined) };
});

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/integrations/connection-access", () => ({ getOwnedConnection: vi.fn() }));
vi.mock("@/lib/integrations/household-accounts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/integrations/household-accounts")>()),
  findLinkOnConnection: vi.fn(),
  loadHouseholdAccounts: vi.fn(),
  connectHouseholdAccount: vi.fn(),
  addHouseholdAccount: vi.fn(),
  disconnectPlanAccount: vi.fn(),
}));
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { GET, POST } from "./route";
import { auth } from "@clerk/nextjs/server";
import { getOwnedConnection } from "@/lib/integrations/connection-access";
import {
  AccountPanelRefusal,
  addHouseholdAccount,
  connectHouseholdAccount,
  disconnectPlanAccount,
  findLinkOnConnection,
  loadHouseholdAccounts,
} from "@/lib/integrations/household-accounts";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { ForbiddenError, requireActiveSubscriptionForFirm } from "@/lib/authz";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CONN = "11111111-1111-4111-8111-111111111111";
const LINK = "33333333-3333-4333-8333-333333333333";
const PLAN = "44444444-4444-4444-8444-444444444444";
const connection = { id: CONN, firmId: "firm_1", providerId: "addepar", ownerUserId: "u1", scope: null };
const panel = { householdName: "McCormick", connectionName: "Ethos", rows: [], candidates: [] };
const ids = { connectionId: CONN, linkId: LINK, providerId: "addepar" };

const ORIGINAL_ADDEPAR_ENABLED = process.env.ADDEPAR_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.ADDEPAR_ENABLED = "true";
  (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
  (getOwnedConnection as any).mockResolvedValue(connection);
  (findLinkOnConnection as any).mockResolvedValue({ id: LINK, clientId: "c1" });
  (requireClientEditAccess as any).mockResolvedValue({ client: { id: "c1" }, firmId: "firm_1", access: "own" });
  (loadHouseholdAccounts as any).mockResolvedValue(panel);
  (addHouseholdAccount as any).mockResolvedValue(PLAN);
  (disconnectPlanAccount as any).mockResolvedValue("addepar-1");
});
afterEach(() => {
  if (ORIGINAL_ADDEPAR_ENABLED === undefined) delete process.env.ADDEPAR_ENABLED;
  else process.env.ADDEPAR_ENABLED = ORIGINAL_ADDEPAR_ENABLED;
});

const ctx = () => ({ params: Promise.resolve({ provider: "addepar", connectionId: CONN, linkId: LINK }) });
const url = `https://app.test/api/integrations/addepar/connections/${CONN}/households/${LINK}/accounts`;
const get = () => new Request(url);
const post = (body: unknown) => new Request(url, { method: "POST", body: JSON.stringify(body) });
const connect = { action: "connect", externalId: "addepar-1", planAccountId: PLAN };

const mutators = [connectHouseholdAccount, addHouseholdAccount, disconnectPlanAccount];
const expectNothingWritten = () => {
  for (const fn of mutators) expect(fn).not.toHaveBeenCalled();
  expect(recordAudit).not.toHaveBeenCalled();
};

describe("GET …/households/[linkId]/accounts", () => {
  it("returns the panel for the caller's own link", async () => {
    const res = await GET(get(), ctx());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(panel);
    expect(getOwnedConnection).toHaveBeenCalledWith({ connectionId: CONN, firmId: "firm_1", userId: "u1" });
    expect(findLinkOnConnection).toHaveBeenCalledWith({ connectionId: CONN, linkId: LINK });
    expect(requireClientEditAccess).toHaveBeenCalledWith("c1");
    expect(loadHouseholdAccounts).toHaveBeenCalledWith(ids);
  });

  it("404 for a link on a colleague's connection", async () => {
    (getOwnedConnection as any).mockResolvedValue(null);
    const res = await GET(get(), ctx());
    expect(res.status).toBe(404);
    expect(findLinkOnConnection).not.toHaveBeenCalled();
    expect(loadHouseholdAccounts).not.toHaveBeenCalled();
  });

  it("404 for a link that isn't on this connection", async () => {
    (findLinkOnConnection as any).mockResolvedValue(null);
    const res = await GET(get(), ctx());
    expect(res.status).toBe(404);
    expect(loadHouseholdAccounts).not.toHaveBeenCalled();
  });

  it("404 when the caller no longer holds the linked client", async () => {
    (requireClientEditAccess as any).mockRejectedValueOnce(new ForbiddenError("Client not found or access denied"));
    expect((await GET(get(), ctx())).status).toBe(404);
    (requireClientEditAccess as any).mockResolvedValueOnce({ client: { id: "c1" }, firmId: "firm_2", access: "shared" });
    expect((await GET(get(), ctx())).status).toBe(404);
    expect(loadHouseholdAccounts).not.toHaveBeenCalled();
  });
});

describe("POST …/households/[linkId]/accounts", () => {
  it("connects, audits with the connection, link, plan account and Addepar ids, and returns the fresh panel", async () => {
    const res = await POST(post(connect), ctx());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual(panel);
    expect(requireActiveSubscriptionForFirm).toHaveBeenCalledWith("firm_1");
    expect(connectHouseholdAccount).toHaveBeenCalledWith({
      ...ids,
      externalId: "addepar-1",
      planAccountId: PLAN,
      userId: "u1",
    });
    expect(recordAudit).toHaveBeenCalledWith({
      action: "integration.account.connect",
      resourceType: "account",
      resourceId: PLAN,
      clientId: "c1",
      firmId: "firm_1",
      metadata: {
        provider: "addepar",
        connectionId: CONN,
        linkId: LINK,
        externalId: "addepar-1",
        planAccountId: PLAN,
      },
    });
    // The payload is read AFTER the write, so the panel shows the new tie.
    const writeOrder = (connectHouseholdAccount as any).mock.invocationCallOrder[0];
    const readOrder = (loadHouseholdAccounts as any).mock.invocationCallOrder[0];
    expect(writeOrder).toBeLessThan(readOrder);
  });

  it("adds as new with the chosen type and owner, auditing the new plan account", async () => {
    const body = { action: "add", externalId: "addepar-1", category: "retirement", subType: "roth_ira", owner: "client" };
    const res = await POST(post(body), ctx());
    expect(res.status).toBe(200);
    expect(addHouseholdAccount).toHaveBeenCalledWith({
      ...ids,
      externalId: "addepar-1",
      category: "retirement",
      subType: "roth_ira",
      owner: "client",
      userId: "u1",
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "integration.account.add",
        resourceId: PLAN,
        metadata: expect.objectContaining({ connectionId: CONN, externalId: "addepar-1", planAccountId: PLAN }),
      }),
    );
  });

  it("disconnects, auditing the Addepar id it removed", async () => {
    const res = await POST(post({ action: "disconnect", planAccountId: PLAN }), ctx());
    expect(res.status).toBe(200);
    expect(disconnectPlanAccount).toHaveBeenCalledWith({ ...ids, planAccountId: PLAN, userId: "u1" });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "integration.account.disconnect",
        resourceId: PLAN,
        metadata: expect.objectContaining({ connectionId: CONN, externalId: "addepar-1", planAccountId: PLAN }),
      }),
    );
  });

  it("404 for a link on a colleague's connection", async () => {
    (getOwnedConnection as any).mockResolvedValue(null);
    const res = await POST(post(connect), ctx());
    expect(res.status).toBe(404);
    expect(findLinkOnConnection).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("404 for a link that isn't on this connection, or a client the caller no longer holds", async () => {
    (findLinkOnConnection as any).mockResolvedValueOnce(null);
    expect((await POST(post(connect), ctx())).status).toBe(404);
    (requireClientEditAccess as any).mockRejectedValueOnce(new ForbiddenError("Client not found or access denied"));
    expect((await POST(post(connect), ctx())).status).toBe(404);
    expectNothingWritten();
  });

  it("400 for an unknown action", async () => {
    const res = await POST(post({ action: "ignore", externalId: "addepar-1" }), ctx());
    expect(res.status).toBe(400);
    expectNothingWritten();
  });

  it("400 for a malformed body", async () => {
    expect((await POST(post({ action: "connect", externalId: "addepar-1" }), ctx())).status).toBe(400);
    expect(
      (await POST(post({ action: "add", externalId: "a", category: "retirement", subType: "roth_ira", owner: "dog" }), ctx()))
        .status,
    ).toBe(400);
    expect((await POST(new Request(url, { method: "POST", body: "{" }), ctx())).status).toBe(400);
    expectNothingWritten();
  });

  it("409 with the plain-words reason when the plan refuses the action", async () => {
    (connectHouseholdAccount as any).mockRejectedValue(
      new AccountPanelRefusal("“Denise IRA” is already connected. Disconnect it first."),
    );
    const res = await POST(post(connect), ctx());
    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toEqual({
      error: "“Denise IRA” is already connected. Disconnect it first.",
    });
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("403 on a lapsed subscription — nothing written", async () => {
    (requireActiveSubscriptionForFirm as any).mockRejectedValueOnce(new ForbiddenError("Active subscription required"));
    const res = await POST(post(connect), ctx());
    expect(res.status).toBe(403);
    expectNothingWritten();
  });
});
