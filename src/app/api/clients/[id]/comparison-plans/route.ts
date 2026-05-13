import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireOrgId } from "@/lib/db-helpers";
import { authErrorResponse } from "@/lib/authz";
import { buildComparisonPlans } from "@/lib/comparison/build-comparison-plans";
import { loadProjectionForRef } from "@/lib/scenario/load-projection-for-ref";
import { loadPanelData } from "@/lib/scenario/load-panel-data";
import { loadAllocationForPlan } from "@/lib/comparison/load-allocation-for-plan";
import { buildYearlyEstateReport } from "@/lib/estate/yearly-estate-report";
import { buildYearlyLiquidityReport } from "@/lib/estate/yearly-liquidity-report";
import type { ScenarioRef } from "@/lib/scenario/loader";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  plans: z.array(z.string()).min(1),
});

function tokenToRef(tok: string): ScenarioRef {
  if (!tok || tok === "base") {
    return { kind: "scenario", id: "base", toggleState: {} };
  }
  if (tok.startsWith("snap:")) {
    return { kind: "snapshot", id: tok.slice("snap:".length), side: "left" };
  }
  return { kind: "scenario", id: tok, toggleState: {} };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;
    const [client] = await db
      .select({ id: clients.id })
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const body = BodySchema.parse(await req.json());
    const unique = Array.from(new Set(body.plans));

    const plans = await buildComparisonPlans({
      refs: unique.map(tokenToRef),
      loadProjection: (ref) => loadProjectionForRef(id, firmId, ref),
      loadPanel: async (ref, scenarioName) => {
        if (ref.kind !== "scenario" || ref.id === "base") return null;
        const data = await loadPanelData(id, ref.id, firmId);
        if (!data) return null;
        return { ...data, label: scenarioName };
      },
      loadAllocation: (loaded) =>
        loadAllocationForPlan({ clientId: id, firmId, loaded }),
      buildEstateRows: (l) => {
        const c = l.tree.client;
        return buildYearlyEstateReport({
          projection: l.result,
          clientData: l.tree,
          ordering: "primaryFirst",
          ownerNames: {
            clientName: `${c.firstName} ${c.lastName}`.trim(),
            spouseName: c.spouseName ?? null,
          },
          ownerDobs: { clientDob: c.dateOfBirth, spouseDob: c.spouseDob ?? null },
        });
      },
      buildLiquidityRows: (l) => {
        const c = l.tree.client;
        return buildYearlyLiquidityReport({
          projection: l.result,
          clientData: l.tree,
          ownerNames: {
            clientName: `${c.firstName} ${c.lastName}`.trim(),
            spouseName: c.spouseName ?? null,
          },
          ownerDobs: { clientDob: c.dateOfBirth, spouseDob: c.spouseDob ?? null },
        });
      },
    });

    return NextResponse.json({ plans });
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues }, { status: 400 });
    }
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    console.error("POST /api/clients/[id]/comparison-plans error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
