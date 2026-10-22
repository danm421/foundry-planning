// src/lib/integrations/sync.ts
import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { accounts, integrationSyncRuns, scenarios } from "@/db/schema";
import { recordAudit } from "@/lib/audit";

import { connectionCallContext } from "./auth";
import { buildReviewAccounts, commitProviderAccounts, upsertOpenReview } from "./commit";
import { loadConnection, setConnectionStatusById } from "./connections";
import { getLinksForConnection, recordLastPull } from "./households";
import { mapToImportPayload } from "./map";
import { reconcile } from "./reconcile";
import { getProvider } from "./registry";
import type { ProviderClient } from "./types";

/**
 * Provider → planning sync of ONE connection: it walks that connection's
 * household links (or the one client's, with `clientId`).
 *
 * Per the product decision, accounts split into two buckets after reconciliation:
 *  - EXACT (already imported, matched by externalId): auto-commit / update in
 *    place via `commitProviderAccounts` (the document-import commit path).
 *  - NEW (never-seen): land in a single open `clientImports` review row
 *    (`origin:<syncing providerId>`, `status:'review'`) for the advisor to
 *    review — the provider's category/subType is GUESSED from
 *    registrationType, so it must not hit the plan unreviewed. Re-syncing
 *    DEDUPES into one open review import per client.
 * Review-mode providers (autoCommitExact: false, e.g. Addepar) send both
 * buckets to the review. The review always belongs to the connection's owner.
 */
export async function syncConnection(
  connectionId: string,
  opts: {
    trigger: "manual" | "cron";
    clientId?: string;
    client?: ProviderClient;
    userId?: string;
  },
): Promise<{ committed: number; queued: number; importId?: string }> {
  const connection = await loadConnection(connectionId);
  if (!connection) throw new Error(`Integration connection ${connectionId} not found`);
  if (connection.status === "disconnected") {
    throw new Error(`Integration connection ${connectionId} is disconnected`);
  }
  const { firmId, providerId, ownerUserId } = connection;
  const provider = getProvider(providerId);
  if (providerId === "azure_openai" || !provider.syncs) {
    // A credentials-only provider (azure_openai) has no households to pull.
    // Reaching here means a caller routed a sync at the wrong provider.
    // Checking `providerId` here (not just `provider.syncs`) is what lets
    // TypeScript narrow it below `import_origin`'s narrower enum at every
    // `origin: providerId` write, without a cast.
    throw new Error("provider_does_not_sync");
  }
  if (!ownerUserId) {
    // Every review a sync files belongs to the connection's owner; with no
    // owner it would sit where nobody can open it.
    throw new Error(`Integration connection ${connectionId} has no owner`);
  }

  // One resolved identity for ctx.userId, the auto-commit's createdByUserId,
  // AND every audit actorId — guarantees recordAudit never falls back to
  // Clerk auth() (works in cron + tests). The route passes the real advisor id
  // for manual syncs. The REVIEW is filed under `ownerUserId` instead.
  const userId = opts.userId ?? `system:${providerId}-sync`;
  const client = opts.client ?? provider.client;
  const ctx = await connectionCallContext(connectionId);

  const [run] = await db
    .insert(integrationSyncRuns)
    .values({ firmId, provider: providerId, connectionId, trigger: opts.trigger, status: "running" })
    .returning();

  let committed = 0;
  let queued = 0;
  let households = 0;
  let importId: string | undefined;

  try {
    let links = await getLinksForConnection(connectionId);
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
            action: "integration.sync",
            resourceType: "integration_household_link",
            resourceId: link.id,
            clientId: link.clientId,
            firmId,
            metadata: { error: "no base scenario", provider: providerId, connectionId },
            actorId: userId,
          });
          continue;
        }

        const providerAccounts = await client.getAccounts(ctx, link.externalHouseholdId);
        const positionsByAccount = new Map(
          await Promise.all(
            providerAccounts.map(async (a) => [a.id, await client.getPositions(ctx, a.id)] as const),
          ),
        );

        const mapped = mapToImportPayload(
          providerId,
          provider.registrationTable,
          { id: link.externalHouseholdId, name: "" },
          providerAccounts,
          positionsByAccount,
        );
        // Stored before reconciling, so the snapshot survives a failed commit.
        await recordLastPull(link.id, mapped.accounts, new Date());

        // Scenario-scope to the same base scenario the EXACT update writes to
        // (commitAccounts' UPDATE filters on scenarioId). Without this, a stray
        // provider account under another scenario would classify as `exact` yet
        // the scenario-filtered update would touch 0 rows — a silent committed miscount.
        const existing = await db
          .select({ id: accounts.id, externalId: accounts.externalId })
          .from(accounts)
          .where(
            and(
              eq(accounts.clientId, link.clientId),
              eq(accounts.externalProvider, providerId),
              eq(accounts.scenarioId, scn.id),
            ),
          );

        // EXACT bucket → auto-commit / update in place via the commit path.
        if (provider.autoCommitExact) {
          const { exact } = reconcile({ mapped: mapped.accounts, existing });
          if (exact.length > 0) {
            await commitProviderAccounts({
              clientId: link.clientId,
              scenarioId: scn.id,
              firmId,
              userId,
              providerId,
              accounts: exact.map((e) => ({
                ...e.account,
                match: { kind: "exact", existingId: e.existingId } as const,
              })),
            });
            committed += exact.length;
          }
        }

        // Review bucket → upsert ONE open review import per client (do NOT
        // commit). For OAuth providers this is just the NEW accounts; for
        // review-mode providers it's exact + new together.
        const reviewAccounts = buildReviewAccounts({
          pulled: mapped.accounts,
          ties: existing,
          autoCommitExact: provider.autoCommitExact,
        });
        if (reviewAccounts.length > 0) {
          importId = await upsertOpenReview({
            clientId: link.clientId,
            firmId,
            scenarioId: scn.id,
            providerId,
            ownerUserId,
            accounts: reviewAccounts,
          });
          queued += reviewAccounts.length;
        }

        households += 1;
      } catch (err) {
        // Per-household isolation: one bad household can't abort the connection.
        await recordAudit({
          action: "integration.sync",
          resourceType: "integration_household_link",
          resourceId: link.id,
          clientId: link.clientId,
          firmId,
          metadata: { error: String(err), provider: providerId, connectionId },
          actorId: userId,
        });
        continue;
      }
    }

    await db
      .update(integrationSyncRuns)
      .set({
        status: "ok",
        householdsSynced: households,
        accountsCommitted: committed,
        accountsQueued: queued,
        finishedAt: new Date(),
      })
      .where(eq(integrationSyncRuns.id, run.id));

    await setConnectionStatusById(connectionId, "connected", null, { lastSyncedAt: new Date() });

    await recordAudit({
      action: "integration.sync",
      resourceType: "integration_connection",
      resourceId: connectionId,
      firmId,
      metadata: { trigger: opts.trigger, committed, queued, households, provider: providerId, connectionId },
      actorId: userId,
    });

    return { committed, queued, importId };
  } catch (err) {
    await db
      .update(integrationSyncRuns)
      .set({ status: "error", error: String(err), finishedAt: new Date() })
      .where(eq(integrationSyncRuns.id, run.id));
    throw err;
  }
}
