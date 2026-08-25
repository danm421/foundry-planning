import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { plaidTransactions, clients } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalFeature } from "@/lib/portal/load-features";
import { requireAreaShared } from "@/lib/portal/privacy";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate } from "@/lib/audit/record-helpers";
import { toReviewCount, toReviewPage, toReviewWhere } from "@/lib/portal/to-review-queue";

export const dynamic = "force-dynamic";

/** Guards a hand-built body and a runaway id list in one place. */
const MAX_IDS = 100;

/**
 * The dashboard's "Transactions to review" queue, one page at a time.
 *
 * GET  → the next page of rows plus the total still unreviewed.
 * POST → marks the ids the client actually saw, then hands back the next page
 *        and the new total, so the tile refills in the same round trip and the
 *        client keeps clicking until the backlog is empty. Contrast the
 *        review-all route (still the mobile app's clear-everything button),
 *        which clears rows the client never laid eyes on.
 */
export async function GET(): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalFeature(clientId, "budget");
    await requireAreaShared(mode, clientId, "transactions");
    await requirePortalActiveSubscription(clientId);

    const [items, count] = await Promise.all([
      toReviewPage(clientId),
      toReviewCount(clientId),
    ]);
    return NextResponse.json({ items, count });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId, mode, clerkUserId } = await resolvePortalClient();
    await requirePortalFeature(clientId, "budget");
    await requireAreaShared(mode, clientId, "transactions");
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
    const ids = Array.isArray(body?.ids)
      ? body.ids.filter((v): v is string => typeof v === "string" && v.length > 0)
      : [];
    if (ids.length === 0 || ids.length > MAX_IDS) {
      return NextResponse.json({ error: "ids required" }, { status: 400 });
    }

    const [client] = await db
      .select({ firmId: clients.firmId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!client?.firmId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // The queue filter carries the client scope, so an id belonging to another
    // client (or already reviewed) updates nothing rather than leaking a row.
    const updated = await db
      .update(plaidTransactions)
      .set({ reviewedAt: new Date(), reviewedBy: clerkUserId, updatedAt: new Date() })
      .where(and(toReviewWhere(clientId), inArray(plaidTransactions.id, ids)))
      .returning({ id: plaidTransactions.id });

    const marked = updated.length;

    if (marked > 0) {
      await recordUpdate({
        action: "portal.transaction.review_batch",
        resourceType: "plaid_transaction",
        resourceId: clientId,
        clientId,
        firmId: client.firmId,
        actorKind: mode === "advisor" ? "advisor" : "client",
        extraMetadata: { count: marked, ...(mode === "advisor" ? { viaPreview: true } : {}) },
        before: { reviewed: false },
        after: { reviewed: true },
        fieldLabels: { reviewed: { label: "Reviewed", format: "text" } },
      });
    }

    const [items, count] = await Promise.all([
      toReviewPage(clientId),
      toReviewCount(clientId),
    ]);
    return NextResponse.json({ ok: true, marked, items, count });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
