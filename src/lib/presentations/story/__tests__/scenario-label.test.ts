import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

// Only `@/db` is mocked — the schema and drizzle-orm are real, so the scoping
// assertion below reads the actual SQL this module builds. Same pattern as
// `scenario-scope.test.ts` and `repo.test.ts`.
const m = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: (w: unknown) => m.select(w) }) }) },
}));

import { loadStoryScenarioLabel } from "../scenario-label";

const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as never);

const CLIENT = "c1a11111-2222-4333-8444-555555555555";
const SCENARIO = "5ce11111-2222-4333-8444-666666666666";

beforeEach(() => {
  m.select.mockReset();
  m.select.mockResolvedValue([]);
});

describe("loadStoryScenarioLabel", () => {
  it("prints the name the advisor gave the plan", async () => {
    m.select.mockResolvedValue([
      { id: "other-scenario", name: "Retire at 70" },
      { id: SCENARIO, name: "Retire at 62 + Roth" },
    ]);

    expect(await loadStoryScenarioLabel(CLIENT, SCENARIO)).toBe("Retire at 62 + Roth");
  });

  /**
   * This clause is the whole barrier. The label prints on a client-facing page
   * and the scenario id arrives as a raw options field on the export body, so a
   * lookup by id alone would let any caller read back the NAME of any firm's
   * scenario. Nothing else in the export path checks it before the string is
   * used.
   *
   * Kills: dropping `eq(scenarios.clientId, clientId)`, and comparing the
   * picked id in SQL — the `uuid` column would raise 22P02 on a `snap:` ref and
   * turn a cosmetic fallback into a 500.
   */
  it("scopes the lookup to this client, and compares nothing else in SQL", async () => {
    m.select.mockResolvedValue([{ id: SCENARIO, name: "Retire at 62" }]);

    await loadStoryScenarioLabel(CLIENT, SCENARIO);

    expect(m.select).toHaveBeenCalledTimes(1);
    const { sql, params } = render(m.select.mock.calls[0][0]);
    expect(sql).toContain('"scenarios"."client_id" =');
    expect(params).toEqual([CLIENT]);
  });

  /**
   * CORRECTION 6, the defect this module exists for: `labelForRef` falls back
   * to `ref.id`, so the deck's house pattern would head a client's page
   * "Your Plan · 5CE11111-2222-…".
   *
   * Reachable in practice only for a `snap:` ref, which the story's picker
   * hides and the write routes refuse; a genuinely foreign uuid fails the
   * export a moment later in `loadStoryContext`.
   */
  it("never prints an id when the plan cannot be named", async () => {
    m.select.mockResolvedValue([{ id: "some-other-scenario", name: "Retire at 70" }]);

    const label = await loadStoryScenarioLabel(CLIENT, SCENARIO);

    expect(label).not.toContain(SCENARIO);
    expect(label).toBe("Proposed Plan");
  });

  it("does not query for a `snap:` ref, whose id would not parse as a uuid", async () => {
    expect(await loadStoryScenarioLabel(CLIENT, "snap:abc")).toBe("Proposed Plan");
    // One query, and it compared no uuid — the `snap:` string never reached SQL.
    const { params } = render(m.select.mock.calls[0][0]);
    expect(params).toEqual([CLIENT]);
  });

  /**
   * The base-only story still gets a label a client can read, and it is the one
   * every other page of the same PDF already prints for the current plan.
   */
  it.each(["", "base"])("names a base-only story (%s) without a query", async (scenarioId) => {
    expect(await loadStoryScenarioLabel(CLIENT, scenarioId)).toBe("Base Case");
    expect(m.select).not.toHaveBeenCalled();
  });
});
