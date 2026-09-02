import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DistinctBundlePlan } from "@/lib/scenario/presentation-refs";

// Every dependency of this module is IO. Mocked at module scope so the test
// never reaches a database, the engine or the Monte Carlo compute cache.
const loadEffectiveTreeForRef = vi.hoisted(() => vi.fn());
const getOrComputeMonteCarlo = vi.hoisted(() => vi.fn());
const loadScenarioChanges = vi.hoisted(() => vi.fn(async () => []));
const loadScenarioToggleGroups = vi.hoisted(() => vi.fn(async () => []));
const runProjectionWithEvents = vi.hoisted(() => vi.fn(() => ({ years: [] })));
// Two batched name queries, one per table. `table` identifies which ran.
const dbSelect = vi.hoisted(() => vi.fn());

vi.mock("@/db", () => ({
  db: {
    select: (cols: unknown) => ({
      from: (table: unknown) => ({
        where: async () => dbSelect(cols, table),
      }),
    }),
  },
}));
vi.mock("@/db/schema", () => ({
  scenarios: { __table: "scenarios", id: "id", name: "name" },
  scenarioSnapshots: { __table: "scenarioSnapshots", id: "id", name: "name" },
}));
vi.mock("drizzle-orm", () => ({ inArray: (_c: unknown, ids: string[]) => ids }));
vi.mock("@/engine/projection", () => ({ runProjectionWithEvents }));
vi.mock("@/lib/compute-cache/monte-carlo", () => ({ getOrComputeMonteCarlo }));
vi.mock("@/lib/scenario/loader", () => ({ loadEffectiveTreeForRef }));
vi.mock("@/lib/scenario/changes", () => ({
  loadScenarioChanges,
  loadScenarioToggleGroups,
}));
vi.mock("@/lib/scenario/load-panel-data", () => ({ buildTargetNames: () => ({}) }));

import { loadPageScenarioBundles } from "../load-page-bundles";
import {
  ClientNotFoundError,
  ProjectionInputError,
} from "@/lib/projection/load-client-data";

const TREE = { client: { firstName: "A", lastName: "B" }, reinvestments: [] };

const req = (
  ref: DistinctBundlePlan["ref"],
  over: Partial<DistinctBundlePlan> = {},
): DistinctBundlePlan => ({
  ref,
  needsMonteCarlo: false,
  needsScenarioChanges: false,
  ...over,
});

const scenarioRef = (id: string) => ({ kind: "scenario", id, toggleState: {} }) as const;
const snapshotRef = (id: string) => ({ kind: "snapshot", id, side: "left" }) as const;

const ARGS = {
  clientId: "c1",
  firmId: "f1",
  getInvestmentCatalog: async () => ({ portfolios: [] }) as never,
  logContext: "[test]",
};

