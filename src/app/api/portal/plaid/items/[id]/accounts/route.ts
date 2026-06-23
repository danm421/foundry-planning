import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, liabilities, plaidItems } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import {
  checkPortalPlaidRefreshRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { getPlaidClient } from "@/lib/plaid/client";
import { decrypt } from "@/lib/plaid/crypto";
import { isReauthError } from "@/lib/plaid/errors";
import { mapPlaidAccount, loadLinkCandidates } from "@/lib/plaid/portal-link-helpers";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);

    const { id } = await ctx.params;

    const limit = await checkPortalPlaidRefreshRateLimit(clientId, id);
    if (!limit.allowed) {
      return rateLimitErrorResponse(limit, "Too many requests. Try again in a bit.");
    }

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

    const linkedAccounts = await db
      .select({
        id: accounts.id,
        name: accounts.name,
        value: accounts.value,
        plaidAccountId: accounts.plaidAccountId,
        mask: accounts.accountNumberLast4,
      })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), eq(accounts.plaidItemId, id)));

    const linkedLiabilities = await db
      .select({
        id: liabilities.id,
        name: liabilities.name,
        value: liabilities.balance,
        plaidAccountId: liabilities.plaidAccountId,
      })
      .from(liabilities)
      .where(and(eq(liabilities.clientId, clientId), eq(liabilities.plaidItemId, id)));

    const linked = [
      ...linkedAccounts.map((a) => ({
        id: a.id,
        kind: "account" as const,
        name: a.name,
        value: Number(a.value ?? 0),
        plaidAccountId: a.plaidAccountId!,
        mask: a.mask ?? null,
      })),
      ...linkedLiabilities.map((l) => ({
        id: l.id,
        kind: "liability" as const,
        name: l.name,
        value: Number(l.value ?? 0),
        plaidAccountId: l.plaidAccountId!,
        mask: null,
      })),
    ];
    const linkedSet = new Set(linked.map((r) => r.plaidAccountId));

    let available;
    try {
      const plaid = getPlaidClient();
      const resp = await plaid.accountsGet({ access_token: decrypt(item.accessToken) });
      available = resp.data.accounts
        .map(mapPlaidAccount)
        .filter((a) => !linkedSet.has(a.plaidAccountId));
    } catch (err) {
      if (isReauthError(err)) {
        return NextResponse.json({
          itemId: id,
          institutionName: item.institutionName,
          linked,
          available: [],
          existingCandidates: [],
          existingLiabilityCandidates: [],
          needsReauth: true,
        });
      }
      throw err;
    }

    const { existingCandidates, existingLiabilityCandidates } =
      await loadLinkCandidates(clientId);

    return NextResponse.json({
      itemId: id,
      institutionName: item.institutionName,
      linked,
      available,
      existingCandidates,
      existingLiabilityCandidates,
      needsReauth: false,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/portal/plaid/items/[id]/accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
