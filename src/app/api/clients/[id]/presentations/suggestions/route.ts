// The launcher's "Suggested reports": every report the chosen plan earns,
// scored and explained. The launcher picks the four to show — and re-picks on
// every deck change without asking again — so this answers once per plan.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { authErrorResponse } from "@/lib/authz";
import { loadPlanFacts } from "@/lib/presentations/suggestions/load-plan-facts";
import { scoreReports } from "@/lib/presentations/suggestions/score-reports";

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

    // "base" | "<scenarioId>" | "snap:<id>" — the scenario picker's own values.
    const plan = new URL(request.url).searchParams.get("plan") || "base";
    const facts = await loadPlanFacts(id, access.firmId, plan);
    return NextResponse.json({ suggestions: scoreReports(facts) });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/clients/[id]/presentations/suggestions failed", err);
    return NextResponse.json({ error: "Couldn't read this plan" }, { status: 500 });
  }
}