beforeEach(() => {
  vi.clearAllMocks();
  loadEffectiveTreeForRef.mockResolvedValue({ effectiveTree: TREE });
  runProjectionWithEvents.mockReturnValue({ years: [] });
  getOrComputeMonteCarlo.mockResolvedValue({ payload: { summary: { successRate: 0.8 } } });
  dbSelect.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("loadPageScenarioBundles", () => {
  it("keys every bundle by keyForRef — base, a live scenario and a snapshot", async () => {
    const bundles = await loadPageScenarioBundles({
      ...ARGS,
      requests: [req(scenarioRef("base")), req(scenarioRef("s1")), req(snapshotRef("snp1"))],
    });

    expect(Object.keys(bundles).sort()).toEqual(["base", "scenario:s1", "snap:snp1"]);
  });

  // Delta (c): the private copy this module replaced resolved live scenarios
  // only, so a snapshot column was labelled with the literal "Snapshot" while
  // the sheet beside it printed the real name — and `hashBand` does not include
  // the name, so the wrong one never regenerated itself.
  it("resolves SNAPSHOT names, not just live scenario names", async () => {
    dbSelect.mockImplementation(async (_cols: unknown, table: { __table: string }) =>
      table.__table === "scenarios"
        ? [{ id: "s1", name: "Retire at 62" }]
        : [{ id: "snp1", name: "Board meeting draft" }],
    );

    const bundles = await loadPageScenarioBundles({
      ...ARGS,
      requests: [req(scenarioRef("base")), req(scenarioRef("s1")), req(snapshotRef("snp1"))],
    });

    expect(bundles["base"].scenarioLabel).toBe("Base Case");
    expect(bundles["scenario:s1"].scenarioLabel).toBe("Retire at 62");
    expect(bundles["snap:snp1"].scenarioLabel).toBe("Board meeting draft");
  });

  it("queries names for live scenarios and snapshots separately, and not for base alone", async () => {
    await loadPageScenarioBundles({ ...ARGS, requests: [req(scenarioRef("base"))] });
    expect(dbSelect).not.toHaveBeenCalled();

    await loadPageScenarioBundles({
      ...ARGS,
      requests: [req(scenarioRef("s1")), req(snapshotRef("snp1"))],
    });
    const tables = dbSelect.mock.calls.map((c) => (c[1] as { __table: string }).__table);
    expect(tables).toEqual(["scenarios", "scenarioSnapshots"]);
  });

  // Delta (b): the private copy ran Monte Carlo unconditionally.
  it("runs Monte Carlo only for the refs that ask for it", async () => {
    await loadPageScenarioBundles({
      ...ARGS,
      requests: [
        req(scenarioRef("base"), { needsMonteCarlo: true }),
        req(scenarioRef("s1")),
      ],
    });

    expect(getOrComputeMonteCarlo).toHaveBeenCalledTimes(1);
    expect(getOrComputeMonteCarlo).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: "base" }),
    );
  });

  it("sends a snapshot's Monte Carlo to the base seed", async () => {
    await loadPageScenarioBundles({
      ...ARGS,
      requests: [req(snapshotRef("snp1"), { needsMonteCarlo: true })],
    });

    expect(getOrComputeMonteCarlo).toHaveBeenCalledWith(
      expect.objectContaining({ scenarioId: "base" }),
    );
  });

  it("degrades a failed Monte Carlo to null instead of failing the batch", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    getOrComputeMonteCarlo.mockRejectedValue(new Error("mc down"));

    const bundles = await loadPageScenarioBundles({
      ...ARGS,
      requests: [req(scenarioRef("base"), { needsMonteCarlo: true })],
    });

    expect(bundles["base"].monteCarlo).toBeNull();
  });

  it("loads the change set only for a live scenario that asks for it", async () => {
    await loadPageScenarioBundles({
      ...ARGS,
      requests: [
        req(scenarioRef("s1"), { needsScenarioChanges: true }),
        req(snapshotRef("snp1"), { needsScenarioChanges: true }),
        req(scenarioRef("s2")),
      ],
    });

    expect(loadScenarioChanges).toHaveBeenCalledTimes(1);
    expect(loadScenarioChanges).toHaveBeenCalledWith("s1");
  });

  // Delta (a), the one with teeth: the private copy rethrew the raw error,
  // whose message embeds internal client / CRM-household UUIDs (audit F4).
  it("maps a missing client to ClientNotFoundError", async () => {
    loadEffectiveTreeForRef.mockRejectedValue(new ClientNotFoundError("c1"));

    await expect(
      loadPageScenarioBundles({ ...ARGS, requests: [req(scenarioRef("base"))] }),
    ).rejects.toBeInstanceOf(ClientNotFoundError);
  });

  it("SCRUBS a ProjectionInputError message rather than surfacing the UUIDs in it", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    loadEffectiveTreeForRef.mockRejectedValue(
      new ProjectionInputError("household 0f3c-UUID-9a1 has no dateOfBirth"),
    );

    await expect(
      loadPageScenarioBundles({ ...ARGS, requests: [req(scenarioRef("base"))] }),
    ).rejects.toThrow("Client data is incomplete or invalid for this projection.");
    // The raw detail stays server-side.
    expect(err).toHaveBeenCalled();
  });

  it("lets an unrecognised load failure through untouched", async () => {
    loadEffectiveTreeForRef.mockRejectedValue(new Error("connection reset"));

    await expect(
      loadPageScenarioBundles({ ...ARGS, requests: [req(scenarioRef("base"))] }),
    ).rejects.toThrow("connection reset");
  });
});
