// src/lib/fact-finder/import-lifecycle.ts
// Creating and discarding a fact finder import, shared by the imports routes,
// Forge's plan builder and the Claude connector. Neither reads a Clerk session:
// the caller says who acts.
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { clientImportFiles, clientImports } from "@/db/schema";
import { recordAudit } from "@/lib/audit";
import { NotFoundError } from "@/lib/imports/authz";
import { noSavedFactFinder } from "@/lib/imports/saved-fact-finder";
import type { FactFinderScope } from "./persist";
import { factFinderImportSeed } from "./state";

export type ImportMode = (typeof clientImports.$inferInsert)["mode"];

/** A new draft fact finder import, and its `import.created` audit row. */
export async function createFactFinderImport(args: {
  clientId: string;
  firmId: string;
  /** The import's creator: only they can open it (`requireImportAccess`). */
  userId: string;
  scenarioId: string | null;
  mode: ImportMode;
  notes?: string | null;
  /** Who the audit row names, when not `userId`: an ops operator impersonating the advisor. */
  actorId?: string;
  /** Added to the audit row's metadata. */
  audit?: Record<string, unknown>;
}): Promise<typeof clientImports.$inferSelect> {
  // `origin` is deliberately omitted: it defaults to "extraction" in the schema.
  const [imp] = await db
    .insert(clientImports)
    .values({
      clientId: args.clientId,
      orgId: args.firmId,
      scenarioId: args.scenarioId,
      mode: args.mode,
      status: "draft",
      createdByUserId: args.userId,
      notes: args.notes,
      ...factFinderImportSeed(),
    })
    .returning();

  await recordAudit({
    action: "import.created",
    resourceType: "client_import",
    resourceId: imp.id,
    clientId: args.clientId,
    firmId: args.firmId,
    actorId: args.actorId ?? args.userId,
    metadata: { mode: args.mode, scenarioId: args.scenarioId, ...args.audit },
  });

  return imp;
}

/**
 * Discards an import and soft-deletes its files, all or nothing. A committed
 * import (a fact finder saved to the plan among them) is never discarded: it
 * answers "saved" and nothing changes. Without `actorId`, the audit row names
 * the session's actor.
 */
export async function discardImport(
  scope: FactFinderScope,
  actorId?: string,
): Promise<"discarded" | "already" | "saved"> {
  const { importId, clientId, firmId } = scope;
  const inScope = and(
    eq(clientImports.id, importId),
    eq(clientImports.clientId, clientId),
    eq(clientImports.orgId, firmId),
  );

  const [imp] = await db
    .select({ status: clientImports.status, discardedAt: clientImports.discardedAt })
    .from(clientImports)
    .where(inScope);
  if (!imp) throw new NotFoundError("Import not found");
  if (imp.status === "committed") return "saved";
  if (imp.discardedAt) return "already";

  // The file UPDATE is conditional on deletedAt IS NULL so it never clobbers
  // the tombstones of files deleted one by one earlier.
  const fileCountSoftDeleted = await db.transaction(async (tx) => {
    // Checked again at the write: a save or commit that lands while this UPDATE waits on the row's lock
    // leaves the import committed (a saved fact finder closed), and it stays that way.
    const [discarded] = await tx
      .update(clientImports)
      .set({ discardedAt: new Date(), status: "discarded" })
      .where(
        and(inScope, ne(clientImports.status, "committed"), isNull(clientImports.discardedAt), noSavedFactFinder),
      )
      .returning({ id: clientImports.id });
    if (!discarded) return null;

    const softDeleted = await tx
      .update(clientImportFiles)
      .set({ deletedAt: new Date() })
      .where(and(eq(clientImportFiles.importId, importId), isNull(clientImportFiles.deletedAt)))
      .returning({ id: clientImportFiles.id });

    return softDeleted.length;
  });
  if (fileCountSoftDeleted === null) return "saved";

  await recordAudit({
    action: "import.discarded",
    resourceType: "client_import",
    resourceId: importId,
    clientId,
    firmId,
    actorId,
    metadata: { fileCountSoftDeleted },
  });
  return "discarded";
}
