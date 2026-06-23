// src/app/api/portal/budgets/category/[id]/route.ts
//
// Read-only detail for one budget category: 24-month spend history, per-year
// metrics, and recent transactions. Powers the portal Budget detail panel.
// Uses resolvePortalClient (act-as aware) so advisor "preview as client" sees
// the same data as the client — identical resolution to the budget PUT route.
import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { loadCategoryDetail } from "@/lib/portal/load-category-detail";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await params;
    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);

    const detail = await loadCategoryDetail(clientId, id, new Date());
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
