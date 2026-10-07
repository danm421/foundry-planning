// src/app/api/portal/budgets/category/[id]/route.ts
//
// Read-only detail for one budget category: 24-month spend history, per-year
// metrics, and recent transactions. Powers the portal Budget detail panel.
// Uses resolvePortalClient (act-as aware) so advisor "preview as client" sees
// the same data as the client, less the transactions unless those are shared —
// identical resolution to the budget PUT route.
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalFeature } from "@/lib/portal/load-features";
import { requireAreaShared } from "@/lib/portal/privacy";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { loadCategoryDetail } from "@/lib/portal/load-category-detail";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalFeature(clientId, "budget");
    // Budget sharing covers the totals; the rows themselves are the client's
    // transaction feed, so an advisor gets them only when that is shared too.
    const { shareTransactions } = await requireAreaShared(mode, clientId, "budgets");
    await requirePortalActiveSubscription(clientId);

    const detail = await loadCategoryDetail(clientId, id, new Date(), {
      includeTransactions: shareTransactions,
    });
    if (!detail) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ detail });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
