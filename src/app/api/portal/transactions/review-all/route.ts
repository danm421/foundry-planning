import { NextResponse } from "next/server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/db";
import { plaidTransactions, clients } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requireAreaShared } from "@/lib/portal/privacy";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

/**
 * Marks every unreviewed transaction reviewed in one statement. The WHERE
 * mirrors the dashboard "to review" queue in load-dashboard.ts (non-excluded,
 * non-transfer, reviewedAt IS NULL) so the count clears to zero.
 */
export async function POST(): Promise<Response> {
  try {
    const { clientId, mode, clerkUserId } = await resolvePortalClient();
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
      .where(
        and(
          eq(plaidTransactions.clientId, clientId),
          eq(plaidTransactions.excluded, false),
          ne(plaidTransactions.type, "transfer"),
          isNull(plaidTransactions.reviewedAt),
        ),
      )
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
