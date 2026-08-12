import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

// Only `@/db` is mocked — the schema and drizzle-orm are real, so the assertion
// below reads the actual SQL this module builds. Same pattern as `repo.test.ts`.
const m = vi.hoisted(() => ({ select: vi.fn() }));

vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: (w: unknown) => m.select(w) }) }) },
}));

import { resolveStoryScenarioId } from "../scenario-scope";

const dialect = new PgDialect();
const render = (fragment: unknown) => dialect.sqlToQuery(fragment as never);

const CLIENT = "c1a11111-2222-4333-8444-555555555555";
const SCENARIO = "5ce11111-2222-4333-8444-666666666666";

beforeEach(() => {
  m.select.mockReset();
  m.select.mockResolvedValue([]);
});

describe("resolveStoryScenarioId", () => {
  /**
   * The one predicate that matters. `repo.ts` carries no firm predicate by
   * design, so this clause is the entire barrier between a caller holding a
   * valid scenario uuid from another firm and a story row keyed on it.
   *
   * Kills: dropping `eq(scenarios.clientId, clientId)`. A lookup by scenario id
   * alone is satisfied by ANY firm's scenario, and every route test stays green
   * when it goes — they mock `@/db` and never see the predicate, so this is the
   * only place that regression can be caught.
   */
  it("scopes the lookup to the scenario AND the client that must own it", async () => {
    m.select.mockResolvedValue([{ id: SCENARIO }]);

    const scope = await resolveStoryScenarioId(CLIENT, SCENARIO);

    expect(m.select).toHaveBeenCalledTimes(1);
    const { sql, params } = render(m.select.mock.calls[0][0]);
    expect(sql).toContain('"scenarios"."id" =');
    expect(sql).toContain('"scenarios"."client_id" =');
    // Both terms, both values. Losing either one leaves a single bound param.
    expect(params).toEqual([SCENARIO, CLIENT]);
    expect(scope).toEqual({ ok: true, scenarioId: SCENARIO });
  });

  /**
   * Kills: answering `ok` on an empty result — the same clause, read the other
   * way. Without this the predicate could be asserted perfectly and its answer
   * still ignored.
   */
  it("refuses a scenario the client does not own", async () => {
    m.select.mockResolvedValue([]);
    expect(await resolveStoryScenarioId(CLIENT, SCENARIO)).toEqual({
      ok: false,
      status: 404,
      error: "Scenario not found",
    });
  });

  /**
   * Kills: dropping the uuid shape guard, which sends a malformed id to a uuid
   * column and turns a refusal into a Postgres 22P02 — a 500. "base" and the
   * snapshot refusal ride along as the contract they are; the snapshot branch's
   * own killer is the route test that asserts its wording.
   */
  it("never queries for base, a snapshot, or a malformed id", async () => {
    expect(await resolveStoryScenarioId(CLIENT, "base")).toEqual({ ok: true, scenarioId: "base" });
    expect(await resolveStoryScenarioId(CLIENT, undefined)).toEqual({ ok: true, scenarioId: "base" });
    expect(await resolveStoryScenarioId(CLIENT, "snap:abc")).toMatchObject({ ok: false, status: 400 });
    expect(await resolveStoryScenarioId(CLIENT, "not-a-uuid")).toMatchObject({ ok: false, status: 400 });
    expect(m.select).not.toHaveBeenCalled();
  });
});
