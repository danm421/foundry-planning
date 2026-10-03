import { describe, it, expect, vi, beforeEach } from "vitest";

// Each select resolves to the rows for the table it reads `from`, whatever
// chain (where / limit / orderBy / then) the loader hangs off it.
const rowsByTable = vi.hoisted(() => new Map<unknown, unknown[]>());
const tables = vi.hoisted(() => ({
  scenarios: { t: "scenarios" },
  scenarioChanges: { t: "scenarioChanges" },
  scenarioToggleGroups: { t: "scenarioToggleGroups" },
}));
vi.mock("@/db/schema", () => tables);
vi.mock("drizzle-orm", () => ({ and: () => null, eq: () => null }));
vi.mock("@/db", () => ({
  db: {
    select: () => ({
      from: (table: unknown) => {
        const rows = Promise.resolve(rowsByTable.get(table) ?? []);
        const chain = {
          where: () => chain,
          limit: () => chain,
          orderBy: () => chain,
          then: rows.then.bind(rows),
        };
        return chain;
      },
    }),
  },
}));
vi.mock("@/lib/db-scoping", () => ({ findClientInFirm: async () => ({ id: "c1" }) }));

const loadEffectiveTree = vi.hoisted(() => vi.fn());
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTree }));
const loadClientDataWithContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/projection/load-client-data", () => ({ loadClientDataWithContext }));

import { loadPanelData } from "../load-panel-data";

const tree = (incomes: { id: string; name: string }[]) => ({ client: { firstName: "Ann" }, incomes });

beforeEach(() => {
  rowsByTable.set(tables.scenarios, [{ id: "s1", name: "Retire early", isBaseCase: false }]);
  rowsByTable.set(tables.scenarioChanges, []);
  rowsByTable.set(tables.scenarioToggleGroups, []);
  loadClientDataWithContext.mockResolvedValue({
    clientData: tree([
      { id: "i1", name: "Salary" },
      { id: "i2", name: "Bonus" },
    ]),
  });
});

describe("loadPanelData targetNames", () => {
  it("names a removed item from the base plan — the scenario no longer has it", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: tree([{ id: "i1", name: "Salary" }]), warnings: [] });
    const panel = await loadPanelData("c1", "s1", "f1");
    expect(panel?.targetNames["income:i2"]).toBe("Bonus");
  });

  it("prefers the scenario's name for an item it renamed", async () => {
    loadEffectiveTree.mockResolvedValue({
      effectiveTree: tree([
        { id: "i1", name: "Consulting" },
        { id: "i2", name: "Bonus" },
      ]),
      warnings: [],
    });
    const panel = await loadPanelData("c1", "s1", "f1");
    expect(panel?.targetNames["income:i1"]).toBe("Consulting");
  });

  it("names an edit to the plan's assumptions", async () => {
    loadEffectiveTree.mockResolvedValue({ effectiveTree: tree([]), warnings: [] });
    const panel = await loadPanelData("c1", "s1", "f1");
    expect(panel?.targetNames["plan_settings:c1"]).toBe("Assumptions");
  });
});
