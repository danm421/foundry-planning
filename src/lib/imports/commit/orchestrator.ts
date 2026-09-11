import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { clientImports } from "@/db/schema";

import type { ImportPayload } from "../types";
import { requiredCommitTabs, presenceFromPayload } from "../required-tabs";
import { commitAccounts } from "./accounts";
import { noteAmbiguousSkips } from "./ambiguous-rows";
import { commitClientsIdentity } from "./clients-identity";
import { commitEntities } from "./entities";
import { commitExpenses } from "./expenses";
import {
  loadFamilyRoleIds,
  type FamilyRoleIds,
} from "./family-resolver";
import { commitFamilyMembers } from "./family-members";
import { commitGoals } from "./goals";
import { commitIncomes } from "./incomes";
import { commitLiabilities } from "./liabilities";
import { commitLifeInsurance } from "./life-insurance";
import { commitPlanBasics } from "./plan-basics";
import { commitSavings } from "./savings";
import { commitWills } from "./wills";
import {
  COMMIT_TABS,
  emptyResult,
  type CommitContext,
  type CommitResult,
  type CommitTab,
  type Tx,
} from "./types";

export interface CommitTabsArgs {
  importId: string;
  payload: ImportPayload;
  tabs: readonly CommitTab[];
  ctx: CommitContext;
}

export interface CommitTabsResult {
  results: Record<CommitTab, CommitResult>;
  /** True iff every tab this import requires (see `requiredCommitTabs`) now has a perTabCommittedAt entry. */
  allTabsCommitted: boolean;
  /**
   * True iff THIS commit call caused the import to transition from
   * not-yet-fully-committed to all-tabs-committed. False on subsequent
   * commit calls against an already-committed import (avoids double-firing
   * post-commit hooks).
   */
  firstTimeAllCommitted: boolean;
}

const FAMILY_DEPENDENT_TABS: ReadonlySet<CommitTab> = new Set([
  "accounts",
  "liabilities",
  "life-insurance",
]);

/**
 * Top-level commit dispatcher. Runs each requested tab inside a single
 * `db.transaction` so a failure in any module rolls back the whole pass.
 *
 * Tabs are applied in `COMMIT_TABS` order regardless of the input order,
 * so dependent tabs (e.g. accounts → owners need family members) get
 * the right ordering even when callers list tabs in a different order.
 *
 * After dispatch, the import row's `perTabCommittedAt` jsonb is patched
 * with the just-finished tabs and the import status is flipped to
 * 'committed' if every tab this import requires (see `requiredCommitTabs`)
 * is now present — UNLESS `ctx.rowIds` is set, meaning this is a row-
 * filtered commit from the chat surface. A partial commit is by definition
 * not a completed tab, so it takes the `persistPartialCommit` path instead:
 * still persists `payloadJson` (carrying the links `linkCreated` just
 * stamped, so a re-commit of the same row updates rather than duplicates),
 * but never stamps `perTabCommittedAt` or flips `status`/`committedAt`. See
 * `persistPartialCommit`'s docstring for why the "just skip persistence"
 * fix is worse than the bug it would fix.
 */
export async function commitTabs(args: CommitTabsArgs): Promise<CommitTabsResult> {
  const requested = new Set<CommitTab>(args.tabs);
  const ordered = COMMIT_TABS.filter((t) => requested.has(t));
  const isPartialCommit = args.ctx.rowIds !== undefined;

  return await db.transaction(async (tx) => {
    const results = {} as Record<CommitTab, CommitResult>;
    for (const tab of COMMIT_TABS) {
      results[tab] = emptyResult();
    }

    // Family role rows are read by accounts/liabilities/life-insurance.
    // We load them once after family-members runs (so any newly-created
    // role='client'/'spouse' rows are visible) and pass them down. If
    // family-members isn't in this commit, we load on demand the first
    // time a dependent tab needs it.
    let family: FamilyRoleIds | null = null;
    const needsFamily = ordered.some((t) => FAMILY_DEPENDENT_TABS.has(t));
    if (needsFamily && !ordered.includes("family-members")) {
      family = await loadFamilyRoleIds(tx, args.ctx.clientId);
    }

    for (const tab of ordered) {
      results[tab] = await dispatchTab(tab, tx, args.payload, args.ctx, family);
      if (tab === "family-members" && needsFamily) {
        family = await loadFamilyRoleIds(tx, args.ctx.clientId);
      }
    }

    const { allTabsCommitted, firstTimeAllCommitted } = isPartialCommit
      ? await persistPartialCommit(tx, args.importId, args.payload)
      : await markTabsCommitted(tx, args.importId, ordered, args.payload);
    return { results, allTabsCommitted, firstTimeAllCommitted };
  });
}

/**
 * Runs one tab's commit module, then annotates the result with a single
 * summary warning for any row that module skipped as ambiguous. Doing it here
 * — rather than in each of the eight modules that skip `fuzzy` rows — keeps the
 * reporting in one place and out of the write paths.
 */
async function dispatchTab(
  tab: CommitTab,
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
  family: FamilyRoleIds | null,
): Promise<CommitResult> {
  const result = await runTab(tab, tx, payload, ctx, family);
  return noteAmbiguousSkips(tab, payload, result);
}

