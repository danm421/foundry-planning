// src/lib/integrations/commit.ts
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { clientImports } from "@/db/schema";
import type { ExtractedAccount } from "@/lib/extraction/types";
import { resolveHoldingsForCommit } from "@/lib/imports/commit/holdings";
import { commitTabs } from "@/lib/imports/commit/orchestrator";
import { emptyImportPayload, type ImportPayload } from "@/lib/imports/types";
import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";

import { reconcile } from "./reconcile";
import type { SyncingProviderId } from "./types";

/**
 * Writes provider accounts to the plan through the document-import commit path
 * (`resolveHoldingsForCommit` → `commitTabs` → `syncAccountFromHoldings`) — it
 * never forks a second commit implementation. Each row's `match` decides the
 * write: `exact` updates that plan account in place, `new` creates one.
 */
export async function commitProviderAccounts(i: {
  clientId: string;
  scenarioId: string;
  firmId: string;
  userId: string;
  providerId: SyncingProviderId;
  accounts: ImportPayload["accounts"];
}): Promise<void> {
  const payload: ImportPayload = { ...emptyImportPayload(), accounts: i.accounts };
  const [vehicle] = await db
    .insert(clientImports)
    .values({
      clientId: i.clientId,
      orgId: i.firmId,
      scenarioId: i.scenarioId,
      mode: "updating",
      status: "draft",
      createdByUserId: i.userId,
      origin: i.providerId,
      payloadJson: { payload },
    })
    .returning();

  const resolvedHoldings = await resolveHoldingsForCommit(payload);
  const holdingsAccountIds: string[] = [];
  try {
    await commitTabs({
      importId: vehicle.id,
      payload,
      tabs: ["accounts"],
      ctx: {
        clientId: i.clientId,
        scenarioId: i.scenarioId,
        orgId: i.firmId,
        userId: i.userId,
        resolvedHoldings,
        holdingsAccountIds,
      },
    });
  } catch (err) {
    // commitTabs rolls back its whole transaction on failure — drop the
    // now-empty draft vehicle so it doesn't linger in the advisor's
    // in-progress imports list, then surface to the caller.
    await db.delete(clientImports).where(eq(clientImports.id, vehicle.id));
    throw err;
  }
  await Promise.all(holdingsAccountIds.map(syncAccountFromHoldings));

  // Close out the vehicle import so it reads as a clean history row.
  await db
    .update(clientImports)
    .set({ status: "committed", committedAt: new Date() })
    .where(eq(clientImports.id, vehicle.id));
}

/**
 * The rows of a client's open review, from a pull and the plan accounts it is
 * tied to (by external id). A tied account is `exact` to its plan account; the
 * rest are `new`.
 *
 * Review-mode providers (autoCommitExact: false, e.g. Addepar) must not
 * auto-commit ANYTHING — every account, exact or new, folds into the single
 * open review import so the advisor confirms before any write. OAuth
 * providers (autoCommitExact: true) auto-commit the exact ones, so only the
 * new ones are reviewed.
 */
export function buildReviewAccounts(i: {
  pulled: ExtractedAccount[];
  ties: Array<{ id: string; externalId: string | null }>;
  autoCommitExact: boolean;
}): ImportPayload["accounts"] {
  const { exact, new: fresh } = reconcile({ mapped: i.pulled, existing: i.ties });
  return [
    ...(i.autoCommitExact
      ? []
      : exact.map((e) => ({
          ...e.account,
          match: { kind: "exact", existingId: e.existingId } as const,
        }))),
    ...fresh.map((a) => ({ ...a, match: { kind: "new" } as const })),
  ];
}

/**
 * Updates or creates the client's ONE open review import from this provider
 * (re-syncing dedupes into it) and returns its id. It is always filed under
 * the connection's owner, on update too, whoever or whatever started the
 * sync: `requireImportAccess` lets only `created_by_user_id` open a review,
 * so a review owned by a colleague or a `system:` actor would sit unopenable.
 */
export async function upsertOpenReview(i: {
  clientId: string;
  firmId: string;
  scenarioId: string;
  providerId: SyncingProviderId;
  ownerUserId: string;
  accounts: ImportPayload["accounts"];
}): Promise<string> {
  const payloadJson = { payload: { ...emptyImportPayload(), accounts: i.accounts } };

  const [openReview] = await db
    .select({ id: clientImports.id })
    .from(clientImports)
    .where(
      and(
        eq(clientImports.clientId, i.clientId),
        eq(clientImports.origin, i.providerId),
        eq(clientImports.status, "review"),
      ),
    )
    .limit(1);

  if (openReview) {
    await db
      .update(clientImports)
      .set({ payloadJson, createdByUserId: i.ownerUserId, updatedAt: new Date() })
      .where(eq(clientImports.id, openReview.id));
    return openReview.id;
  }

  const [created] = await db
    .insert(clientImports)
    .values({
      clientId: i.clientId,
      orgId: i.firmId,
      scenarioId: i.scenarioId,
      mode: "updating",
      status: "review",
      createdByUserId: i.ownerUserId,
      origin: i.providerId,
      payloadJson,
    })
    .returning({ id: clientImports.id });
  return created.id;
}
