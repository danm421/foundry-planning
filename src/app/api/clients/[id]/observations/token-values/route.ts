import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { runProjectionWithEvents } from "@/engine/projection";
import { getOrComputeMonteCarlo } from "@/lib/compute-cache/monte-carlo";
import { resolveAllTokens } from "@/lib/plan-text/tokens";
import { ClientNotFoundError, ProjectionInputError } from "@/lib/projection/load-client-data";

export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireOrgId();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    // Scope data loads by the CLIENT's firm, not the caller's org — for
    // cross-org shared clients the two differ, and the effective tree /
    // MC cache live under the client's home firm.
    const firmId = access.firmId;

    const scenario = request.nextUrl.searchParams.get("scenario") ?? "base";

    const { effectiveTree } = await loadEffectiveTree(id, firmId, scenario, {});
    const projection = runProjectionWithEvents(effectiveTree);

    // Monte Carlo is best-effort here — a cache/compute failure shouldn't
    // block the rest of the token map. Never pass `trials`: the compute
    // cache dedupes on the canonical trial count.
    const cached = await getOrComputeMonteCarlo({
      clientId: id,
      firmId,
      scenarioId: scenario,
    }).catch(() => null);

    const values = resolveAllTokens({
      clientData: effectiveTree,
      projection,
      monteCarlo: cached?.payload.summary ?? null,
    });

    return NextResponse.json({ values });
  } catch (err) {
    if (err instanceof ClientNotFoundError) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (err instanceof ProjectionInputError) {
      return NextResponse.json(
        { error: "Client data is incomplete or invalid for this projection." },
        { status: 422 },
      );
    }
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/observations/token-values error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
