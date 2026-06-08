// src/app/api/clients/[id]/scenarios/[sid]/promote/route.ts
//
// POST /api/clients/[id]/scenarios/[sid]/promote
// Promotes scenario [sid] into the client's base case (see promoteScenarioToBase).
// Auth + scoping via assertScenarioRouteScope; the base case cannot be promoted
// into itself (400); a client with no base case yields 409.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { authErrorResponse } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { assertScenarioRouteScope } from "@/lib/scenario/route-scope";
import { promoteScenarioToBase, PromoteError } from "@/lib/scenario/promote-to-base";

export const dynamic = "force-dynamic";

const BODY = z.object({
  toggleState: z.record(z.string(), z.boolean()).default({}),
});

type RouteCtx = { params: Promise<{ id: string; sid: string }> };

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const firmId = await requireOrgId();
    const { id: clientId, sid: scenarioId } = await ctx.params;

    const scope = await assertScenarioRouteScope(clientId, scenarioId, firmId);
    if (scope.kind === "miss") return scope.response;
    if (scope.scenario.isBaseCase) {
      return NextResponse.json(
        { error: "Cannot promote the base case scenario" },
        { status: 400 },
      );
    }

    const parsed = BODY.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const userId = (await auth()).userId ?? "system";
    // The route may compute dates (engine/helper code must not).
    const dateLabel = new Date().toISOString().slice(0, 10);

    const result = await promoteScenarioToBase({
      clientId,
      firmId,
      scenarioId,
      scenarioName: scope.scenario.name,
      toggleState: parsed.data.toggleState,
      userId,
      dateLabel,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) return NextResponse.json(authResp.body, { status: authResp.status });
    if (err instanceof PromoteError && err.code === "no_base") {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    console.error("POST /api/clients/[id]/scenarios/[sid]/promote error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
