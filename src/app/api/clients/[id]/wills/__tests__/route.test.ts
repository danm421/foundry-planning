import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({
  getOrgId: vi.fn(),
}));

vi.mock("@/db", () => {
  const state: {
    clients: Array<{ id: string; firmId: string }>;
    wills: Array<{ id: string; clientId: string; grantor: string }>;
    bequests: unknown[];
    recipients: unknown[];
    accounts: Array<{ id: string; clientId: string }>;
    familyMembers: Array<{ id: string; clientId: string }>;
  } = {
    clients: [
      { id: "c_A", firmId: "firm_A" },
      { id: "c_B", firmId: "firm_B" },
    ],
    wills: [],
    bequests: [],
    recipients: [],
    accounts: [
      { id: "acct_A", clientId: "c_A" },
      { id: "acct_B", clientId: "c_B" },
    ],
    familyMembers: [
      { id: "fm_A", clientId: "c_A" },
      { id: "fm_B", clientId: "c_B" },
    ],
  };
  const makeResult = (rows: unknown[]) => ({
    [Symbol.iterator]: () => rows[Symbol.iterator](),
    then: (r: (v: unknown[]) => unknown) => Promise.resolve(rows).then(r),
  });
  return {
    db: {
      __state: state,
      select: () => ({
        from: (t: { _: { name?: string }; name?: string }) => ({
          where: () => {
            const name =
              (t as unknown as { _?: { name?: string } })?._?.name ??
              (t as unknown as { name?: string })?.name ??
              "";
            if (name === "clients") return makeResult(state.clients);
            if (name === "wills") return makeResult(state.wills);
            if (name === "accounts") return makeResult(state.accounts);
            if (name === "family_members") return makeResult(state.familyMembers);
            return makeResult([]);
          },
        }),
      }),
      insert: () => ({ values: () => ({ returning: () => Promise.resolve([{ id: "w_new" }]) }) }),
    },
  };
});

describe("POST /api/clients/[id]/wills (shape)", () => {
  beforeEach(async () => {
    const helpers = await import("@/lib/db-helpers");
    vi.mocked(helpers.getOrgId).mockReset();
  });

  it("returns 401 when getOrgId throws Unauthorized", async () => {
    const helpers = await import("@/lib/db-helpers");
    vi.mocked(helpers.getOrgId).mockRejectedValue(new Error("Unauthorized"));
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ grantor: "client", bequests: [] }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: "c_A" }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 on invalid body", async () => {
    const helpers = await import("@/lib/db-helpers");
    vi.mocked(helpers.getOrgId).mockResolvedValue("firm_A");
    const { POST } = await import("../route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({ grantor: "joint" }),
      }) as unknown as Parameters<typeof POST>[0],
      { params: Promise.resolve({ id: "c_A" }) } as unknown as Parameters<typeof POST>[1],
    );
    expect(res.status).toBe(400);
  });
});
