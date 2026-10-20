// src/lib/fact-finder/save/__tests__/end-to-end.ts
/**
 * What both end-to-end save tests use (Plan 4, Task 20): a fact finder reviewed
 * against the live plan (no AI step) and stored as the review route stores it,
 * the save as the route calls it with the real writers, and what the plan, the
 * audit log and the import hold afterwards.
 *
 * Like harness.ts, this file imports `@/db`, but vitest sorts test files by
 * their own source: a test that uses it must itself import `db` from "@/db"
 * (or read DATABASE_URL), or it lands in the unit project.
 */
import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { db } from "@/db";
import { auditLog, clientImports } from "@/db/schema";
import { defaultTicks, type ChangeSet, type ChangeTicks, type TargetKind } from "../../change-set";
import { loadFactFinder, writeFactFinder, type FactFinderScope } from "../../persist";
import { buildChangeSet } from "../../placement/build";
import type { RecordBook } from "../../placement/types";
import { loadRecordBook } from "../../records/book";
import type { FactFinderState } from "../../types";
import { saveChangeSet, type SaveDeps } from "../save";
import { SAVE_ACTOR, type SaveSeed } from "./harness";

/** When every review and save runs. */
export const NOW = new Date("2026-10-15T12:00:00Z");

export type Plan = RecordBook;

export interface Reviewed {
  seed: SaveSeed;
  scope: FactFinderScope;
  changeSet: ChangeSet;
  ticks: ChangeTicks;
}

/** The helpers that read or write under the test file's own firm. */
export function endToEnd(firm: string) {
  const planOf = (seed: SaveSeed) => loadRecordBook(seed.clientId, firm, seed.scenarioId);

  /** `state` on a new import, reviewed against the client's plan (no AI step) and stored with its change list — as the review route does it. */
  async function review(seed: SaveSeed, state: FactFinderState): Promise<Reviewed> {
    const [imp] = await db
      .insert(clientImports)
      .values({ clientId: seed.clientId, orgId: firm, mode: "onboarding", createdByUserId: SAVE_ACTOR, payloadJson: { factFinder: state } })
      .returning({ id: clientImports.id });
    const scope = { importId: imp.id, clientId: seed.clientId, firmId: firm };
    const built = await buildChangeSet({ state, book: await planOf(seed), now: NOW, runLeftovers: async () => null });
    const written = await writeFactFinder(scope, state.version, { ...state, changeSet: { ...built, builtAtVersion: state.version + 1 } }, { keepChangeSet: true });
    return { seed, scope, changeSet: written!.changeSet!, ticks: defaultTicks(written!.changeSet!) };
  }

  return { planOf, review };
}

/** The save as the route calls it, with the real writers; no tickers to price. */
export const save = (r: Reviewed, ticks: ChangeTicks = r.ticks, deps: Partial<SaveDeps> = {}) =>
  saveChangeSet(
    { scope: r.scope, actorId: SAVE_ACTOR, changeSetVersion: r.changeSet.builtAtVersion, ticks },
    { resolveHoldings: async () => new Map(), now: () => NOW, ...deps },
  );

/** The one record of `target` with this label. */
export function recordOf(plan: Plan, target: TargetKind, label: string) {
  const found = plan.records[target].filter((r) => r.label === label);
  expect(found, `${target} “${label}”`).toHaveLength(1);
  return found[0];
}

/** Every record of `before` is in `after` as it was, except the records the save wrote. */
export function expectUnmoved(before: Plan, after: Plan, written: readonly string[]) {
  for (const [target, records] of Object.entries(before.records)) {
    for (const was of records.filter((r) => !written.includes(r.id))) {
      expect(after.records[target as TargetKind].find((r) => r.id === was.id), `${target} “${was.label}”`).toEqual(was);
    }
  }
}

export async function auditOf(seed: SaveSeed): Promise<string[]> {
  const rows = await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.clientId, seed.clientId));
  return rows.map((r) => r.action).sort();
}

export async function importOf(scope: FactFinderScope) {
  const [row] = await db.select({ status: clientImports.status, committedAt: clientImports.committedAt }).from(clientImports).where(eq(clientImports.id, scope.importId));
  return { ...row, factFinder: await loadFactFinder(scope) };
}

export const CLIENT = { ref: "person", role: "client" } as const;
export const LAURA = { ref: "person", role: "spouse" } as const;
export const JOINT = [{ who: CLIENT, percent: 0.5 }, { who: LAURA, percent: 0.5 }];
export const record = (target: TargetKind, id: string) => ({ ref: "record", target, id });
