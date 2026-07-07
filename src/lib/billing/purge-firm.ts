// src/lib/billing/purge-firm.ts
import { and, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { isFirmPurgeable } from "@/lib/billing/purge-eligibility";
import { del } from "@vercel/blob";
import { clerkClient } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  crmHouseholds,
  crmHouseholdDocuments,
  clients,
  clientImports,
  clientImportFiles,
  crmTasks,
  crmTaskFiles,
  crmTags,
  presentationTemplates,
  cmaSets,
  assetClasses,
  modelPortfolios,
  subscriptions,
  invoices,
  firms,
  cmaSettings,
  tickerPortfolios,
  staffAdvisorVisibility,
  orionOauthStates,
  orionSyncRuns,
  intakeForms,
  intakeEmailSettings,
  opsEntitlementOverrides,
  builtinTemplateDismissals,
  clientShares,
  planningKbChunks,
  forgeConversations,
} from "@/db/schema";
import { purgeCrmHouseholdById } from "@/lib/crm/households";
import { deleteImportFile } from "@/lib/imports/blob";
import { deleteBrandingAsset } from "@/lib/branding/blob";
import { getStripe } from "@/lib/billing/stripe-client";
import { recordAudit } from "@/lib/audit";

/** Thrown when purgeFirmById is asked to purge a firm that is not eligible
 *  (e.g. it resubscribed). The cron logs + skips it; data is preserved. */
export class FirmNotPurgeableError extends Error {
  constructor(firmId: string) {
    super(`firm ${firmId} is not eligible for purge`);
    this.name = "FirmNotPurgeableError";
  }
}

/**
 * Permanently purges one firm's PII once its retention window has elapsed.
 * Firm-agnostic so the cron can call it across firms. Honors the
 * privacy-policy deletion right (GDPR erasure) for both DB rows and the
 * Vercel Blob objects those rows reference.
 *
 *   0. Collect every Blob reference the purge touches BEFORE any DB delete —
 *      household-document keys (private), import-file pathnames (private),
 *      task-file keys (private), and the firm's branding URLs (public). The
 *      rows that hold these vanish during the cascades below, so we read
 *      them up front.
 *   1. Cascade-delete every household for the firm (drives planning clients +
 *      all CRM children, incl. crm_household_documents ROWS, via
 *      purgeCrmHouseholdById).
 *   2. Delete the firm's invoices + subscriptions mirror rows.
 *   3. Delete the remaining firm-scoped tables (CRM tasks/tags, presentation
 *      templates, CMA sets, asset classes, model portfolios). Their children
 *      cascade off the FK (crm_task_*, cma_set_values,
 *      model_portfolio_allocations, asset_class_correlations).
 *   4. Delete the Stripe customer + Clerk org (best-effort — already-gone OK).
 *   5. Delete the collected Blob objects (best-effort — each wrapped so a
 *      missing/already-deleted blob or transport error never aborts the purge
 *      or blocks the purgedAt stamp).
 *   6. Stamp purgedAt and NULL the firms row's PII/branding columns. The row
 *      itself is RETAINED as the purge record (auditor evidence the erasure
 *      ran); only PII/branding fields are nulled.
 *   7. Audit firm.purged.
 *
 * RETAINED tables (intentionally NOT deleted):
 *   - audit_log        SOC-2 7yr retention; the firm.purged record lands here.
 *   - billing_events   Stripe idempotency log; firmId is nullable.
 *   - tos_acceptances  GDPR proof-of-consent — legal evidence we must keep.
 *
 * Idempotent on retry: deletes on already-empty tables are no-ops; blob del
 * on an already-deleted object is swallowed; each run re-selects only the
 * rows that still remain.
 *
 * Steps 4-5 are wrapped so an external-system failure (e.g. Stripe customer
 * already deleted, a 404 from Blob) does not abort the local purge or the
 * purgedAt stamp.
 */
