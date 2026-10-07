import { describe, it, expect, vi } from "vitest";

type Row = Record<string, string>;
type Pred = (r: Row) => boolean;

// drizzle's operators become predicates the in-memory tx below evaluates,
// keyed by each real column's SQL name. Self-contained factory (no outer-scope
// refs) so vitest can hoist it above the import.
vi.mock("drizzle-orm", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm")>()),
  eq: (col: { name: string }, val: unknown) => (r: Row) => r[col.name] === val,
  and: (...preds: Pred[]) => (r: Row) => preds.every((p) => p(r)),
  inArray: (col: { name: string }, vals: unknown[]) => (r: Row) => vals.includes(r[col.name]),
  notInArray: (col: { name: string }, vals: unknown[]) => (r: Row) => !vals.includes(r[col.name]),
}));

import { pruneOrphanScenarioChanges } from "../prune-changes";
import { STRESS_TEST_IDS } from "@/engine/stress-tests";

const CLIENT = "c-own";

/** Two scenarios of the deleting client, one of another client. */
const SCENARIOS: Row[] = [
  { id: "s-base", client_id: CLIENT },
  { id: "s-alt", client_id: CLIENT },
  { id: "s-other", client_id: "c-other" },
];

/**
 * In-memory stand-in for a Drizzle transaction handle. A select reads
 * SCENARIOS and yields the matching ids, which is what the scenario-id
 * subquery stands for.
 */
function makeTx(rows: Row[]) {
  return {
    select: () => ({
      from: () => ({ where: (pred: Pred) => SCENARIOS.filter(pred).map((s) => s.id) }),
    }),
    delete: () => ({
      where: (pred: Pred) => {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (pred(rows[i])) rows.splice(i, 1);
        }
        return Promise.resolve();
      },
    }),
  };
}

const row = (target_id: string, target_kind = "income", scenario_id = "s-base"): Row => ({
  target_id,
  target_kind,
  scenario_id,
});

describe("pruneOrphanScenarioChanges (F18)", () => {
  it("deletes rows whose targetId matches the deleted id", async () => {
    const rows = [row("a1"), row("a1", "income", "s-alt"), row("b2")];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pruneOrphanScenarioChanges(makeTx(rows) as any, "a1", CLIENT);
    expect(rows).toEqual([row("b2")]);
  });

  it("leaves non-matching rows intact", async () => {
    const rows = [row("b2"), row("c3")];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pruneOrphanScenarioChanges(makeTx(rows) as any, "a1", CLIENT);
    expect(rows).toEqual([row("b2"), row("c3")]);
  });

  it("is a no-op when no rows match", async () => {
    const rows = [row("b2")];
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pruneOrphanScenarioChanges(makeTx(rows) as any, "missing", CLIENT),
    ).resolves.toBeUndefined();
    expect(rows).toEqual([row("b2")]);
  });

  it("keeps another client's scenario change that names the same id", async () => {
    // A scenario add carries an id its author chose, so another client's
    // scenario can hold a change with this exact target id.
    const rows = [row("a1"), row("a1", "income", "s-other")];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pruneOrphanScenarioChanges(makeTx(rows) as any, "a1", CLIENT);
    expect(rows).toEqual([row("a1", "income", "s-other")]);
  });

  it("never prunes a scenario-only row, whose id can be shared across every firm's scenarios", async () => {
    // Stress tests use one fixed id per kind in every scenario, so a base
    // DELETE carrying that id in its URL must not reach them.
    const crash = STRESS_TEST_IDS["market-crash"];
    const rows = [row(crash, "stress_test"), row(crash, "ltc_event")];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await pruneOrphanScenarioChanges(makeTx(rows) as any, crash, CLIENT);
    expect(rows).toEqual([row(crash, "stress_test"), row(crash, "ltc_event")]);
  });
});
