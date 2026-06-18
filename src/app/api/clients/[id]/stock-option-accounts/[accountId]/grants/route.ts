import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import {
  accounts,
  stockOptionGrants,
  stockOptionVestTranches,
  stockOptionPlannedEvents,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { grantCreateSchema } from "@/lib/schemas/stock-options";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Shared org-scope guard: verify client → account ownership and category.
// Returns { ok: true; firmId } on success, or { ok: false; response } on failure.
// ---------------------------------------------------------------------------
async function resolveAccountOrError(
  id: string,
  accountId: string,
): Promise<
  | { ok: true; firmId: string; permission: "view" | "edit" }
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

  return { ok: true, firmId, permission: access.permission };
}

// ---------------------------------------------------------------------------
// GET /api/clients/[id]/stock-option-accounts/[accountId]/grants
// Returns all grants for the account with nested tranches + plannedEvents.
// ---------------------------------------------------------------------------
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    const guard = await resolveAccountOrError(id, accountId);
    if (!guard.ok) return guard.response;

    // Fetch grants in creation order. (sortOrder is per-tranche; grant rows
    // aren't reorderable in v1, so createdAt is the honest, stable key.)
    const grants = await db
      .select()
      .from(stockOptionGrants)
      .where(eq(stockOptionGrants.accountId, accountId))
      .orderBy(stockOptionGrants.createdAt);

    // Fetch all tranches + events for this account's grants in bulk
    const grantIds = grants.map((g) => g.id);

    let trancheRows: (typeof stockOptionVestTranches.$inferSelect)[] = [];
    let eventRows: (typeof stockOptionPlannedEvents.$inferSelect)[] = [];

    if (grantIds.length > 0) {
      // inArray is guarded above against empty arrays (Drizzle rejects empty IN lists)
      trancheRows = await db
        .select()
        .from(stockOptionVestTranches)
        .where(inArray(stockOptionVestTranches.grantId, grantIds))
        .orderBy(stockOptionVestTranches.sortOrder);

      eventRows = await db
        .select()
        .from(stockOptionPlannedEvents)
        .where(inArray(stockOptionPlannedEvents.grantId, grantIds));
    }

    // Group tranches + events by grantId
    const tranchesByGrant = new Map<string, typeof trancheRows>();
    for (const t of trancheRows) {
      const arr = tranchesByGrant.get(t.grantId) ?? [];
      arr.push(t);
      tranchesByGrant.set(t.grantId, arr);
    }
    const eventsByGrant = new Map<string, typeof eventRows>();
    for (const e of eventRows) {
      const arr = eventsByGrant.get(e.grantId) ?? [];
      arr.push(e);
      eventsByGrant.set(e.grantId, arr);
    }

    const result = grants.map((g) => ({
      ...g,
      tranches: tranchesByGrant.get(g.id) ?? [],
      plannedEvents: eventsByGrant.get(g.id) ?? [],
    }));

    return NextResponse.json({ grants: result });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error(
      "GET /api/clients/[id]/stock-option-accounts/[accountId]/grants error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/clients/[id]/stock-option-accounts/[accountId]/grants
// Creates a grant + its tranches + planned events in one transaction.
// ---------------------------------------------------------------------------
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);
    const guard = await resolveAccountOrError(id, accountId);
    if (!guard.ok) return guard.response;

    const body = await request.json();
    const parsed = grantCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const input = parsed.data;

    const result = await db.transaction(async (tx) => {
      // 1. Insert the grant row.
      const [grant] = await tx
        .insert(stockOptionGrants)
        .values({
          accountId,
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
          sortOrder: 0,
        })
        .returning();

      // 2. Insert vest tranches (assign sortOrder by array index).
      const insertedTranches = input.tranches.length > 0
        ? await tx
            .insert(stockOptionVestTranches)
            .values(
              input.tranches.map((t, i) => ({
                grantId: grant.id,
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

      // 3. Insert planned events.
      // v1: planned events are grant-level; tranche targeting deferred.
      const insertedEvents = input.plannedEvents.length > 0
        ? await tx
            .insert(stockOptionPlannedEvents)
            .values(
              input.plannedEvents.map((e) => ({
                grantId: grant.id,
                trancheId: null,
                year: e.year,
                action: e.action,
                shares: e.shares != null ? String(e.shares) : null,
                pct: e.pct != null ? String(e.pct) : null,
              })),
            )
            .returning()
        : [];

      return { grant, tranches: insertedTranches, plannedEvents: insertedEvents };
    });

    await recordAudit({
      action: "account.stock_options.grant.create",
      resourceType: "stock_option_grant",
      resourceId: result.grant.id,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { accountId, grantType: input.grantType }),
    });

    return NextResponse.json(
      { ...result.grant, tranches: result.tranches, plannedEvents: result.plannedEvents },
      { status: 201 },
    );
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "POST /api/clients/[id]/stock-option-accounts/[accountId]/grants error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
