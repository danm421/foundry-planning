import { randomUUID } from "node:crypto";
import { put } from "@vercel/blob";
import { db } from "@/db";
import {
  clients, crmHouseholdDocuments, crmDocumentFolders, scenarios,
} from "@/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { ensureSystemFolders } from "./folders";
import { recordAudit } from "@/lib/audit";

const SAFE_FILENAME_RE = /[^A-Za-z0-9._-]/g;
const DOT_RUN_RE = /\.{2,}/g;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sanitizeFilename(name: string): string {
  return name.replace(SAFE_FILENAME_RE, "_").replace(DOT_RUN_RE, "_");
}

export type SavePlanToVaultArgs = {
  clientId: string;
  firmId: string;
  reportType: string;
  scenarioId: string | null;
  filename: string;
  buffer: Buffer;
  uploadedBy?: string | null;
};

type DocRow = typeof crmHouseholdDocuments.$inferSelect;

/**
 * Best-effort: save a freshly-rendered report PDF into the household's Plans
 * folder as a versioned `generated_plan` row. NEVER throws — a vault failure
 * must not break the user's download. Returns the new row, or null on skip/fail.
 */
export async function savePlanToVault(
  args: SavePlanToVaultArgs,
): Promise<DocRow | null> {
  try {
    const [client] = await db
      .select({ crmHouseholdId: clients.crmHouseholdId })
      .from(clients)
      .where(and(eq(clients.id, args.clientId), eq(clients.firmId, args.firmId)));
    if (!client?.crmHouseholdId) return null;
    const householdId = client.crmHouseholdId;

    // FK-safe scenario: only keep a real scenarios.id for this client.
    let scenarioId: string | null = null;
    if (args.scenarioId && UUID_RE.test(args.scenarioId)) {
      const sc = await db.query.scenarios.findFirst({
        where: and(eq(scenarios.id, args.scenarioId), eq(scenarios.clientId, args.clientId)),
        columns: { id: true },
      });
      scenarioId = sc?.id ?? null;
    }

    await ensureSystemFolders(householdId, args.firmId);
    const plansFolder = await db.query.crmDocumentFolders.findFirst({
      where: and(
        eq(crmDocumentFolders.householdId, householdId),
        eq(crmDocumentFolders.isSystem, true),
        eq(crmDocumentFolders.name, "Plans"),
      ),
      columns: { id: true },
    });

    const safe = sanitizeFilename(args.filename || `${args.reportType}.pdf`);
    const storageKey = `crm/${householdId}/plans/${Date.now()}-${randomUUID()}-${safe}`;
    const result = await put(storageKey, args.buffer, {
      access: "private",
      addRandomSuffix: false,
    });

    const scenarioMatch = scenarioId
      ? eq(crmHouseholdDocuments.scenarioId, scenarioId)
      : isNull(crmHouseholdDocuments.scenarioId);
    const current = await db.query.crmHouseholdDocuments.findFirst({
      where: and(
        eq(crmHouseholdDocuments.householdId, householdId),
        eq(crmHouseholdDocuments.sourceKind, "generated_plan"),
        eq(crmHouseholdDocuments.reportType, args.reportType),
        scenarioMatch,
        eq(crmHouseholdDocuments.isCurrentVersion, true),
      ),
    });

    const row = await db.transaction(async (tx) => {
      let versionGroupId: string;
      let versionNo: number;
      if (current) {
        versionGroupId = current.versionGroupId ?? randomUUID();
        versionNo = current.versionNo + 1;
        await tx
          .update(crmHouseholdDocuments)
          .set({ isCurrentVersion: false })
          .where(eq(crmHouseholdDocuments.id, current.id));
      } else {
        versionGroupId = randomUUID();
        versionNo = 1;
      }
      const [inserted] = await tx
        .insert(crmHouseholdDocuments)
        .values({
          householdId,
          filename: args.filename,
          storageProvider: "vercel-blob",
          storageKey: result.pathname,
          mimeType: "application/pdf",
          sizeBytes: args.buffer.byteLength,
          uploadedBy: args.uploadedBy ?? null,
          folderId: plansFolder?.id ?? null,
          sourceKind: "generated_plan",
          reportType: args.reportType,
          scenarioId,
          versionGroupId,
          versionNo,
          isCurrentVersion: true,
        })
        .returning();
      return inserted;
    });

    await recordAudit({
      action: "vault.document.version_added",
      resourceType: "crm_document",
      resourceId: row.id,
      clientId: args.clientId,
      firmId: args.firmId,
      metadata: { reportType: args.reportType, scenarioId, versionNo: row.versionNo },
    });
    return row;
  } catch (err) {
    const msg = err instanceof Error ? err.message.slice(0, 200) : "unknown";
    console.error("[vault-plans] savePlanToVault failed (non-fatal):", msg);
    return null;
  }
}