export async function purgeFirmById(firmId: string): Promise<void> {
  // 0. Collect every Blob reference BEFORE any DB row is deleted.

  // GUARD: re-validate eligibility at delete time (TOCTOU). One firms query
  // also carries branding URLs (read later) + a correlated live-subscription
  // count, so a resubscribed firm can never be purged even if its archive
  // stamp wasn't cleared.
  const firmRows = await db
    .select({
      logoUrl: firms.logoUrl,
      faviconUrl: firms.faviconUrl,
      archivedAt: firms.archivedAt,
      purgedAt: firms.purgedAt,
      dataRetentionUntil: firms.dataRetentionUntil,
      liveSubCount: sql<number>`(
        select count(*)::int from ${subscriptions}
        where ${subscriptions.firmId} = ${firms.firmId}
        and ${subscriptions.status} in ('trialing','active','past_due','unpaid')
      )`,
    })
    .from(firms)
    .where(eq(firms.firmId, firmId));
  const firm = firmRows[0];
  if (
    !firm ||
    !isFirmPurgeable(
      {
        archivedAt: firm.archivedAt,
        purgedAt: firm.purgedAt,
        dataRetentionUntil: firm.dataRetentionUntil,
        liveSubCount: Number(firm.liveSubCount ?? 0),
      },
      new Date(),
    )
  ) {
    throw new FirmNotPurgeableError(firmId);
  }

  // Household-document blobs (PRIVATE store). storageKey is null for
  // generated/import-ref docs; import_ref rows point at a shared import-file
  // blob (handled below) and own no blob themselves — mirror the guard in
  // lib/crm/documents.ts deleteCrmDocument.
  const householdDocRows = await db
    .select({
      storageKey: crmHouseholdDocuments.storageKey,
      sourceKind: crmHouseholdDocuments.sourceKind,
    })
    .from(crmHouseholdDocuments)
    .where(
      and(
        inArray(
          crmHouseholdDocuments.householdId,
          db.select({ id: crmHouseholds.id }).from(crmHouseholds).where(eq(crmHouseholds.firmId, firmId)),
        ),
        isNotNull(crmHouseholdDocuments.storageKey),
        ne(crmHouseholdDocuments.sourceKind, "import_ref"),
      ),
    );
  const householdDocKeys = householdDocRows
    .map((r) => r.storageKey)
    .filter((k): k is string => !!k);

  // Import-file blobs (PRIVATE store). The firm's clients own imports; the
  // shared import file is keyed by blobPathname.
  const importFileRows = await db
    .select({ blobPathname: clientImportFiles.blobPathname })
    .from(clientImportFiles)
    .where(
      inArray(
        clientImportFiles.importId,
        db
          .select({ id: clientImports.id })
          .from(clientImports)
          .where(
            inArray(
              clientImports.clientId,
              db.select({ id: clients.id }).from(clients).where(eq(clients.firmId, firmId)),
            ),
          ),
      ),
    );
  const importFilePathnames = importFileRows.map((r) => r.blobPathname).filter((p): p is string => !!p);

  // Task-file blobs (PRIVATE store). storageKey is a private pathname.
  const taskFileRows = await db
    .select({ storageKey: crmTaskFiles.storageKey })
    .from(crmTaskFiles)
    .where(
      inArray(
        crmTaskFiles.taskId,
        db.select({ id: crmTasks.id }).from(crmTasks).where(eq(crmTasks.firmId, firmId)),
      ),
    );
  const taskFileKeys = taskFileRows.map((r) => r.storageKey).filter((k): k is string => !!k);

  // Branding blobs (PUBLIC store) live on the firms row itself.
  const brandingUrls = [firmRows[0]?.logoUrl, firmRows[0]?.faviconUrl].filter(
    (u): u is string => !!u,
  );

  // 1. Households → planning clients → CRM children (incl. document rows).
  const households = await db
    .select({ id: crmHouseholds.id })
    .from(crmHouseholds)
    .where(eq(crmHouseholds.firmId, firmId));
  for (const h of households) {
    // force=true: a purged firm's households are live (not individually
    // trashed), so bypass the manual-delete "must be trashed first" guard.
    await purgeCrmHouseholdById(h.id, firmId, true);
  }

  // 2. Billing mirror rows.
  await db.delete(invoices).where(eq(invoices.firmId, firmId));

  const customerRows = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.firmId, firmId));
  const stripeCustomerId = customerRows[0]?.stripeCustomerId ?? null;

  await db.delete(subscriptions).where(eq(subscriptions.firmId, firmId));

  // 3. Remaining firm-scoped tables. Children cascade off the FK:
  //    crm_task_* (tags/comments/activity/files) ← crmTasks,
  //    cma_set_values ← cmaSets,
  //    model_portfolio_allocations ← modelPortfolios + assetClasses,
  //    asset_class_correlations ← assetClasses.
  await db.delete(crmTasks).where(eq(crmTasks.firmId, firmId));
  await db.delete(crmTags).where(eq(crmTags.firmId, firmId));
  await db.delete(presentationTemplates).where(eq(presentationTemplates.firmId, firmId));
  await db.delete(cmaSets).where(eq(cmaSets.firmId, firmId));
  await db.delete(assetClasses).where(eq(assetClasses.firmId, firmId));
  await db.delete(modelPortfolios).where(eq(modelPortfolios.firmId, firmId));

  // 3b. Firm-scoped tables that previously had no purge coverage (audit F2).
  //     Deleting by firm_id catches firm-level rows a client-cascade would miss:
  //     client_shares / planning_kb_chunks / forge_conversations have a NULLABLE
  //     client FK, so their share-all / firm-level / global-conversation rows
  //     survive the client cascade. orion_connections (encrypted tokens) is
  //     handled separately below with a vendor-scrub step.
  await db.delete(cmaSettings).where(eq(cmaSettings.firmId, firmId));
  await db.delete(tickerPortfolios).where(eq(tickerPortfolios.firmId, firmId));
  await db.delete(staffAdvisorVisibility).where(eq(staffAdvisorVisibility.firmId, firmId));
  await db.delete(orionOauthStates).where(eq(orionOauthStates.firmId, firmId));
  await db.delete(orionSyncRuns).where(eq(orionSyncRuns.firmId, firmId));
  await db.delete(intakeForms).where(eq(intakeForms.firmId, firmId));
  await db.delete(intakeEmailSettings).where(eq(intakeEmailSettings.firmId, firmId));
  await db.delete(opsEntitlementOverrides).where(eq(opsEntitlementOverrides.firmId, firmId));
  await db.delete(builtinTemplateDismissals).where(eq(builtinTemplateDismissals.firmId, firmId));
  await db.delete(clientShares).where(eq(clientShares.firmId, firmId));
  await db.delete(planningKbChunks).where(eq(planningKbChunks.firmId, firmId));
  await db.delete(forgeConversations).where(eq(forgeConversations.firmId, firmId));

  // 4. Stripe customer (best-effort).
  if (stripeCustomerId) {
    try {
      await getStripe().customers.del(stripeCustomerId);
    } catch (err) {
      console.error(`[purge-firm] stripe.customers.del failed for ${firmId}:`, err);
    }
  }

  // Clerk org (best-effort — org may already be gone).
  try {
    const cc = await clerkClient();
    await cc.organizations.deleteOrganization(firmId);
  } catch (err) {
    console.error(`[purge-firm] clerk deleteOrganization failed for ${firmId}:`, err);
  }

  // 5. Blob objects (best-effort — each wrapped so a 404/transport error
  //    never aborts the purge or blocks the purgedAt stamp).
  for (const key of householdDocKeys) {
    try {
      // PRIVATE store: no token.
      await del(key);
    } catch (err) {
      console.error(`[purge-firm] household-doc blob del failed (${firmId}):`, err);
    }
  }
  for (const pathname of importFilePathnames) {
    try {
      await deleteImportFile(pathname);
    } catch (err) {
      console.error(`[purge-firm] import-file blob del failed (${firmId}):`, err);
    }
  }
  for (const key of taskFileKeys) {
    try {
      // PRIVATE store: no token.
      await del(key);
    } catch (err) {
      console.error(`[purge-firm] task-file blob del failed (${firmId}):`, err);
    }
  }
  for (const url of brandingUrls) {
    try {
      await deleteBrandingAsset(url);
    } catch (err) {
      console.error(`[purge-firm] branding blob del failed (${firmId}):`, err);
    }
  }

  // 6. Stamp the firms row (retained as the purge record) and NULL its
  //    PII/branding columns. Never touch isFounder/createdAt/firmId.
  await db
    .update(firms)
    .set({
      purgedAt: new Date(),
      updatedAt: new Date(),
      logoUrl: null,
      faviconUrl: null,
      primaryColor: null,
      displayName: null,
    })
    .where(eq(firms.firmId, firmId));

  // 7. Audit.
  await recordAudit({
    action: "firm.purged",
    resourceType: "firm",
    resourceId: firmId,
    firmId,
    actorId: "system:purge-cron",
    metadata: { households: households.length, stripeCustomerDeleted: !!stripeCustomerId },
  });
}
