import { NextResponse } from "next/server";
import { db } from "@/db";
import { scenarios } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { loadMonteCarloData } from "@/lib/projection/load-monte-carlo-data";
import { ClientNotFoundError } from "@/lib/projection/load-client-data";
import { checkProjectionRateLimit, rateLimitErrorResponse } from "@/lib/rate-limit";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

// Fresh seed in the signed-int32 range — well within PostgreSQL's `integer` column.
function generateSeed(): number {
  return Math.floor(Math.random() * 0x7fffffff);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const firmId = await requireOrgId();

  const rl = await checkProjectionRateLimit(firmId);
  if (!rl.allowed) {
    return rateLimitErrorResponse(
      rl,
      "Too many projection requests. Please wait and try again.",
    );
  }

  const access = await verifyClientAccess(id);
  if (!access.ok) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  try {
    const payload = await loadMonteCarloData(id, access.firmId);
    return NextResponse.json(payload);
  } catch (err) {
    if (err instanceof ClientNotFoundError) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    throw err;
  }
}

/**
 * POST /api/clients/[id]/monte-carlo-data/reseed — overwrite the persisted
 * seed with a fresh one. Triggered by the report's "Restart" button
 * (PDF p.13 "Result Repeatability").
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgId();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (access.permission !== "edit") return NextResponse.json({ error: "View-only access" }, { status: 403 });

    const [scenario] = await db
      .select()
      .from(scenarios)
      .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));
    if (!scenario) return NextResponse.json({ error: "No base case scenario found" }, { status: 404 });

    const seed = generateSeed();
    await db.update(scenarios).set({ monteCarloSeed: seed }).where(eq(scenarios.id, scenario.id));
    return NextResponse.json({ seed });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/monte-carlo-data error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
