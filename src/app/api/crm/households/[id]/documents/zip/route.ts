import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import archiver from "archiver";
import { get } from "@vercel/blob";
import { db } from "@/db";
import { crmHouseholdDocuments, crmDocumentFolders } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireVaultAccess } from "@/lib/crm/authz";
import { resolveDocumentBlobPathname } from "@/lib/crm/documents";
import { collectFolderSubtreeIds } from "@/lib/crm/folder-tree";
import { authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";

// Node-runtime only: this route uses `node:stream` + `archiver`. Do not set
// `runtime = "edge"`. `force-dynamic` keeps it out of any static cache.
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_FILES = 200;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024; // 500 MB

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: householdId } = await params;
    const { orgId } = await requireVaultAccess(householdId);

    const folderParam = req.nextUrl.searchParams.get("folderId");
    const wholeVault = !folderParam || folderParam === "root";

    // Resolve which documents to include. Only current versions are zipped —
    // superseded plan versions stay out of the archive (collapse to current).
    let docs;
    if (wholeVault) {
      docs = await db.query.crmHouseholdDocuments.findMany({
        where: and(
          eq(crmHouseholdDocuments.householdId, householdId),
          eq(crmHouseholdDocuments.isCurrentVersion, true),
        ),
      });
    } else {
      const folders = await db
        .select({
          id: crmDocumentFolders.id,
          name: crmDocumentFolders.name,
          parentFolderId: crmDocumentFolders.parentFolderId,
          sortOrder: crmDocumentFolders.sortOrder,
        })
        .from(crmDocumentFolders)
        .where(eq(crmDocumentFolders.householdId, householdId));
      const subtree = collectFolderSubtreeIds(folders, folderParam);
      docs = subtree.length
        ? await db.query.crmHouseholdDocuments.findMany({
            where: and(
              eq(crmHouseholdDocuments.householdId, householdId),
              eq(crmHouseholdDocuments.isCurrentVersion, true),
              inArray(crmHouseholdDocuments.folderId, subtree),
            ),
          })
        : [];
    }

    if (docs.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Too many files to zip (${docs.length}); limit is ${MAX_FILES}. Download a smaller folder.` },
        { status: 413 },
      );
    }
    const totalBytes = docs.reduce((sum, d) => sum + (d.sizeBytes ?? 0), 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      return NextResponse.json(
        { error: `Folder is too large to zip (${Math.round(totalBytes / 1e6)} MB); limit is 500 MB.` },
        { status: 413 },
      );
    }

    await recordAudit({
      action: "vault.document.download",
      resourceType: "crm_document",
      resourceId: householdId,
      firmId: orgId,
      metadata: { householdId, kind: "zip", scope: wholeVault ? "vault" : folderParam, fileCount: docs.length },
    });

    const archive = archiver("zip", { zlib: { level: 6 } });
    const usedNames = new Set<string>();
    let skipped = 0;

    // Append each blob stream. Done sequentially to bound memory.
    (async () => {
      for (const doc of docs) {
        const pathname = await resolveDocumentBlobPathname(doc);
        if (!pathname) { skipped++; continue; }
        const blob = await get(pathname, { access: "private" });
        if (!blob || blob.statusCode !== 200 || !blob.stream) { skipped++; continue; }
        // De-dup entry names so two files with the same name don't collide.
        let name = doc.filename;
        for (let i = 2; usedNames.has(name); i++) {
          const dot = doc.filename.lastIndexOf(".");
          name = dot > 0
            ? `${doc.filename.slice(0, dot)} (${i})${doc.filename.slice(dot)}`
            : `${doc.filename} (${i})`;
        }
        usedNames.add(name);
        archive.append(Readable.fromWeb(blob.stream as never), { name });
      }
      if (skipped > 0) {
        console.warn(`[vault.zip] skipped ${skipped} unavailable/stale document(s)`);
      }
      await archive.finalize();
    })().catch((err) => archive.destroy(err));

    const webStream = Readable.toWeb(archive) as unknown as ReadableStream;
    return new Response(webStream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="vault-${householdId.slice(0, 8)}.zip"`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const authed = authErrorResponse(err);
    if (authed) return NextResponse.json(authed.body, { status: authed.status });
    const msg = err instanceof Error ? err.message : "error";
    if (/do not have access/i.test(msg)) return NextResponse.json({ error: msg }, { status: 403 });
    if (/not found/i.test(msg)) return NextResponse.json({ error: msg }, { status: 404 });
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
