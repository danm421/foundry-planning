import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clients, liabilities, plaidItems } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { recordUpdate } from "@/lib/audit/record-helpers";
import type { FieldLabels } from "@/lib/audit/types";

export const dynamic = "force-dynamic";

const DETACH_FIELD_LABELS: FieldLabels = {
  plaidLink: { label: "Linked account", format: "text" },
};

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string; plaidAccountId: string }> },
): Promise<Response> {
  try {
    const { clientId, mode } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const { id, plaidAccountId } = await ctx.params;

    const [item] = await db
      .select({ clientId: plaidItems.clientId, institutionName: plaidItems.institutionName })
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
    if (!client) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const [acct] = await db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(
        and(
          eq(accounts.clientId, clientId),
          eq(accounts.plaidItemId, id),
          eq(accounts.plaidAccountId, plaidAccountId),
        ),
      )
      .limit(1);

    let detachedName: string | null = null;
    if (acct) {
      await db
        .update(accounts)
        .set({ plaidItemId: null, plaidAccountId: null })
        .where(eq(accounts.id, acct.id));
      detachedName = acct.name;
    } else {
      const [liab] = await db
        .select({ id: liabilities.id, name: liabilities.name })
        .from(liabilities)
        .where(
          and(
            eq(liabilities.clientId, clientId),
            eq(liabilities.plaidItemId, id),
            eq(liabilities.plaidAccountId, plaidAccountId),
          ),
        )
        .limit(1);
      if (!liab) return NextResponse.json({ error: "Not found" }, { status: 404 });
      await db
        .update(liabilities)
        .set({ plaidItemId: null, plaidAccountId: null })
        .where(eq(liabilities.id, liab.id));
      detachedName = liab.name;
    }

    await recordUpdate({
      action: "portal.plaid.account_detach",
      resourceType: "plaid_item",
      resourceId: id,
      clientId,
      firmId: client.firmId,
      actorKind: mode === "advisor" ? "advisor" : "client",
      extraMetadata: mode === "advisor" ? { viaPreview: true } : undefined,
      before: { plaidLink: detachedName },
      after: { plaidLink: null },
      fieldLabels: DETACH_FIELD_LABELS,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error(
      "DELETE /api/portal/plaid/items/[id]/accounts/[plaidAccountId] error:",
      err,
    );
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
