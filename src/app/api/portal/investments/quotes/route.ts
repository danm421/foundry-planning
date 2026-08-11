import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalFeature } from "@/lib/portal/load-features";
import { fetchEodQuotes, eodhdSymbol, type LiveQuote } from "@/lib/investments/quote";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    // Authenticate (client or advisor-preview), then refuse quotes for a
    // portal whose Investments section the advisor has switched off.
    const { clientId } = await resolvePortalClient();
    await requirePortalFeature(clientId, "investments");
    const url = new URL(req.url);
    const tickers = (url.searchParams.get("tickers") ?? "")
      .split(",").map((t) => t.trim().toUpperCase()).filter(Boolean).slice(0, 200);
    const bySymbol = await fetchEodQuotes(tickers);
    const quotes: Record<string, LiveQuote> = {};
    for (const t of tickers) {
      const q = bySymbol.get(eodhdSymbol(t));
      if (q) quotes[t] = q;
    }
    return NextResponse.json({ quotes });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
