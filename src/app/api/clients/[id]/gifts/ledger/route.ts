import { NextResponse } from "next/server";
import { ClientNotFoundError } from "@/lib/projection/load-client-data";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { verifyClientAccess } from "@/lib/clients/authz";
import { runProjectionWithEvents } from "@/engine/projection";
import { buildAnnualExclusionMap } from "@/lib/gifts/resolve-annual-exclusion";
import { computeExemptionSummary } from "@/lib/gifts/compute-exemption-summary";

export const dynamic = "force-dynamic";

// GET /api/clients/[id]/gifts/ledger — gift-tax exemption summary for the
// trust dialog's ExemptionPanel. Access-scoped via `verifyClientAccess` +
// `loadEffectiveTree` (loaded against the OWNING firm so cross-org shares
// resolve; the loader throws `ClientNotFoundError` on a firm mismatch).
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const access = await verifyClientAccess(id);
  if (!access.ok) {
    return NextResponse.json({ error: "Client not found" }, { status: 404 });
  }

  const url = new URL(req.url);
  const scenarioParam = url.searchParams.get("scenario");

  try {
    // Load the effective ClientData tree for (id, scenario). This is the same
    // firm-scoped loader the projection-data route uses; it does NOT run a
    // projection, so we run it below.
    const { effectiveTree: data } = await loadEffectiveTree(
      id,
      access.firmId,
      scenarioParam ?? "base",
      {},
    );

    const result = runProjectionWithEvents(data);

    // Rebuild the §2503(b) annual-exclusion map the SAME way the projection
    // does internally (same helper + inputs) so the per-trust exemption math
    // matches the ledger. `runProjectionWithEvents` consumes this map but does
    // not return it, so we recompute it here.
    const taxInflationRate =
      data.planSettings.taxInflationRate ?? data.planSettings.inflationRate ?? 0;
    const annualExclusionsByYear = buildAnnualExclusionMap(
      data.taxYearRows ?? [],
      data.planSettings.planStartYear,
      data.planSettings.planEndYear,
      taxInflationRate,
    );

    const summary = computeExemptionSummary({
      giftLedger: result.giftLedger,
      gifts: data.gifts ?? [],
      giftEvents: data.giftEvents ?? [],
      entities: data.entities ?? [],
      annualExclusionsByYear,
      taxInflationRate,
      lifetimeExemptionCap: data.planSettings.lifetimeExemptionCap ?? null,
      hasSpouse: data.client.spouseDob != null,
    });

    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof ClientNotFoundError) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    throw err;
  }
}
