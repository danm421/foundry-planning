import { NextRequest, NextResponse, after } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { requireOrgId } from "@/lib/db-helpers";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { warmComparisonCompute } from "@/lib/compute-cache/warm-comparison";

export const dynamic = "force-dynamic";
// Warming does the same MC + max-spend work a comparison run does, so give the
// after() job the same ceiling as runs/route.ts. It runs in the background; if
// it times out, the run just recomputes.
export const maxDuration = 800;

const BodySchema = z.object({
  scenarioId: z.string().min(1),
  targetPoS: z.number().min(0).max(1),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    await requireOrgId();
    const { firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    let json: unknown;
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = BodySchema.safeParse(json);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Prove the caller is authenticated (edit access already checked above).
    await auth();

    // Fire-and-forget: the cross-client/-org scenario id is rejected inside
    // getOrCompute* (loadEffectiveTree throws on an alien id), and every compute
    // is best-effort, so nothing here can leak or fail the caller.
    after(async () => {
      await warmComparisonCompute({
        clientId: id,
        firmId,
        scenarioId: parsed.data.scenarioId,
        targetPoS: parsed.data.targetPoS,
      });
    });

    return NextResponse.json({ ok: true }, { status: 202 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /clients/[id]/presentations/warm failed", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
