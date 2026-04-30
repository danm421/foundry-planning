import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { auth } from "@clerk/nextjs/server";
import { db } from "@/db";
import { clientImports, clients, scenarios } from "@/db/schema";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { checkImportRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/lib/audit";
import { listClientImports } from "@/lib/imports/list";

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
      let status: number;
      let message: string;
      switch (rl.reason) {
        case "unconfigured":
          status = 503;
          message = "Rate limiting is not configured — import listing is disabled.";
          break;
        case "redis_error":
          status = 503;
          message = "Rate limiting is temporarily unavailable. Please retry in a moment.";
          break;
        case "exceeded":
          status = 429;
          message = "Too many requests. Please wait and try again.";
          break;
      }
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

    const result = await listClientImports({
      clientId,
      firmId,
      statusFilter,
      includeDiscarded: explicitDiscardedRequested,
    });

    return NextResponse.json(result);
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
