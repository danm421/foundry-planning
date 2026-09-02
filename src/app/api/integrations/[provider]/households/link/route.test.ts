import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-scoping", () => ({ findClientInFirm: vi.fn() }));
vi.mock("@/lib/integrations/households", () => ({
  linkHousehold: vi.fn(),
  unlinkHousehold: vi.fn(),
  getHouseholdLinkForClient: vi.fn(),
}));
vi.mock("@/lib/clients/authz", () => ({ requireClientEditAccess: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { POST, DELETE } from "./route";
import { auth } from "@clerk/nextjs/server";
import { findClientInFirm } from "@/lib/db-scoping";
import { linkHousehold, unlinkHousehold, getHouseholdLinkForClient } from "@/lib/integrations/households";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { recordAudit } from "@/lib/audit";
import { ForbiddenError } from "@/lib/authz";

const ORIGINAL_ORION_ENABLED = process.env.ORION_ENABLED;
beforeEach(() => {
  vi.clearAllMocks();
  process.env.ORION_ENABLED = "true";
});
afterEach(() => {
  if (ORIGINAL_ORION_ENABLED === undefined) delete process.env.ORION_ENABLED;
  else process.env.ORION_ENABLED = ORIGINAL_ORION_ENABLED;
});

function ctx(provider = "orion") {
  return { params: Promise.resolve({ provider }) };
}

function post(body: unknown) {
  return new Request("https://app.test/api/integrations/orion/households/link", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/integrations/[provider]/households/link", () => {
  it("404s + does NOT link a client from another firm (cross-tenant guard)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:admin" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (findClientInFirm as any).mockResolvedValue(null); // client not in this firm
    const res = await POST(post({ clientId: "c-other", externalHouseholdId: "hh1" }), ctx());
    expect(res.status).toBe(404);
    expect(linkHousehold).not.toHaveBeenCalled();
  });

  it("links a same-firm client (200) with the right args", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:admin" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (findClientInFirm as any).mockResolvedValue({ id: "c1" });
    const res = await POST(post({ clientId: "c1", externalHouseholdId: "hh1" }), ctx());
    expect(res.status).toBe(200);
    expect(linkHousehold).toHaveBeenCalledWith({
      firmId: "firm_1",
      providerId: "orion",
      clientId: "c1",
      externalHouseholdId: "hh1",
      userId: "u1",
    });
  });

  it("403s a non-admin (does NOT link)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
    const res = await POST(post({ clientId: "c1", externalHouseholdId: "hh1" }), ctx());
    expect(res.status).toBe(403);
    expect(linkHousehold).not.toHaveBeenCalled();
  });
});

function del(body: unknown) {
  return new Request("https://app.test/api/integrations/orion/households/link", {
    method: "DELETE",
    body: JSON.stringify(body),
  });
}

describe("DELETE /api/integrations/[provider]/households/link", () => {
  it("403s when the access gate rejects an out-of-firm client", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:admin" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (requireClientEditAccess as any).mockRejectedValue(
      new ForbiddenError("Client not found or access denied"),
    );
    const res = await DELETE(del({ clientId: "c-other" }), ctx());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Client not found or access denied" });
    expect(unlinkHousehold).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("lets a NON-ADMIN advisor with edit access unlink their own client", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (requireClientEditAccess as any).mockResolvedValue({
      client: { id: "c1" }, firmId: "firm_1", access: "own",
    });
    const res = await DELETE(del({ clientId: "c1" }), ctx());
    expect(res.status).toBe(200);
    expect(unlinkHousehold).toHaveBeenCalledWith("firm_1", "c1");
  });

  it("403s an advisor without edit access, and does NOT unlink", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u2", orgRole: "org:member" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (requireClientEditAccess as any).mockRejectedValue(new ForbiddenError("Edit access required"));
    const res = await DELETE(del({ clientId: "c1" }), ctx());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: "Edit access required" });
    expect(unlinkHousehold).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("403s a cross-firm share — a share is not integration access", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u3", orgRole: "org:member" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (requireClientEditAccess as any).mockResolvedValue({
      client: { id: "c1" }, firmId: "firm_other", access: "shared",
    });
    const res = await DELETE(del({ clientId: "c1" }), ctx());
    expect(res.status).toBe(403);
    expect(unlinkHousehold).not.toHaveBeenCalled();
  });

  it("audits the unlink with the LINK ROW'S provider and external id, not the URL's", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (requireClientEditAccess as any).mockResolvedValue({
      client: { id: "c1" }, firmId: "firm_1", access: "own",
    });
    // The client's link row is Addepar even though this request hits the
    // "orion" URL (ctx() defaults to it) — unlinkHousehold has no provider
    // filter, so this is the real-world case the fix exists for.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getHouseholdLinkForClient as any).mockResolvedValue({
      provider: "addepar",
      externalHouseholdId: "hh_123",
    });
    await DELETE(del({ clientId: "c1" }), ctx());
    expect(recordAudit).toHaveBeenCalledWith({
      action: "integration.household.unlink",
      resourceType: "integration_household_link",
      resourceId: "hh_123",
      clientId: "c1",
      firmId: "firm_1",
      metadata: { provider: "addepar", externalHouseholdId: "hh_123" },
    });
  });

  it("falls back to clientId/URL-provider when there is no link row to read", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (requireClientEditAccess as any).mockResolvedValue({
      client: { id: "c1" }, firmId: "firm_1", access: "own",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (getHouseholdLinkForClient as any).mockResolvedValue(null);
    await DELETE(del({ clientId: "c1" }), ctx());
    expect(recordAudit).toHaveBeenCalledWith({
      action: "integration.household.unlink",
      resourceType: "integration_household_link",
      resourceId: "c1",
      clientId: "c1",
      firmId: "firm_1",
      metadata: { provider: "orion", externalHouseholdId: null },
    });
  });
});
