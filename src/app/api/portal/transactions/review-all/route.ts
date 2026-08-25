import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { plaidTransactions, clients } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalFeature } from "@/lib/portal/load-features";
import { requireAreaShared } from "@/lib/portal/privacy";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate } from "@/lib/audit/record-helpers";
import { toReviewWhere } from "@/lib/portal/to-review-queue";

export const dynamic = "force-dynamic";

/**
 * Marks every unreviewed transaction reviewed in one statement, on the shared
 * queue filter (see to-review-queue.ts) so the count clears to zero. The
 * mobile app's "mark all" button; the web tile pages through review-queue
 * instead, marking only rows the client has actually seen.
 */
export async function POST(): Promise<Response> {
  try {
    const { clientId, mode, clerkUserId } = await resolvePortalClient();
    await requirePortalFeature(clientId, "budget");
    await requireAreaShared(mode, clientId, "transactions");
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const [client] = await db
      .select({ firmId: clients.firmId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!client?.firmId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const updated = await db
      .update(plaidTransactions)
      .set({ reviewedAt: new Date(), reviewedBy: clerkUserId, updatedAt: new Date() })
      .where(toReviewWhere(clientId))
      .returning({ id: plaidTransactions.id });

    const count = updated.length;

    if (count > 0) {
      await recordUpdate({
        action: "portal.transaction.review_all",
        resourceType: "plaid_transaction",
        resourceId: clientId,
        clientId,
        firmId: client.firmId,
        actorKind: mode === "advisor" ? "advisor" : "client",
        extraMetadata: { count, ...(mode === "advisor" ? { viaPreview: true } : {}) },
        before: { reviewed: false },
        after: { reviewed: true },
        fieldLabels: { reviewed: { label: "Reviewed", format: "text" } },
      });
    }

    return NextResponse.json({ ok: true, count });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
