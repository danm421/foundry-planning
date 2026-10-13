import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { recordAudit } from "@/lib/audit";
import { brandChoiceSchema, householdBrand } from "@/lib/branding/brand-choice";
import { assertBrandChoiceAllowed } from "@/lib/branding/brand-options";

export const dynamic = "force-dynamic";

// @allow-firm-scope-exception — firm scoping is enforced by requireClientEditAccess(id),
// which verifies the client belongs to the caller's firm (or an edit share) before any
// write, and the UPDATE itself filters by that firmId. The literal grep doesn't see this.

/**
 * Set which brand a household sees — its portal and client PDFs — and where
 * intake sends and presentations for it start. Picking the household's own
 * advisor stores NULL ("follow the advisor"), so reassigning the household
 * later carries the brand with it rather than pinning the old advisor's.
 */
export async function PUT(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { id } = await ctx.params;
    const { client, firmId } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const body = (await req.json().catch(() => ({}))) as { brand?: unknown };
    const parsed = brandChoiceSchema.safeParse(body.brand);
    if (!parsed.success) {
      return NextResponse.json({ error: "brand must be a brand id" }, { status: 400 });
    }
    const next = parsed.data;

    // The household's own advisor is always allowed: it is the default.
    await assertBrandChoiceAllowed(firmId, next, client.advisorId);

    const before = householdBrand(client);
    await db
      .update(clients)
      .set({ brand: next === client.advisorId ? null : next })
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));

    await recordAudit({
      action: "client.brand.updated",
      resourceType: "client",
      resourceId: id,
      clientId: id,
      firmId,
      metadata: { from: before, to: next },
    });

    return NextResponse.json({ ok: true, brand: next });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/brand error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
