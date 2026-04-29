import { NextRequest, NextResponse } from "next/server";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import {
  clientImports,
  clientImportFiles,
  clientImportExtractions,
  clients,
  scenarios,
} from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// Mirrors importModeEnum / importStatusEnum in src/db/schema.ts. Drizzle
// pgEnum doesn't expose values to JS; if the schema enum changes, these
// literals must move with it.
const VALID_MODES = ["onboarding", "updating"] as const;
type ImportMode = (typeof VALID_MODES)[number];

const VALID_STATUSES = [
  "draft",
  "extracting",
  "review",
  "committed",
  "discarded",
] as const;
type ImportStatus = (typeof VALID_STATUSES)[number];

const NOTES_MAX_LENGTH = 2000;

type Params = { params: Promise<{ id: string }> };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) {
      // requireOrgId already verified userId, but TS doesn't know that.
      throw new UnauthorizedError();
    }
    const { id: clientId } = await params;

    // No rate limit on create — low-cardinality, advisor-driven, and the
    // upload/extract endpoints downstream cover the expensive paths.

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 },
      );
    }

    if (!isPlainObject(body)) {
      return NextResponse.json(
        { error: "Body must be an object" },
        { status: 400 },
      );
    }

    const { mode, scenarioId, notes } = body as {
      mode?: unknown;
      scenarioId?: unknown;
      notes?: unknown;
    };

    if (typeof mode !== "string" || !(VALID_MODES as readonly string[]).includes(mode)) {
      return NextResponse.json(
        { error: "Invalid or missing mode" },
        { status: 400 },
      );
    }
    const importMode = mode as ImportMode;

    if (scenarioId !== undefined && scenarioId !== null && typeof scenarioId !== "string") {
      return NextResponse.json(
        { error: "scenarioId must be a string" },
        { status: 400 },
      );
    }

    if (importMode === "updating" && !scenarioId) {
      return NextResponse.json(
        { error: "scenarioId required when mode is 'updating'" },
        { status: 400 },
      );
    }

    if (notes !== undefined && notes !== null && typeof notes !== "string") {
      return NextResponse.json(
        { error: "notes must be a string" },
        { status: 400 },
      );
    }

    if (typeof notes === "string" && notes.length > NOTES_MAX_LENGTH) {
      return NextResponse.json(
        { error: "notes_too_long" },
        { status: 400 },
      );
    }

    // Verify the client belongs to this firm before any insert. Inline
    // pattern (vs. requireImportAccess) because the import doesn't exist
    // yet — same shape used by the upload route's pre-checks.
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // Scenarios inherit client→firm scoping; the client check above
    // covers the firm boundary, so verifying clientId here is sufficient.
    if (typeof scenarioId === "string") {
      const [scenario] = await db
        .select({ id: scenarios.id })
        .from(scenarios)
        .where(
          and(eq(scenarios.id, scenarioId), eq(scenarios.clientId, clientId)),
        );
      if (!scenario) {
        return NextResponse.json(
          { error: "Scenario not found" },
          { status: 404 },
        );
      }
    }

    const [imp] = await db
      .insert(clientImports)
      .values({
        clientId,
        orgId: firmId,
        scenarioId: typeof scenarioId === "string" ? scenarioId : null,
        mode: importMode,
        status: "draft",
        createdByUserId: userId,
        notes: typeof notes === "string" ? notes : null,
      })
      .returning();

    await recordAudit({
      action: "import.created",
      resourceType: "client_import",
      resourceId: imp.id,
      clientId,
      firmId,
      metadata: {
        mode: importMode,
        scenarioId: typeof scenarioId === "string" ? scenarioId : null,
      },
    });

    return NextResponse.json({ import: imp }, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const safeMessage =
      err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error(
      "POST /api/clients/[id]/imports failed:",
      safeMessage,
    );
    return NextResponse.json(
      { error: "Failed to create import." },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    const firmId = await requireOrgId();
    const { userId } = await auth();
    if (!userId) {
      throw new UnauthorizedError();
    }
    const { id: clientId } = await params;

    const rl = await checkImportRateLimit(firmId, "view");
    if (!rl.allowed) {
      const status = rl.reason === "unconfigured" ? 503 : 429;
      const message =
        rl.reason === "unconfigured"
          ? "Rate limiting is not configured — import listing is disabled."
          : "Too many requests. Please wait and try again.";
      const headers: Record<string, string> = {};
      if (rl.reset) {
        headers["Retry-After"] = String(
          Math.max(1, Math.ceil((rl.reset - Date.now()) / 1000)),
        );
      }
      return NextResponse.json({ error: message }, { status, headers });
    }

    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    // ?status= can repeat; URLSearchParams.getAll preserves order. We
    // validate each value before passing into the query so an attacker
    // can't smuggle SQL via a malformed enum value.
    const url = new URL(request.url);
    const rawStatuses = url.searchParams.getAll("status");
    let statusFilter: ImportStatus[] | undefined;
    if (rawStatuses.length > 0) {
      const invalid = rawStatuses.find(
        (s) => !(VALID_STATUSES as readonly string[]).includes(s),
      );
      if (invalid !== undefined) {
        return NextResponse.json(
          { error: `Invalid status: ${invalid}` },
          { status: 400 },
        );
      }
      statusFilter = rawStatuses as ImportStatus[];
    }
    const explicitDiscardedRequested =
      statusFilter?.includes("discarded") ?? false;

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

    // Counts only over non-empty result set. We bypass the queries
    // entirely when there's nothing to join against — saves a round-trip
    // for clients with no imports.
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

      // Extractions live on files; group by file.import_id via join.
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

    const decorate = (r: (typeof rows)[number]) => ({
      ...r,
      fileCount: fileCountMap.get(r.id) ?? 0,
      extractionCount: extractionCountMap.get(r.id) ?? 0,
    });

    const inProgress = rows
      .filter(
        (r) =>
          r.status === "draft" ||
          r.status === "extracting" ||
          r.status === "review",
      )
      .map(decorate);
    const completed = rows
      .filter((r) => r.status === "committed")
      .map(decorate);
    // Default GET excludes discarded rows; only return them when the
    // caller explicitly asked for them via ?status=discarded. Without
    // this gate, soft-deleted imports would leak into the default list.
    const discarded = explicitDiscardedRequested
      ? rows.filter((r) => r.status === "discarded").map(decorate)
      : [];

    return NextResponse.json({ inProgress, completed, discarded });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const safeMessage =
      err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error(
      "GET /api/clients/[id]/imports failed:",
      safeMessage,
    );
    return NextResponse.json(
      { error: "Failed to list imports." },
      { status: 500 },
    );
  }
}
