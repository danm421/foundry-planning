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
import type { LinkScope } from "@/lib/portal/contracts";

export const dynamic = "force-dynamic";

const LINK_SCOPES: readonly string[] = ["banking", "investments"];

type Body = {
  itemId?: string;
  enableProducts?: boolean;
  accountSelection?: boolean;
  scope?: LinkScope;
};

/**
 * Products for a new link, given what the client says it is connecting.
 *
 * Only ever require the one product that matches the scope; everything else
 * rides along in `required_if_supported_products`, which is extracted (and
 * billed) wherever supported and never blocks Link. Plaid's compatibility
 * matrix is why this has to be a choice at all:
 *
 *   Investments  — investment accounts, and no depository subtype but cash
 *                  management. Excludes credit and loan entirely.
 *   Transactions — depository, credit, loan (student/mortgage) and other.
 *                  Excludes investment accounts entirely.
 *
 * So requiring Investments dead-ends a client linking a card or a loan ("None
 * of your accounts are investment accounts"), and requiring Transactions
 * dead-ends a brokerage- or IRA-only link. Plaid rejects an empty `products`
 * array, and Identity/Assets — the only products covering every account type —
 * are not enabled on our Plaid account.
 *
 * Never request Auth: account/routing numbers are unused by the app and Auth is
 * not in our Plaid production approval — including it fails the whole
 * linkTokenCreate with INVALID_PRODUCT in production.
 */
function buildNewLinkProducts(scope: LinkScope): {
  products: Products[];
  required_if_supported_products: Products[];
} {
  return scope === "investments"
    ? {
        products: [Products.Investments],
        required_if_supported_products: [Products.Transactions, Products.Liabilities],
      }
    : {
        products: [Products.Transactions],
        required_if_supported_products: [Products.Investments, Products.Liabilities],
      };
}

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
    if (body.scope !== undefined && !LINK_SCOPES.includes(body.scope)) {
      return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
    }

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

    // New-link mode. Default to banking: it covers depository, credit and loan
    // accounts, so a caller that predates `scope` (an older mobile build) gets
    // the broader half rather than the investments-only one.
    const webhookUrl = plaidWebhookUrl();
    const resp = await plaid.linkTokenCreate({
      ...baseRequest,
      ...buildNewLinkProducts(body.scope ?? "banking"),
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
