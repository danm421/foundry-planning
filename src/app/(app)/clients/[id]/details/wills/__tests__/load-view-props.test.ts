// The Wills page's loader lists the people and charities a bequest can name
// from the SCENARIO's effective tree, so one added in a scenario is pickable
// and one it removed is not. Mocked at the DB / loader boundary.
import { describe, it, expect, vi, beforeEach } from "vitest";

const CLIENT_ID = "11111111-1111-4111-8111-111111111111";
const FIRM_ID = "22222222-2222-4222-8222-222222222222";

const DRIZZLE_NAME = Symbol.for("drizzle:Name");
const tableName = (t: unknown): string => (t as Record<symbol, string> | null)?.[DRIZZLE_NAME] ?? "";

let rowsByTable: Record<string, unknown[]> = {};

vi.mock("@/db", () => {
  const chain = (rows: unknown[]) => {
    const node = Promise.resolve(rows) as Promise<unknown[]> & Record<string, unknown>;
    node.where = () => node;
    node.orderBy = () => node;
    return node;
  };
  return { db: { select: () => ({ from: (table: unknown) => chain(rowsByTable[tableName(table)] ?? []) }) } };
});
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("notFound() called");
  },
}));
vi.mock("@/lib/db-helpers", () => ({ getOrgId: vi.fn(async () => FIRM_ID) }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree: vi.fn() }));

import { loadWillsViewProps } from "../load-view-props";
import { loadEffectiveTree } from "@/lib/scenario/loader";

beforeEach(() => {
  rowsByTable = {
    clients: [{ id: CLIENT_ID, firmId: FIRM_ID, crmHouseholdId: "h-1" }],
    crm_household_contacts: [
      { role: "primary", firstName: "Cooper", lastName: "C" },
      { role: "spouse", firstName: "Jane", lastName: "C" },
    ],
    scenarios: [{ id: "base", clientId: CLIENT_ID, isBaseCase: true }],
    family_members: [{ id: "fm-base-only", firstName: "Gone", lastName: null, role: "child" }],
    external_beneficiaries: [{ id: "ext-base-only", name: "Gone Charity" }],
    entities: [],
  };
  vi.mocked(loadEffectiveTree).mockReset();
  vi.mocked(loadEffectiveTree).mockResolvedValue({
    effectiveTree: {
      accounts: [],
      liabilities: [],
      wills: [{ id: "w1", grantor: "client", bequests: [] }],
      familyMembers: [
        { id: "fm-scn", firstName: "Zed", lastName: "C", role: "child" },
        { id: "fm-a", firstName: "Amy", lastName: null, role: "child" },
      ],
      externalBeneficiaries: [{ id: "ext-scn", name: "Library", kind: "charity", charityType: "public" }],
    },
    warnings: [],
    resolutionContext: {},
  } as never);
});

describe("loadWillsViewProps", () => {
  it("lists the scenario's members and charities, not the base tables'", async () => {
    const result = await loadWillsViewProps(CLIENT_ID, "scn-9");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.props.familyMembers.map((m) => m.id)).toEqual(["fm-a", "fm-scn"]);
    expect(result.props.externalBeneficiaries).toEqual([{ id: "ext-scn", name: "Library" }]);
  });

  it("still offers the scenario's wills as they are", async () => {
    const result = await loadWillsViewProps(CLIENT_ID, "scn-9");
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.props.initialWills.map((w) => w.grantor)).toEqual(["client"]);
  });
});
