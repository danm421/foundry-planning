import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { clientImports } from "@/db/schema";

import type { ImportPayload } from "../types";
import { commitAccounts } from "./accounts";
import { commitClientsIdentity } from "./clients-identity";
import { commitEntities } from "./entities";
import { commitExpenses } from "./expenses";
import {
  loadFamilyRoleIds,
  type FamilyRoleIds,
} from "./family-resolver";
import { commitFamilyMembers } from "./family-members";
import { commitIncomes } from "./incomes";
import { commitLiabilities } from "./liabilities";
import { commitLifeInsurance } from "./life-insurance";
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
  /** True iff every tab in COMMIT_TABS now has a perTabCommittedAt entry. */
  allTabsCommitted: boolean;
  /**
   * True iff THIS commit call caused the import to transition from
   * not-yet-fully-committed to all-tabs-committed. False on subsequent
   * commit calls against an already-committed import (avoids double-firing
   * post-commit hooks like the AI import quota counter).
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
 * 'committed' if every tab in COMMIT_TABS is now present.
 */
export async function commitTabs(args: CommitTabsArgs): Promise<CommitTabsResult> {
  const requested = new Set<CommitTab>(args.tabs);
  const ordered = COMMIT_TABS.filter((t) => requested.has(t));

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

    const { allTabsCommitted, firstTimeAllCommitted } = await markTabsCommitted(
      tx,
      args.importId,
      ordered,
    );
    return { results, allTabsCommitted, firstTimeAllCommitted };
  });
}

async function dispatchTab(
  tab: CommitTab,
  tx: Tx,
  payload: ImportPayload,
  ctx: CommitContext,
  family: FamilyRoleIds | null,
): Promise<CommitResult> {
  switch (tab) {
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
  }
}

/**
 * Load the import row's current perTabCommittedAt, merge in the just-
 * committed tabs, and write back in a single UPDATE — flipping the
 * status to 'committed' atomically when every tab in COMMIT_TABS is
 * present in the merged map. Returns the resulting "all tabs committed"
 * flag.
 */
async function markTabsCommitted(
  tx: Tx,
  importId: string,
  tabs: readonly CommitTab[],
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
  const allCommitted = COMMIT_TABS.every((t) => merged[t] != null);
  const firstTimeAllCommitted = allCommitted && existing?.committedAt == null;

  await tx
    .update(clientImports)
    .set({
      perTabCommittedAt: sql`COALESCE(${clientImports.perTabCommittedAt}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: now,
      ...(firstTimeAllCommitted
        ? { status: "committed" as const, committedAt: now }
        : {}),
    })
    .where(eq(clientImports.id, importId));

  return { allTabsCommitted: allCommitted, firstTimeAllCommitted };
}
