import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { loadRebalanceInputs } from "@/lib/investments/rebalance/load-inputs";
import { assembleRebalanceResult } from "@/lib/investments/rebalance/assemble";
import { UnclassifiableTickerError } from "@/lib/investments/rebalance/resolve-target";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    accountIds: z.array(z.string().uuid()).min(1),
    target: z.union([
      z.object({ portfolioId: z.string().uuid() }).strict(),
      z
        .object({
          holdings: z
            .array(
              z
                .object({ ticker: z.string().trim().min(1).max(32), weight: z.number().min(0).max(1) })
                .strict(),
            )
            .min(1),
        })
        .strict(),
    ]),
    overrideLtcgRate: z.number().min(0).max(1).optional(),
  })
  .strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const inputs = await loadRebalanceInputs(id, firmId, parsed.data);
    return NextResponse.json(assembleRebalanceResult(inputs));
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (err instanceof UnclassifiableTickerError) {
      return NextResponse.json(
        { error: err.message, unresolvedTickers: err.tickers },
        { status: 422 },
      );
    }
    console.error("POST /api/clients/[id]/rebalance/compute error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
