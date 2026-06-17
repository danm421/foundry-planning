import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import {
  accounts,
  stockOptionGrants,
  stockOptionVestTranches,
  stockOptionPlannedEvents,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { grantUpdateSchema } from "@/lib/schemas/stock-options";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Shared org-scope guard: verify client → account → grant ownership.
// Returns { firmId, grant } on success, or a NextResponse on failure.
// ---------------------------------------------------------------------------
async function resolveGrantOrError(
  id: string,
  accountId: string,
  grantId: string,
): Promise<
  | { ok: true; firmId: string; grant: typeof stockOptionGrants.$inferSelect }
  | { ok: false; response: NextResponse }
> {
  const firmId = await requireOrgId();

  const access = await verifyClientAccess(id);
  if (!access.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Client not found" }, { status: 404 }),
    };
  }
  if (access.permission !== "edit") {
    return {
      ok: false,
      response: NextResponse.json({ error: "View-only access" }, { status: 403 }),
    };
  }

  const [account] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.clientId, id),
        eq(accounts.category, "stock_options"),
      ),
    );
  if (!account) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Account not found" }, { status: 404 }),
    };
  }

  const [grant] = await db
    .select()
    .from(stockOptionGrants)
    .where(
      and(eq(stockOptionGrants.id, grantId), eq(stockOptionGrants.accountId, accountId)),
    );
  if (!grant) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Grant not found" }, { status: 404 }),
    };
  }

  return { ok: true, firmId, grant };
}

// ---------------------------------------------------------------------------
// PUT /api/clients/[id]/stock-option-accounts/[accountId]/grants/[grantId]
// Full replacement of grant fields + tranches + planned events in one transaction.
// ---------------------------------------------------------------------------
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string; grantId: string }> },
) {
  try {
    const { id, accountId, grantId } = await params;
    const guard = await resolveGrantOrError(id, accountId, grantId);
    if (!guard.ok) return guard.response;
    const { firmId } = guard;

    const body = await request.json();
    const parsed = grantUpdateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const result = await db.transaction(async (tx) => {
      // 1. Update grant row fields.
      const [updatedGrant] = await tx
        .update(stockOptionGrants)
        .set({
          grantNumber: input.grantNumber ?? null,
          grantType: input.grantType,
          grantDate: input.grantDate,
          sharesGranted: String(input.sharesGranted),
          has83bElection: input.has83bElection,
          fmvAtGrant: input.fmvAtGrant != null ? String(input.fmvAtGrant) : null,
          strikePrice: input.strikePrice != null ? String(input.strikePrice) : null,
          strikeDiscountPct:
            input.strikeDiscountPct != null ? String(input.strikeDiscountPct) : null,
          expirationDate: input.expirationDate ?? null,
          exerciseTiming: input.exerciseTiming ?? null,
          exerciseYear: input.exerciseYear ?? null,
          sellTiming: input.sellTiming ?? null,
          sellYear: input.sellYear ?? null,
          sellPercentPerYear:
            input.sellPercentPerYear != null ? String(input.sellPercentPerYear) : null,
          sellStartYear: input.sellStartYear ?? null,
          notes: input.notes ?? null,
          updatedAt: new Date(),
        })
        .where(and(eq(stockOptionGrants.id, grantId), eq(stockOptionGrants.accountId, accountId)))
        .returning();
      // The guard already confirmed the row exists; this narrows the type and
      // guards against a silent no-op if the guard logic ever drifts.
      if (!updatedGrant) throw new Error("Grant update failed — row not found");

      // 2. Replace tranches: delete existing, reinsert from input.
      await tx.delete(stockOptionVestTranches).where(eq(stockOptionVestTranches.grantId, grantId));
      const insertedTranches = input.tranches.length > 0
        ? await tx
            .insert(stockOptionVestTranches)
            .values(
              input.tranches.map((t, i) => ({
                grantId,
                vestDate: t.vestDate,
                shares: String(t.shares),
                sharesExercised: String(t.sharesExercised),
                sharesSold: String(t.sharesSold),
                exerciseTiming: t.exerciseTiming ?? null,
                exerciseYear: t.exerciseYear ?? null,
                sellTiming: t.sellTiming ?? null,
                sellYear: t.sellYear ?? null,
                sellPercentPerYear:
                  t.sellPercentPerYear != null ? String(t.sellPercentPerYear) : null,
                sellStartYear: t.sellStartYear ?? null,
                sortOrder: i,
              })),
            )
            .returning()
        : [];

      // 3. Replace planned events: delete existing, reinsert from input.
      // v1: planned events are grant-level; tranche targeting deferred.
      await tx.delete(stockOptionPlannedEvents).where(eq(stockOptionPlannedEvents.grantId, grantId));
      const insertedEvents = input.plannedEvents.length > 0
        ? await tx
            .insert(stockOptionPlannedEvents)
            .values(
              input.plannedEvents.map((e) => ({
                grantId,
                trancheId: null,
                year: e.year,
                action: e.action,
                shares: e.shares != null ? String(e.shares) : null,
                pct: e.pct != null ? String(e.pct) : null,
              })),
            )
            .returning()
        : [];

      return { grant: updatedGrant, tranches: insertedTranches, plannedEvents: insertedEvents };
    });

    await recordAudit({
      action: "account.stock_options.grant.update",
      resourceType: "stock_option_grant",
      resourceId: grantId,
      clientId: id,
      firmId,
      metadata: { accountId, grantType: input.grantType },
    });

    return NextResponse.json({
      ...result.grant,
      tranches: result.tranches,
      plannedEvents: result.plannedEvents,
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "PUT /api/clients/[id]/stock-option-accounts/[accountId]/grants/[grantId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/clients/[id]/stock-option-accounts/[accountId]/grants/[grantId]
// Deletes the grant; FK cascades remove tranches + planned events.
// ---------------------------------------------------------------------------
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string; grantId: string }> },
) {
  try {
    const { id, accountId, grantId } = await params;
    const guard = await resolveGrantOrError(id, accountId, grantId);
    if (!guard.ok) return guard.response;
    const { firmId, grant } = guard;

    await db
      .delete(stockOptionGrants)
      .where(and(eq(stockOptionGrants.id, grantId), eq(stockOptionGrants.accountId, accountId)));

    await recordAudit({
      action: "account.stock_options.grant.delete",
      resourceType: "stock_option_grant",
      resourceId: grantId,
      clientId: id,
      firmId,
      metadata: { accountId, grantType: grant.grantType },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "DELETE /api/clients/[id]/stock-option-accounts/[accountId]/grants/[grantId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
