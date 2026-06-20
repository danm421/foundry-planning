import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { CountryCode, Products } from "plaid";
import { db } from "@/db";
import { plaidItems } from "@/db/schema";
import {
  authErrorResponse,
  requireClientPortalAccess,
} from "@/lib/authz";
import { requireEditEnabled } from "@/lib/portal/require-edit-enabled";
import {
  checkPortalPlaidLinkRateLimit,
  rateLimitErrorResponse,
} from "@/lib/rate-limit";
import { getPlaidClient } from "@/lib/plaid/client";
import { decrypt } from "@/lib/plaid/crypto";

export const dynamic = "force-dynamic";

type Body = { itemId?: string };

export async function POST(req: Request): Promise<Response> {
  try {
    const { clientId } = await requireClientPortalAccess();
    await requireEditEnabled(clientId);

    const limit = await checkPortalPlaidLinkRateLimit(clientId);
    if (!limit.allowed) {
      return rateLimitErrorResponse(
        limit,
        "Too many link attempts. Try again in a bit.",
      );
    }

    const body = (await req.json().catch(() => ({}))) as Body;

    const baseRequest = {
      user: { client_user_id: clientId },
      client_name: "Foundry Planning",
      country_codes: [CountryCode.Us],
      language: "en",
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
      });
      return NextResponse.json({
        linkToken: resp.data.link_token,
        expiration: resp.data.expiration,
      });
    }

    // New-link mode.
    const resp = await plaid.linkTokenCreate({
      ...baseRequest,
      products: [Products.Auth, Products.Investments],
    });
    return NextResponse.json({
      linkToken: resp.data.link_token,
      expiration: resp.data.expiration,
    });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/portal/plaid/link-token error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
