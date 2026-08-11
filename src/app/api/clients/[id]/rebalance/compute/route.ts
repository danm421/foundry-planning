import { NextResponse } from "next/server";
import { z } from "zod";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { loadRebalanceInputs } from "@/lib/investments/rebalance/load-inputs";
import { assembleRebalanceResult } from "@/lib/investments/rebalance/assemble";
import { UnclassifiableTickerError } from "@/lib/investments/rebalance/resolve-target";

export const dynamic = "force-dynamic";

const money = z.number().finite().min(0).max(1e12);

/** One position in an outside portfolio. Untickered rows (bonds, cash) carry a
 *  name instead; at least one of the two must identify the row. */
const adHocHoldingSchema = z
  .object({
    ticker: z.string().trim().max(32).optional(),
    name: z.string().trim().max(200).optional(),
    shares: z.number().finite().min(0).max(1e12).optional(),
    price: money.optional(),
    marketValue: money.optional(),
    costBasis: money.optional(),
  })
  .strict()
  .refine((h) => Boolean(h.ticker) || Boolean(h.name), {
    message: "Each holding needs a ticker or a name",
  });

// Shared across both source shapes. Spread rather than intersected: a `.strict()`
// object rejects keys it doesn't declare, so `z.object(...).strict().and(source)`
// would fail on `accountIds`/`adHoc` before the intersection ever resolved.
const commonFields = {
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
};

/** Current holdings come from the client's accounts OR an outside portfolio, never both. */
const bodySchema = z.union([
  z.object({ ...commonFields, accountIds: z.array(z.string().uuid()).min(1) }).strict(),
  z
    .object({
      ...commonFields,
      adHoc: z
        .object({
          taxable: z.boolean(),
          holdings: z.array(adHocHoldingSchema).min(1).max(500),
        })
        .strict(),
    })
    .strict(),
]);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireOrgId();
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const parsed = bodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
    }

    const inputs = await loadRebalanceInputs(id, access.firmId, parsed.data);
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
