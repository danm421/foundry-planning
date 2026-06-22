import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clients, liabilities, plaidItems } from "@/db/schema";
import {
  authErrorResponse,
  requireClientPortalAccess,
} from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import {
  checkPortalPlaidRefreshRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { fetchBalancesForItem } from "@/lib/plaid/refresh";
import { fetchLiabilitiesForItem } from "@/lib/plaid/liabilities-refresh";
import { recordCreate } from "@/lib/audit/record-helpers";

export const dynamic = "force-dynamic";

const REAUTH_CODES = new Set(["ITEM_LOGIN_REQUIRED", "PENDING_EXPIRATION"]);

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

    const limit = await checkPortalPlaidRefreshRateLimit(clientId, id);
    if (!limit.allowed) {
      return rateLimitErrorResponse(
        limit,
        "Too many refresh attempts. Try again in a bit.",
      );
    }

    // Load only accounts linked to this specific item (tenant-scoped by plaidItemId = item row id).
    const linked = await db
      .select({
        id: accounts.id,
        plaidAccountId: accounts.plaidAccountId,
        value: accounts.value,
      })
      .from(accounts)
      .where(eq(accounts.plaidItemId, id))
      .limit(500);

    const linkedIds = linked
      .map((a) => a.plaidAccountId!)
      .filter((s): s is string => Boolean(s));

    const refresh = await fetchBalancesForItem(
      { accessToken: item.accessToken },
      linkedIds,
    );

    if (!refresh.ok) {
      // Write the error code to the item row; do NOT audit.
      await db
        .update(plaidItems)
        .set({ lastRefreshError: refresh.errorCode })
        .where(eq(plaidItems.id, id));
      return NextResponse.json({
        ok: false,
        errorCode: refresh.errorCode,
        needsReauth: REAUTH_CODES.has(refresh.errorCode),
      });
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

    const updateByPlaid = new Map(
      refresh.updates.map((u: { plaidAccountId: string; newValue: string }) => [
        u.plaidAccountId,
        u.newValue,
      ]),
    );

    const beforeTotal = linked.reduce((s, a) => s + Number(a.value), 0);
    let afterTotal = 0;

    await db.transaction(async (tx) => {
      for (const a of linked) {
        if (!a.plaidAccountId) continue;
        const nv = updateByPlaid.get(a.plaidAccountId);
        if (nv == null) {
          afterTotal += Number(a.value);
          continue;
        }
        await tx
          .update(accounts)
          .set({ value: nv })
          .where(eq(accounts.id, a.id));
        afterTotal += Number(nv);
      }
      await tx
        .update(plaidItems)
        .set({ lastRefreshedAt: new Date(), lastRefreshError: null })
        .where(eq(plaidItems.id, id));
    });

    // Refresh liability metadata (statement balance, min payment, APR, due date).
    // Runs outside the balance transaction so a Plaid Liabilities-product error
    // cannot roll back the already-committed balance updates.
    try {
      const liabResult = await fetchLiabilitiesForItem({ accessToken: item.accessToken });
      if (liabResult.ok) {
        for (const u of liabResult.updates) {
          await db
            .update(liabilities)
            .set({
              balance: u.balance,
              statementBalance: u.statementBalance,
              minimumPayment: u.minimumPayment,
              aprPercentage: u.aprPercentage,
              nextPaymentDueDate: u.nextPaymentDueDate,
            })
            .where(
              and(
                eq(liabilities.plaidItemId, id),
                eq(liabilities.plaidAccountId, u.plaidAccountId),
              ),
            );
        }
      }
    } catch (e) {
      // Item may not carry the Liabilities product; balance refresh already succeeded.
      console.error("portal plaid liability refresh error:", e);
    }

    await recordCreate({
      action: "portal.plaid.refresh",
      resourceType: "plaid_item",
      resourceId: id,
      clientId,
      firmId: client.firmId,
      actorKind: "client",
      snapshot: {
        institutionName: item.institutionName,
        accountsRefreshed: refresh.updates.length,
        beforeTotal: beforeTotal.toFixed(2),
        afterTotal: afterTotal.toFixed(2),
      },
    });

    return NextResponse.json({
      ok: true,
      accountsRefreshed: refresh.updates.length,
      beforeTotal: beforeTotal.toFixed(2),
      afterTotal: afterTotal.toFixed(2),
    });
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
