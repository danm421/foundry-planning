import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { clients, plaidItems } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import {
  checkPortalPlaidRefreshRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { refreshPlaidItemData } from "@/lib/plaid/refresh-item-data";
import { recordCreate } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;

    // Verify the item exists and belongs to the bound client (tenant safety).
    const [item] = await db
      .select({
        clientId: plaidItems.clientId,
        institutionName: plaidItems.institutionName,
        accessToken: plaidItems.accessToken,
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
        "Too many refresh attempts. Try again in a bit.",
      );
    }

    const result = await refreshPlaidItemData({ id, accessToken: item.accessToken });
    if (!result.ok) {
      // refreshPlaidItemData already persisted the error code; do NOT audit.
      return NextResponse.json(result);
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
      action: "portal.plaid.refresh",
      resourceType: "plaid_item",
      resourceId: id,
      clientId,
      firmId: client.firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      snapshot: {
        institutionName: item.institutionName,
        accountsRefreshed: result.accountsRefreshed,
        beforeTotal: result.beforeTotal,
        afterTotal: result.afterTotal,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/portal/plaid/items/[id]/refresh error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
