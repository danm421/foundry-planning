import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@clerk/nextjs/server", () => ({ auth: vi.fn() }));
vi.mock("@/lib/db-scoping", () => ({ findClientInFirm: vi.fn() }));
vi.mock("@/lib/orion/households", () => ({ linkHousehold: vi.fn(), unlinkHousehold: vi.fn() }));

import { POST, DELETE } from "./route";
import { auth } from "@clerk/nextjs/server";
import { findClientInFirm } from "@/lib/db-scoping";
import { linkHousehold, unlinkHousehold } from "@/lib/orion/households";

beforeEach(() => vi.clearAllMocks());

function post(body: unknown) {
  return new Request("https://app.test/api/integrations/orion/households/link", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/integrations/orion/households/link", () => {
  it("404s + does NOT link a client from another firm (cross-tenant guard)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:admin" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (findClientInFirm as any).mockResolvedValue(null); // client not in this firm
    const res = await POST(post({ clientId: "c-other", orionHouseholdId: "hh1" }));
    expect(res.status).toBe(404);
    expect(linkHousehold).not.toHaveBeenCalled();
  });

  it("links a same-firm client (200) with the right args", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:admin" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (findClientInFirm as any).mockResolvedValue({ id: "c1" });
    const res = await POST(post({ clientId: "c1", orionHouseholdId: "hh1" }));
    expect(res.status).toBe(200);
    expect(linkHousehold).toHaveBeenCalledWith({ firmId: "firm_1", clientId: "c1", orionHouseholdId: "hh1", userId: "u1" });
  });

  it("403s a non-admin (does NOT link)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
    const res = await POST(post({ clientId: "c1", orionHouseholdId: "hh1" }));
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

describe("DELETE /api/integrations/orion/households/link", () => {
  it("404s + does NOT unlink a client from another firm (cross-tenant guard)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:admin" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (findClientInFirm as any).mockResolvedValue(null);
    const res = await DELETE(del({ clientId: "c-other" }));
    expect(res.status).toBe(404);
    expect(unlinkHousehold).not.toHaveBeenCalled();
  });

  it("unlinks a same-firm client (200)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:admin" });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (findClientInFirm as any).mockResolvedValue({ id: "c1" });
    const res = await DELETE(del({ clientId: "c1" }));
    expect(res.status).toBe(200);
    expect(unlinkHousehold).toHaveBeenCalledWith("firm_1", "c1");
  });

  it("403s a non-admin (does NOT unlink)", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (auth as any).mockResolvedValue({ orgId: "firm_1", userId: "u1", orgRole: "org:member" });
    const res = await DELETE(del({ clientId: "c1" }));
    expect(res.status).toBe(403);
    expect(unlinkHousehold).not.toHaveBeenCalled();
  });
});
