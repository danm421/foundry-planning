import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";

// Everything with IO is mocked; the report models run for real, so these
// tests pin that the PDF is built from the same selection the screen shows.

vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn().mockResolvedValue({ userId: "u-test" }),
  currentUser: vi.fn().mockResolvedValue({ emailAddresses: [{ emailAddress: "advisor@firm.com" }] }),
}));

vi.mock("@/lib/authz", () => ({
  requireActiveSubscriptionForFirm: vi.fn().mockResolvedValue(undefined),
  authErrorResponse: vi.fn().mockReturnValue(null),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkExportPdfRateLimit: vi.fn().mockResolvedValue({ allowed: true }),
  rateLimitErrorResponse: vi.fn(),
}));

vi.mock("@/lib/clients/authz", () => ({
  requireClientEditAccess: vi.fn().mockResolvedValue({
    client: { id: "c1", crmHouseholdId: "hh1", brand: null, advisorId: "adv1" },
    firmId: "firm1",
    access: "own",
  }),
}));

vi.mock("@/lib/branding/resolve-for-client", () => ({
  resolveBrandingForClient: vi.fn().mockResolvedValue({
    firmName: "Ethos Financial Group",
    primaryColor: "#123456",
    logoDataUrl: null,
  }),
}));

const loadReportMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/balance-sheet/load-report", () => ({ loadBalanceSheetReport: loadReportMock }));

const savePlanToVaultMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/crm/vault-plans", () => ({ savePlanToVault: savePlanToVaultMock }));
vi.mock("@/lib/crm/generation-runs", () => ({ recordCompletedRun: vi.fn() }));

// Mocked wholesale: the real document calls StyleSheet.create at module scope.
vi.mock("@/components/balance-sheet-report-pdf/balance-sheet-pdf-document", () => ({
  BalanceSheetPdfDocument: () => null,
}));

const renderToBufferMock = vi.hoisted(() => vi.fn());
vi.mock("@react-pdf/renderer", () => ({ renderToBuffer: renderToBufferMock }));

import { POST } from "../route";
import { NextRequest } from "next/server";
import type { BalanceSheetPdfProps } from "@/components/balance-sheet-report-pdf/balance-sheet-pdf-document";

const year = (y: number, checking: [number, number], trust: [number, number]) => ({
  year: y,
  portfolioAssets: { cash: {}, taxable: {}, retirement: {}, realEstate: {}, business: {}, lifeInsurance: {}, total: 0 },
  accountLedgers: {
    a1: { beginningValue: checking[0], endingValue: checking[1] },
    a2: { beginningValue: trust[0], endingValue: trust[1] },
  },
  liabilityBalancesBoY: {},
});

const report = {
  accounts: [
    { id: "a1", name: "Checking", category: "cash", owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }] },
    { id: "a2", name: "Trust Brokerage", category: "taxable", owners: [{ kind: "entity", entityId: "t1", percent: 1 }] },
  ],
  liabilities: [],
  entities: [
    { id: "t1", name: "Family ILIT", entityType: "trust", isIrrevocable: true },
    {
      id: "llc1",
      name: "Smith LLC",
      entityType: "llc",
      value: 500_000,
      owners: [{ kind: "entity", entityId: "t1", percent: 1 }],
    },
  ],
  trustDetails: [],
  notesReceivable: [],
  familyMembers: [{ id: "fm-c", role: "client", relationship: "child", firstName: "John", lastName: null, dateOfBirth: null }],
  projectionYears: [year(2026, [90_000, 100_000], [275_000, 300_000]), year(2031, [150_000, 150_000], [400_000, 400_000])],
  selectableYears: [2026, 2031],
  agesByYear: { 2026: { client: 64 }, 2031: { client: 69 } },
  clientLabel: "John",
  spouseLabel: null,
  giftEvents: [],
};

const post = (qs: string) =>
  POST(new NextRequest(`http://localhost/api/clients/c1/balance-sheet-report/export-pdf?${qs}`, { method: "POST" }), {
    params: Promise.resolve({ id: "c1" }),
  });

/** Props the route handed the PDF document. */
const docProps = () => (renderToBufferMock.mock.calls[0][0] as ReactElement<BalanceSheetPdfProps>).props;

function householdRow(name: string) {
  const view = docProps().view;
  if (view.kind !== "household") throw new Error(`expected household, got ${view.kind}`);
  return view.household.assetCategories.flatMap((c) => c.rows).find((r) => r.name === name);
}

beforeEach(() => {
  vi.clearAllMocks();
  loadReportMock.mockResolvedValue({
    report,
    scenarioName: null,
    primaryContact: { role: "primary", firstName: "John", lastName: "Smith" },
  });
  renderToBufferMock.mockResolvedValue(Buffer.from("%PDF"));
  savePlanToVaultMock.mockResolvedValue({ id: "doc1" });
});

describe("POST /balance-sheet-report/export-pdf", () => {
  it("defaults to the Household view as of today", async () => {
    const res = await post("");
    expect(res.status).toBe(200);
    expect(householdRow("Checking")?.total).toBe(90_000);
    expect(docProps().subtitle).toBe(`Household · Today (${new Date().getFullYear()}) · Age 64`);
    expect(docProps().scenarioName).toBeNull();
  });

  it("prints the end-of-year values for the picked year", async () => {
    const res = await post("view=household&asOf=eoy&year=2031");
    expect(res.status).toBe(200);
    expect(householdRow("Checking")?.total).toBe(150_000);
    expect(docProps().subtitle).toBe("Household · End of 2031 · Age 69");
    expect(res.headers.get("Content-Disposition")).toContain("balance-sheet-smith-2031.pdf");
  });

  it("prints the By Entity view under the on-screen filter", async () => {
    await post("view=entities&asOf=eoy&year=2031&filter=trusts");
    const view = docProps().view;
    expect(view.kind).toBe("entities");
    if (view.kind !== "entities") return;
    expect(view.groups.map((g) => g.entityName)).toEqual(["Family ILIT"]);
    expect(view.groups[0].assetTotal).toBe(400_000);
    expect(docProps().subtitle).toBe("By Entity · Trusts · End of 2031 · Age 69");
  });

  it("prints every entity under All", async () => {
    await post("view=entities&filter=all");
    const view = docProps().view;
    if (view.kind !== "entities") throw new Error("expected entities");
    expect(view.groups.map((g) => g.entityName).sort()).toEqual(["Family ILIT", "Smith LLC"]);
    expect(docProps().subtitle.startsWith("By Entity · Today")).toBe(true);
  });

  it("loads the scenario on screen and names it", async () => {
    loadReportMock.mockResolvedValue({
      report,
      scenarioName: "Retire at 62",
      primaryContact: { role: "primary", firstName: "John", lastName: "Smith" },
    });
    await post("scenario=s1");
    expect(loadReportMock).toHaveBeenCalledWith("c1", "firm1", "hh1", "s1");
    expect(docProps().scenarioName).toBe("Retire at 62");
    expect(savePlanToVaultMock).toHaveBeenCalledWith(expect.objectContaining({ scenarioId: "s1" }));
  });

  it.each([
    ["view=consolidated", "Invalid view"],
    ["asOf=someday", "Invalid asOf"],
    ["view=entities&filter=people", "Invalid filter"],
    ["asOf=eoy&year=2027", "Invalid year"],
    ["asOf=eoy", "Invalid year"],
    ["asOf=eoy&year=soon", "Invalid year"],
  ])("rejects %s", async (qs, error) => {
    const res = await post(qs);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error });
    expect(renderToBufferMock).not.toHaveBeenCalled();
  });
});
