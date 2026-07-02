import { NextResponse } from "next/server";
import { db } from "@/db";
import { plaidItems } from "@/db/schema";
import { authErrorResponse } from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalActiveSubscription } from "@/lib/portal/require-portal-subscription";
import {
  checkPortalPlaidLinkRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { getPlaidClient } from "@/lib/plaid/client";
import { encrypt } from "@/lib/plaid/crypto";
import { mapPlaidAccount, loadLinkCandidates } from "@/lib/plaid/portal-link-helpers";

export const dynamic = "force-dynamic";

type Body = {
  publicToken?: string;
  institution?: { id?: string; name?: string };
};

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId } = await resolvePortalClient();
    await requirePortalActiveSubscription(clientId);
    await requireEditEnabled(clientId);

    const limit = await checkPortalPlaidLinkRateLimit(clientId);
    if (!limit.allowed) {
      return rateLimitErrorResponse(
        limit,
        "Too many link attempts. Try again in a bit.",
      );
    }

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

    // Manual accounts / liabilities the client could link to (no existing plaid_item_id).
    const { existingCandidates, existingLiabilityCandidates } =
      await loadLinkCandidates(clientId);

    return NextResponse.json({
      itemId: inserted.id,
      accounts: accountsResp.data.accounts.map(mapPlaidAccount),
      existingCandidates,
      existingLiabilityCandidates,
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
