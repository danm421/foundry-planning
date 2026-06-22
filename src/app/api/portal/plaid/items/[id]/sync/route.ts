import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, plaidItems } from "@/db/schema";
import { authErrorResponse, requireClientPortalAccess } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import {
  checkPortalPlaidRefreshRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { syncTransactionsForItem } from "@/lib/plaid/transactions-sync";
import { recordCreate } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;

    // Verify the item exists and belongs to the bound client (tenant safety).
    const [item] = await db
      .select({
        id: plaidItems.id,
        clientId: plaidItems.clientId,
        accessToken: plaidItems.accessToken,
        transactionsCursor: plaidItems.transactionsCursor,
      })
      .from(plaidItems)
      .where(eq(plaidItems.id, id))
      .limit(1);
    if (!item || item.clientId !== clientId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const limit = await checkPortalPlaidRefreshRateLimit(clientId, id);
    if (!limit.allowed) {
      return rateLimitErrorResponse(
        limit,
        "Too many sync attempts. Try again in a bit.",
      );
    }

    const result = await syncTransactionsForItem(item);
    if (!result.ok) {
      // Persist the error to the item row; surface re-auth status to the client.
      await db
        .update(plaidItems)
        .set({ lastRefreshError: result.errorMessage })
        .where(eq(plaidItems.id, id));
      return NextResponse.json(
        { error: result.errorMessage, errorCode: result.errorCode },
        { status: result.errorCode === "ITEM_LOGIN_REQUIRED" ? 409 : 502 },
      );
    }

    // Resolve firmId for the audit record.
    const [client] = await db
      .select({ firmId: clients.firmId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await recordCreate({
      action: "portal.plaid.sync",
      resourceType: "plaid_item",
      resourceId: id,
      clientId,
      firmId: client.firmId,
      actorKind: "client",
      snapshot: {
        added: result.added,
        modified: result.modified,
        removed: result.removed,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/portal/plaid/items/[id]/sync error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
