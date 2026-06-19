// src/lib/orion/sync.ts
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { accounts, clientImports, orionSyncRuns, scenarios } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { resolveHoldingsForCommit } from "@/lib/imports/commit/holdings";
import { commitTabs } from "@/lib/imports/commit/orchestrator";
import { emptyImportPayload, type ImportPayload } from "@/lib/imports/types";
import { syncAccountFromHoldings } from "@/lib/investments/sync-account-from-holdings";

import { OrionClient } from "./client";
import { getConnection, setConnectionStatus } from "./connections";
import { getHouseholdLinks } from "./households";
import { mapOrionToImportPayload } from "./map";
import { reconcile } from "./reconcile";

/**
 * Orion → planning sync orchestrator. Reuses the document-import commit path
 * (`resolveHoldingsForCommit` → `commitTabs` → `syncAccountFromHoldings`) — it
 * never forks a second commit implementation.
 *
 * Per the product decision, accounts split into two buckets after reconciliation:
 *  - EXACT (already imported, matched by externalId): auto-commit / update in
 *    place via `commitTabs(['accounts'])`.
 *  - NEW (never-seen): land in a single open `clientImports` review row
 *    (`origin:'orion'`, `status:'review'`) for the advisor to review — Orion's
 *    category/subType is GUESSED from registrationType, so it must not hit the
 *    plan unreviewed. Re-syncing DEDUPES into one open review import per client.
 */
export async function syncFirm(
  firmId: string,
  opts: { trigger: "manual" | "cron"; clientId?: string; client?: OrionClient; userId?: string },
): Promise<{ committed: number; queued: number; importId?: string }> {
  const conn = await getConnection(firmId);
  if (!conn || conn.status === "disconnected") {
    throw new Error(`Orion is not connected for firm ${firmId}`);
  }

  // One resolved identity for ctx.userId, createdByUserId, AND every audit
  // actorId — guarantees recordAudit never falls back to Clerk auth() (works
  // in cron + tests). The route passes the real advisor id for manual syncs.
  const userId = opts.userId ?? "system:orion-sync";
  const client = opts.client ?? new OrionClient({ firmId });

  const [run] = await db
    .insert(orionSyncRuns)
    .values({ firmId, trigger: opts.trigger, status: "running" })
    .returning();

  let committed = 0;
  let queued = 0;
  let households = 0;
  let importId: string | undefined;

  try {
    let links = await getHouseholdLinks(firmId);
    if (opts.clientId) links = links.filter((l) => l.clientId === opts.clientId);

    for (const link of links) {
      try {
        // Resolve the client's base scenario — can't commit without one.
        const [scn] = await db
          .select({ id: scenarios.id })
          .from(scenarios)
          .where(and(eq(scenarios.clientId, link.clientId), eq(scenarios.isBaseCase, true)))
          .limit(1);
        if (!scn) {
          await recordAudit({
            action: "orion_sync.run",
            resourceType: "orion_household_link",
            resourceId: link.id,
            clientId: link.clientId,
            firmId,
            metadata: { error: "no base scenario" },
            actorId: userId,
          });
          continue;
        }

        const orionAccounts = await client.getAccounts(link.orionHouseholdId);
        const positionsByAccount = new Map(
          await Promise.all(
            orionAccounts.map(async (a) => [a.id, await client.getPositions(a.id)] as const),
          ),
        );

        const mapped = mapOrionToImportPayload(
          { id: link.orionHouseholdId, name: "" },
          orionAccounts,
          positionsByAccount,
        );

        const existing = await db
          .select({ id: accounts.id, externalId: accounts.externalId })
          .from(accounts)
          .where(and(eq(accounts.clientId, link.clientId), eq(accounts.externalProvider, "orion")));

        const { exact, new: fresh } = reconcile({ mapped: mapped.accounts, existing });

        // EXACT bucket → auto-commit / update in place via the commit path.
        if (exact.length > 0) {
          const exactPayload: ImportPayload = {
            ...emptyImportPayload(),
            accounts: exact.map((e) => ({
              ...e.account,
              match: { kind: "exact", existingId: e.existingId } as const,
            })),
          };
          const [vehicle] = await db
            .insert(clientImports)
            .values({
              clientId: link.clientId,
              orgId: firmId,
              scenarioId: scn.id,
              mode: "updating",
              status: "draft",
              createdByUserId: userId,
              origin: "orion",
              payloadJson: { payload: exactPayload },
            })
            .returning();

          const resolvedHoldings = await resolveHoldingsForCommit(exactPayload);
          const holdingsAccountIds: string[] = [];
          await commitTabs({
            importId: vehicle.id,
            payload: exactPayload,
            tabs: ["accounts"],
            ctx: {
              clientId: link.clientId,
              scenarioId: scn.id,
              orgId: firmId,
              userId,
              resolvedHoldings,
              holdingsAccountIds,
            },
          });
          await Promise.all(holdingsAccountIds.map(syncAccountFromHoldings));

          // Close out the vehicle import so it reads as a clean history row.
          await db
            .update(clientImports)
            .set({ status: "committed", committedAt: new Date() })
            .where(eq(clientImports.id, vehicle.id));

          committed += exact.length;
        }

        // NEW bucket → upsert ONE open review import per client (do NOT commit).
        if (fresh.length > 0) {
          const reviewPayload: ImportPayload = {
            ...emptyImportPayload(),
            accounts: fresh.map((a) => ({ ...a, match: { kind: "new" } as const })),
          };

          const [openReview] = await db
            .select({ id: clientImports.id })
            .from(clientImports)
            .where(
              and(
                eq(clientImports.clientId, link.clientId),
                eq(clientImports.origin, "orion"),
                eq(clientImports.status, "review"),
              ),
            )
            .limit(1);

          if (openReview) {
            await db
              .update(clientImports)
              .set({ payloadJson: { payload: reviewPayload }, updatedAt: new Date() })
              .where(eq(clientImports.id, openReview.id));
            importId = openReview.id;
          } else {
            const [created] = await db
              .insert(clientImports)
              .values({
                clientId: link.clientId,
                orgId: firmId,
                scenarioId: scn.id,
                mode: "updating",
                status: "review",
                createdByUserId: userId,
                origin: "orion",
                payloadJson: { payload: reviewPayload },
              })
              .returning();
            importId = created.id;
          }

          queued += fresh.length;
        }

        households += 1;
      } catch (err) {
        // Per-household isolation: one bad household can't abort the firm.
        await recordAudit({
          action: "orion_sync.run",
          resourceType: "orion_household_link",
          resourceId: link.id,
          clientId: link.clientId,
          firmId,
          metadata: { error: String(err) },
          actorId: userId,
        });
        continue;
      }
    }

    await db
      .update(orionSyncRuns)
      .set({
        status: "ok",
        householdsSynced: households,
        accountsCommitted: committed,
        accountsQueued: queued,
        finishedAt: new Date(),
      })
      .where(eq(orionSyncRuns.id, run.id));

    await setConnectionStatus(firmId, "connected", null, { lastSyncedAt: new Date() });

    await recordAudit({
      action: "orion_sync.run",
      resourceType: "orion_connection",
      resourceId: firmId,
      firmId,
      metadata: { trigger: opts.trigger, committed, queued, households },
      actorId: userId,
    });

    return { committed, queued, importId };
  } catch (err) {
    await db
      .update(orionSyncRuns)
      .set({ status: "error", error: String(err), finishedAt: new Date() })
      .where(eq(orionSyncRuns.id, run.id));
    throw err;
  }
}
