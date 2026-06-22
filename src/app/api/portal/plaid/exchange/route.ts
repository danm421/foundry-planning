import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { accounts, liabilities, plaidItems } from "@/db/schema";
import {
  authErrorResponse,
  requireClientPortalAccess,
} from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import { getPlaidClient } from "@/lib/plaid/client";
import { encrypt } from "@/lib/plaid/crypto";

export const dynamic = "force-dynamic";

type Body = {
  publicToken?: string;
  institution?: { id?: string; name?: string };
};

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body.publicToken) {
      return NextResponse.json(
        { error: "publicToken required" },
        { status: 400 },
      );
    }

    const plaid = getPlaidClient();
    const exchange = await plaid.itemPublicTokenExchange({
      public_token: body.publicToken,
    });
    const { access_token, item_id } = exchange.data;

    const accountsResp = await plaid.accountsGet({ access_token });

    const [inserted] = await db
      .insert(plaidItems)
      .values({
        clientId,
        plaidItemId: item_id,
        accessToken: encrypt(access_token),
        institutionId: body.institution?.id ?? null,
        institutionName: body.institution?.name ?? null,
      })
      .returning();

    // Manual accounts the client could link to (no existing plaid_item_id).
    const candidates = await db
      .select({
        id: accounts.id,
        name: accounts.name,
        category: accounts.category,
        subType: accounts.subType,
      })
      .from(accounts)
      .where(and(eq(accounts.clientId, clientId), isNull(accounts.plaidItemId)))
      .orderBy(accounts.name);

    // Advisor-entered liabilities the client could attach a Plaid debt to.
    const liabilityCandidates = await db
      .select({
        id: liabilities.id,
        name: liabilities.name,
        liabilityType: liabilities.liabilityType,
        balance: liabilities.balance,
      })
      .from(liabilities)
      .where(and(eq(liabilities.clientId, clientId), isNull(liabilities.plaidItemId)))
      .orderBy(liabilities.name);

    return NextResponse.json({
      itemId: inserted.id,
      accounts: accountsResp.data.accounts.map((a) => ({
        plaidAccountId: a.account_id,
        name: a.official_name ?? a.name,
        mask: a.mask,
        type: a.type,
        subtype: a.subtype,
        balance: a.balances.current,
      })),
      existingCandidates: candidates,
      existingLiabilityCandidates: liabilityCandidates,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/portal/plaid/exchange error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
