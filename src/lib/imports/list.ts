import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db";
import {
  clientImports,
  clientImportFiles,
  clientImportExtractions,
} from "@/db/schema";

export type ImportListStatus =
  | "draft"
  | "extracting"
  | "review"
  | "committed"
  | "discarded";

export const IMPORT_LIST_STATUSES: readonly ImportListStatus[] = [
  "draft",
  "extracting",
  "review",
  "committed",
  "discarded",
];

export type ImportListRow = typeof clientImports.$inferSelect & {
  fileCount: number;
  extractionCount: number;
};

export interface ImportListResult {
  inProgress: ImportListRow[];
  completed: ImportListRow[];
  discarded: ImportListRow[];
}

/**
 * Shared list query used by GET /api/clients/[id]/imports and the
 * server-side drafts-list page. Keeping the shape in one place prevents
 * the route's response from drifting from what the page renders.
 *
 * - `statusFilter` narrows the underlying SELECT. Pass `undefined` for
 *   the default behavior (everything except discarded — the discarded
 *   bucket is only populated when the caller explicitly opts in via
 *   `includeDiscarded` or by passing `["discarded"]` here).
 * - `includeDiscarded` controls whether discarded rows appear in the
 *   `discarded` bucket of the result. Default is false (matches the
 *   API's "default GET excludes discarded" behavior).
 */
export async function listClientImports(args: {
  clientId: string;
  firmId: string;
  statusFilter?: ImportListStatus[];
  includeDiscarded?: boolean;
}): Promise<ImportListResult> {
  const { clientId, firmId, statusFilter, includeDiscarded = false } = args;

  const where = and(
    eq(clientImports.clientId, clientId),
    eq(clientImports.orgId, firmId),
    statusFilter ? inArray(clientImports.status, statusFilter) : undefined,
  );

  const rows = await db
    .select()
    .from(clientImports)
    .where(where)
    .orderBy(desc(clientImports.updatedAt));

  // Bypass count joins when there's nothing to count against — saves a
  // round-trip for clients with no imports.
  const importIds = rows.map((r) => r.id);
  const fileCountMap = new Map<string, number>();
  const extractionCountMap = new Map<string, number>();

  if (importIds.length > 0) {
    const fileCounts = await db
      .select({
        importId: clientImportFiles.importId,
        fileCount: count(clientImportFiles.id),
      })
      .from(clientImportFiles)
      .where(
        and(
          inArray(clientImportFiles.importId, importIds),
          isNull(clientImportFiles.deletedAt),
        ),
      )
      .groupBy(clientImportFiles.importId);

    for (const fc of fileCounts) {
      fileCountMap.set(fc.importId, Number(fc.fileCount));
    }

    const extractionCounts = await db
      .select({
        importId: clientImportFiles.importId,
        extractionCount: count(clientImportExtractions.id),
      })
      .from(clientImportExtractions)
      .innerJoin(
        clientImportFiles,
        eq(clientImportExtractions.fileId, clientImportFiles.id),
      )
      .where(
        and(
          inArray(clientImportFiles.importId, importIds),
          isNull(clientImportFiles.deletedAt),
        ),
      )
      .groupBy(clientImportFiles.importId);

    for (const ec of extractionCounts) {
      extractionCountMap.set(ec.importId, Number(ec.extractionCount));
    }
  }

  const decorate = (r: (typeof rows)[number]): ImportListRow => ({
    ...r,
    fileCount: fileCountMap.get(r.id) ?? 0,
    extractionCount: extractionCountMap.get(r.id) ?? 0,
  });

  return {
    inProgress: rows
      .filter(
        (r) =>
          r.status === "draft" ||
          r.status === "extracting" ||
          r.status === "review",
      )
      .map(decorate),
    completed: rows.filter((r) => r.status === "committed").map(decorate),
    discarded: includeDiscarded
      ? rows.filter((r) => r.status === "discarded").map(decorate)
      : [],
  };
}
