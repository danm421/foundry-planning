import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";

const loadScenarioChanges = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
const loadScenarioToggleGroups = vi.hoisted(() => vi.fn(async () => [] as unknown[]));
vi.mock("@/lib/scenario/changes", () => ({ loadScenarioChanges, loadScenarioToggleGroups }));
vi.mock("@/lib/scenario/load-panel-data", () => ({
  buildTargetNames: (_tree: unknown, clientId: string) => ({ [`client:${clientId}`]: "Household" }),
}));

import * as resolveMod from "@/lib/scenario/scenario-changes-resolve";
import { loadScenarioChangesContext } from "../load-scenario-changes-context";

const TREE = {
  client: { firstName: "A", lastName: "B", spouseName: "C" },
  accounts: [{ id: "a1", name: "Brokerage", category: "taxable", subType: "brokerage" }],
  entities: [],
  familyMembers: [],
  externalBeneficiaries: [],
  reinvestments: [],
} as unknown as ClientData;
const PROJECTION = { years: [] } as unknown as ProjectionResult;

const CHANGE = {
  id: "ch1", scenarioId: "s1", opType: "edit", targetKind: "savings_rule", targetId: "r1",
  payload: { annualPercent: { from: 0.06, to: 0.12 } }, toggleGroupId: null, orderIndex: 0,
};
const REINVEST = { ...CHANGE, id: "ch2", targetKind: "reinvestment", opType: "add", payload: { id: "ri1" } };

const args = {
  scenarioId: "s1",
  clientId: "c1",
  clientData: TREE,
  projection: PROJECTION,
  getInvestmentCatalog: vi.fn(async () => ({ portfolios: [{ id: "p1", name: "Growth" }] }) as never),
  logContext: "[test]",
};

beforeEach(() => {
  vi.clearAllMocks();
  loadScenarioChanges.mockResolvedValue([CHANGE]);
  loadScenarioToggleGroups.mockResolvedValue([{ id: "g1", scenarioId: "s1", name: "Strategy A", defaultOn: true, requiresGroupId: null, orderIndex: 0 }]);
});

describe("loadScenarioChangesContext", () => {
  it("returns exactly the shape the export attached before the extraction", async () => {
    const sc = await loadScenarioChangesContext(args);
    expect(loadScenarioChanges).toHaveBeenCalledWith("s1");
    expect(loadScenarioToggleGroups).toHaveBeenCalledWith("s1");
    expect(sc.changes).toEqual([CHANGE]);
    expect(sc.toggleGroups[0].name).toBe("Strategy A");
    expect(sc.targetNames).toEqual({ "client:c1": "Household" });
    expect(sc.baseLabel).toBe("your current plan");
    expect(sc.resolve?.accountsById.a1.name).toBe("Brokerage");
    expect(sc.resolve?.spouseName).toBe("C");
    expect(sc.resolve).toHaveProperty("assetTxById");
  });

  it("only loads the investment catalog when a reinvestment change exists", async () => {
    await loadScenarioChangesContext(args);
    expect(args.getInvestmentCatalog).not.toHaveBeenCalled();

    loadScenarioChanges.mockResolvedValue([REINVEST]);
    await loadScenarioChangesContext(args);
    expect(args.getInvestmentCatalog).toHaveBeenCalledTimes(1);
  });

  it("degrades the reinvestment enrichment, never the whole context, when the catalog fails", async () => {
    loadScenarioChanges.mockResolvedValue([REINVEST]);
    const failing = { ...args, getInvestmentCatalog: vi.fn(async () => { throw new Error("catalog down"); }) };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const sc = await loadScenarioChangesContext(failing);
    expect(sc.changes).toEqual([REINVEST]);
    expect(sc.resolve?.modelPortfoliosById).toEqual({});
    expect(spy).toHaveBeenCalledWith("[test] reinvestment enrichment failed", expect.any(Error));
    spy.mockRestore();
  });

  it("uses the real resolve builders — a change in them is a change here", async () => {
    const spy = vi.spyOn(resolveMod, "buildBaseResolveData");
    await loadScenarioChangesContext(args);
    expect(spy).toHaveBeenCalledWith(TREE);
  });
});
