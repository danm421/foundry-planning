import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clients, plaidItems } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { getPlaidClient } from "@/lib/plaid/client";
import { decrypt } from "@/lib/plaid/crypto";
import { redactPlaidError } from "@/lib/plaid/errors";
import { recordDelete } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);
    const { id } = await ctx.params;

    const [item] = await db
      .select({
        clientId: plaidItems.clientId,
        institutionName: plaidItems.institutionName,
        accessToken: plaidItems.accessToken,
        plaidItemId: plaidItems.plaidItemId,
      })
      .from(plaidItems)
      .where(eq(plaidItems.id, id))
      .limit(1);
    if (!item || item.clientId !== clientId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const [client] = await db
      .select({ firmId: clients.firmId })
      .from(clients)
      .where(eq(clients.id, clientId))
      .limit(1);
    if (!client) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const linked = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.plaidItemId, id))
      .limit(500);

    // Revoke at Plaid first. If Plaid revocation fails, surface the error
    // and leave DB state intact so the user can retry.
    try {
      const plaid = getPlaidClient();
      await plaid.itemRemove({ access_token: decrypt(item.accessToken) });
    } catch (err) {
      console.error("Plaid itemRemove failed:", redactPlaidError(err));
      return NextResponse.json(
        { error: "Failed to revoke Plaid access. Try again." },
        { status: 502 },
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({ plaidItemId: null, plaidAccountId: null })
        .where(eq(accounts.plaidItemId, id));
      await tx.delete(plaidItems).where(eq(plaidItems.id, id));
    });

    await recordDelete({
      action: "portal.plaid.unlink",
      resourceType: "plaid_item",
      resourceId: id,
      clientId,
      firmId: client.firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      snapshot: {
        institutionName: item.institutionName,
        detachedCount: linked.length,
      },
    });

    return NextResponse.json({ ok: true, detachedCount: linked.length });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("DELETE /api/portal/plaid/items/[id] error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
