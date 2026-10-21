/**
 * Gift series routes — QCD (From an IRA) writes.
 *
 * PATCH bodies are partial, so the route validates the stored row with the
 * patch laid over it: a grantor-only or recipient-only edit must not move a QCD
 * to the other spouse's IRA or a private charity. Mocked at the db / auth seams.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const setSpy = vi.fn();
const insertSpy = vi.fn();
let world: Map<unknown, unknown[]>;

vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (t: unknown) => ({ where: () => Promise.resolve(world.get(t) ?? []) }),
    }),
    update: () => ({
      set: (v: unknown) => {
        setSpy(v);
        return { where: () => ({ returning: async () => [{ id: "gs1", ...(v as object) }] }) };
      },
    }),
    insert: () => ({
      values: (v: unknown) => {
        insertSpy(v);
        return { returning: async () => [{ id: "gs1", ...(v as object) }] };
      },
    }),
  },
}));
vi.mock("@/lib/db-helpers", () => ({
  requireOrgAndUser: vi.fn().mockResolvedValue({ orgId: "org1", userId: "u1" }),
}));
vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn().mockResolvedValue({ firmId: "f1", access: "own" }),
}));
vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  authErrorResponse: () => null,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/scenario/resolve-scenario-param", () => ({
  resolveScenarioId: vi.fn().mockResolvedValue("S"),
  getBaseCaseScenarioId: vi.fn().mockResolvedValue("S"),
}));

import {
  giftSeries,
  accounts,
  accountOwners,
  familyMembers,
  externalBeneficiaries,
} from "@/db/schema";
import { PATCH } from "../[seriesId]/route";
import { POST } from "../route";

const IRA = "a0000000-0000-0000-0000-000000000001";
const CHARITY = "b0000000-0000-0000-0000-000000000001";
const OWNER = "f0000000-0000-0000-0000-000000000001";

const qcdSeries = {
  id: "gs1",
  grantor: "client",
  recipientEntityId: null,
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: CHARITY,
  annualAmount: "20000",
  amountMode: "fixed",
  qcdAccountId: IRA,
  qcdAmountMode: "fixed",
};

function setWorld(opts: { existing?: object; ownerRole?: string; charityType?: string } = {}) {
  world = new Map<unknown, unknown[]>([
    [giftSeries, [opts.existing ?? qcdSeries]],
    [accounts, [{ category: "retirement", subType: "traditional_ira" }]],
    [accountOwners, [{ familyMemberId: OWNER }]],
    [familyMembers, [{ role: opts.ownerRole ?? "client" }]],
    [externalBeneficiaries, [{ id: CHARITY, kind: "charity", charityType: opts.charityType ?? "public" }]],
  ]);
}

const ctx = { params: Promise.resolve({ id: "c1", seriesId: "gs1" }) };
const patch = (body: object) =>
  PATCH(
    new Request("http://localhost/api/clients/c1/gifts/series/gs1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
    ctx,
  );

describe("gift series PATCH — QCD merged-row check", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWorld();
  });

  it("clears BOTH QCD columns together when the patch nulls both", async () => {
    const res = await patch({ qcdAccountId: null, qcdAmountMode: null });
    expect(res.status).toBe(200);
    expect(setSpy.mock.calls[0][0]).toMatchObject({ qcdAccountId: null, qcdAmountMode: null });
  });

  it("allows changing only the amount mode (full RMD needs annualAmount 0)", async () => {
    const res = await patch({ qcdAmountMode: "full_rmd", annualAmount: 0 });
    expect(res.status).toBe(200);
    const set = setSpy.mock.calls[0][0];
    expect(set).toMatchObject({ qcdAmountMode: "full_rmd", annualAmount: "0" });
    expect(set).not.toHaveProperty("qcdAccountId");
  });

  it("refuses an amount-mode-only patch that leaves a full-RMD QCD with an amount", async () => {
    const res = await patch({ qcdAmountMode: "full_rmd" });
    expect(res.status).toBe(400);
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("refuses a grantor-only edit onto a spouse who doesn't own the IRA", async () => {
    const res = await patch({ grantor: "spouse" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("A QCD must come from an IRA owned by the giver");
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("refuses a recipient-only edit onto a private charity", async () => {
    setWorld({ charityType: "private" });
    const res = await patch({ recipientExternalBeneficiaryId: CHARITY });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("A QCD must go to a public charity");
  });

  it("refuses the annual-exclusion amount on an existing QCD", async () => {
    const res = await patch({ amountMode: "annual_exclusion" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("A QCD can't use the annual-exclusion amount");
  });

  it("refuses a switch back to cash that leaves annualAmount 0", async () => {
    setWorld({ existing: { ...qcdSeries, annualAmount: "0", qcdAmountMode: "full_rmd" } });
    const res = await patch({ qcdAccountId: null, qcdAmountMode: null });
    expect(res.status).toBe(400);
    expect(setSpy).not.toHaveBeenCalled();
  });
});

describe("gift series POST — QCD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setWorld();
  });

  const post = (body: object) =>
    POST(
      new Request("http://localhost/api/clients/c1/gifts/series", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }) as never,
      { params: Promise.resolve({ id: "c1" }) },
    );
  const body = {
    grantor: "client",
    recipientExternalBeneficiaryId: CHARITY,
    startYear: 2027,
    endYear: 2030,
    annualAmount: 20000,
    qcdAccountId: IRA,
    qcdAmountMode: "fixed",
  };

  it("stores the QCD pair with amount_mode 'fixed'", async () => {
    const res = await post(body);
    expect(res.status).toBe(201);
    expect(insertSpy.mock.calls[0][0]).toMatchObject({
      qcdAccountId: IRA,
      qcdAmountMode: "fixed",
      amountMode: "fixed",
    });
  });

  it("refuses an IRA the giver doesn't own", async () => {
    setWorld({ ownerRole: "spouse" });
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(insertSpy).not.toHaveBeenCalled();
  });
});