async function runTab(
  tab: CommitTab,
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
  family: FamilyRoleIds | null,
): Promise<CommitResult> {
  switch (tab) {
    case "plan-basics":
      return commitPlanBasics(tx, payload, ctx);
    case "clients-identity":
      return commitClientsIdentity(tx, payload, ctx);
    case "family-members":
      return commitFamilyMembers(tx, payload, ctx);
    case "accounts":
      return commitAccounts(tx, payload, ctx, family ?? undefined);
    case "incomes":
      return commitIncomes(tx, payload, ctx);
    case "expenses":
      return commitExpenses(tx, payload, ctx);
    case "liabilities":
      return commitLiabilities(tx, payload, ctx, family ?? undefined);
    case "life-insurance":
      return commitLifeInsurance(tx, payload, ctx, family ?? undefined);
    case "wills":
      return commitWills(tx, payload, ctx);
    case "entities":
      return commitEntities(tx, payload, ctx);
    case "savings":
      return commitSavings(tx, payload, ctx);
    case "goals":
      return commitGoals(tx, payload, ctx);
  }
}

/**
 * Load the import row's current perTabCommittedAt, merge in the just-
 * committed tabs, and write back in a single UPDATE — flipping the
 * status to 'committed' atomically when every tab this import actually
 * requires (per `requiredCommitTabs`) is present in the merged map.
 * Returns the resulting "all tabs committed" flag.
 *
 * Exported so the orchestrator regression test can exercise this directly
 * against a fake transaction, rather than re-deriving the predicate in the
 * test and asserting on a local copy.
 */
export async function markTabsCommitted(
  tx: Tx,
  importId: string,
  tabs: readonly CommitTab[],
  payload: ImportPayload,
): Promise<{ allTabsCommitted: boolean; firstTimeAllCommitted: boolean }> {
  const now = new Date();
  const patchEntries = tabs.map((t) => [t, now.toISOString()] as const);
  const patch = Object.fromEntries(patchEntries);

  const [existing] = await tx
    .select({
      perTabCommittedAt: clientImports.perTabCommittedAt,
      committedAt: clientImports.committedAt,
    })
    .from(clientImports)
    .where(eq(clientImports.id, importId));

  const merged = {
    ...((existing?.perTabCommittedAt as Record<string, unknown> | null) ?? {}),
    ...patch,
  };
  // Only the tabs this import actually needs. Requiring all of COMMIT_TABS
  // made 'committed' unreachable for any import lacking a category — i.e.
  // essentially every real import.
  const required = requiredCommitTabs(presenceFromPayload(payload));
  const allCommitted = required.every((t) => merged[t] != null);
  const firstTimeAllCommitted = allCommitted && existing?.committedAt == null;

  await tx
    .update(clientImports)
    .set({
      perTabCommittedAt: sql`COALESCE(${clientImports.perTabCommittedAt}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      // Persist the links the commit modules just stamped onto the payload
      // (`linkCreated`), so a re-commit UPDATEs the records this import created
      // instead of inserting duplicates. Merged at the top level rather than
      // assigned, so sibling keys (`fileResults`, `assemble`) survive.
      payloadJson: sql`COALESCE(${clientImports.payloadJson}, '{}'::jsonb) || ${JSON.stringify({ payload })}::jsonb`,
      updatedAt: now,
      ...(firstTimeAllCommitted
        ? { status: "committed" as const, committedAt: now }
        : {}),
    })
    .where(eq(clientImports.id, importId));

  return { allTabsCommitted: allCommitted, firstTimeAllCommitted };
}

/**
 * The partial-commit counterpart to `markTabsCommitted`, used when
 * `ctx.rowIds` is set (Task 7, fix round 1 / IMPORTANT 1).
 *
 * A row-filtered commit is by definition not a completed tab — the other
 * N-1 rows in `accounts` are still sitting uncommitted — so this must NOT
 * patch `perTabCommittedAt` or flip `status`/`committedAt` the way
 * `markTabsCommitted` does. Doing so would mark the WHOLE tab committed
 * (and, once every required tab happens to have an entry, flip the import
 * to 'committed') after only one row landed, making the import's own record
 * of what was imported false.
 *
 * It MUST, however, still persist `payloadJson`. That single UPDATE is the
 * only place the `linkCreated` links the commit modules just stamped onto
 * `payload` survive past this request — dropping it (the "obviously
 * simpler" fix of skipping persistence entirely for a partial commit) would
 * mean the NEXT commit of the same row re-reads a payload that still says
 * `{ kind: "new" }` and inserts a second, duplicate account. That is a worse
 * defect than the one this function exists to fix, and it is exactly the
 * mechanism `accounts-row-filter.test.ts`'s double-post test and this file's
 * `persistPartialCommit` tests both pin down.
 *
 * `allTabsCommitted` reflects the import's EXISTING perTabCommittedAt state
 * (this call never adds to it), and `firstTimeAllCommitted` is always
 * false — a partial commit can never BE the transition to fully-committed.
 * Closing the import once every row has been committed belongs to the
 * surface that knows `committedRowIds` (Tasks 9/10), which this dispatcher
 * has no visibility into and should not try to infer.
 */
export async function persistPartialCommit(
  tx: Tx,
  importId: string,
  payload: ImportPayload,
): Promise<{ allTabsCommitted: boolean; firstTimeAllCommitted: boolean }> {
  const now = new Date();

  const [existing] = await tx
    .select({ perTabCommittedAt: clientImports.perTabCommittedAt })
    .from(clientImports)
    .where(eq(clientImports.id, importId));

  const merged = (existing?.perTabCommittedAt as Record<string, unknown> | null) ?? {};
  const required = requiredCommitTabs(presenceFromPayload(payload));
  const allTabsCommitted = required.every((t) => merged[t] != null);

  await tx
    .update(clientImports)
    .set({
      payloadJson: sql`COALESCE(${clientImports.payloadJson}, '{}'::jsonb) || ${JSON.stringify({ payload })}::jsonb`,
      updatedAt: now,
    })
    .where(eq(clientImports.id, importId));

  return { allTabsCommitted, firstTimeAllCommitted: false };
}
