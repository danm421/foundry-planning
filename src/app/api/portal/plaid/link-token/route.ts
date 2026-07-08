import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { CountryCode, Products } from "plaid";
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
import { decrypt } from "@/lib/plaid/crypto";
import { redactPlaidError } from "@/lib/plaid/errors";
import { plaidWebhookUrl } from "@/lib/plaid/webhook-url";

export const dynamic = "force-dynamic";

type Body = { itemId?: string; enableProducts?: boolean; accountSelection?: boolean };

/**
 * OAuth banks redirect the whole browser tab out to the bank and back to a URL
 * registered in the Plaid dashboard. Only the production deployment is served on
 * that registered origin, so we send `redirect_uri` only there — on localhost /
 * preview it is omitted and the inline (non-OAuth) flow is unaffected. Gating on
 * the deployment env (not an inbound header) matches how the app URL is used
 * everywhere else. Registered value: https://app.foundryplanning.com/portal/oauth
 */
function oauthRedirectUri(): string | undefined {
  if (process.env.VERCEL_ENV !== "production") return undefined;
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.foundryplanning.com";
  return `${appUrl}/portal/oauth`;
}

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

    const redirectUri = oauthRedirectUri();

    const baseRequest = {
      user: { client_user_id: clientId },
      client_name: "Foundry Planning",
      country_codes: [CountryCode.Us],
      language: "en",
      // Sent only from the registered prod origin (see oauthRedirectUri); needed
      // for OAuth banks in both new-link and re-auth flows.
      ...(redirectUri ? { redirect_uri: redirectUri } : {}),
      // No products for update mode; only for new links.
    };

    const plaid = getPlaidClient();

    if (body.itemId) {
      // Update mode — re-auth flow for an expired item.
      const [item] = await db
        .select({
          accessToken: plaidItems.accessToken,
          clientId: plaidItems.clientId,
        })
        .from(plaidItems)
        .where(eq(plaidItems.id, body.itemId))
        .limit(1);
      if (!item || item.clientId !== clientId) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
      }
      const resp = await plaid.linkTokenCreate({
        ...baseRequest,
        access_token: decrypt(item.accessToken),
        ...(body.enableProducts
          ? { additional_consented_products: [Products.Transactions, Products.Liabilities] }
          : {}),
        ...(body.accountSelection ? { update: { account_selection_enabled: true } } : {}),
      });
      return NextResponse.json({
        linkToken: resp.data.link_token,
        expiration: resp.data.expiration,
      });
    }

    // New-link mode.
    const webhookUrl = plaidWebhookUrl();
    const resp = await plaid.linkTokenCreate({
      ...baseRequest,
      // Never request Auth: account/routing numbers are unused by the app and
      // Auth is not in our Plaid production approval — including it fails the
      // whole linkTokenCreate with INVALID_PRODUCT in production.
      //
      // Only Investments is *required*. Everything in `products` is a hard
      // filter: Link only shows institutions that support *every* listed
      // product, so requiring Transactions/Liabilities silently blocked
      // brokerages (Fidelity, etc.) with a "Connectivity not supported" screen —
      // they support Investments but not Transactions/Liabilities. Moving those
      // to required_if_supported_products keeps such institutions selectable and
      // still extracts (and bills) Transactions/Liabilities wherever supported.
      products: [Products.Investments],
      required_if_supported_products: [
        Products.Transactions,
        Products.Liabilities,
      ],
      // New items deliver webhooks from birth; existing items are backfilled
      // via scripts/backfill-plaid-webhooks.ts (itemWebhookUpdate).
      ...(webhookUrl ? { webhook: webhookUrl } : {}),
    });
    return NextResponse.json({
      linkToken: resp.data.link_token,
      expiration: resp.data.expiration,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/portal/plaid/link-token error:", redactPlaidError(err));
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
