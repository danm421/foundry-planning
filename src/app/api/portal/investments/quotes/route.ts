import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { requirePortalFeature } from "@/lib/portal/load-features";
import { loadPortalInvestments } from "@/lib/portal/load-portal-investments";
import { fetchEodQuotes, eodhdSymbol, type LiveQuote } from "@/lib/investments/quote";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    // Authenticate (client or advisor-preview), then refuse quotes for a
    // portal whose Investments section the advisor has switched off.
    const { clientId } = await resolvePortalClient();
    await requirePortalFeature(clientId, "investments");
    // Price only what this household holds — the same holdings the
    // Investments page lists. Any other requested ticker is dropped.
    const norm = (t: string) => t.trim().toUpperCase();
    const { accounts } = await loadPortalInvestments(clientId);
    const held = new Set(accounts.flatMap((a) => a.holdings.map((h) => norm(h.ticker ?? ""))));
    const url = new URL(req.url);
    const tickers = [...new Set((url.searchParams.get("tickers") ?? "").split(",").map(norm))]
      .filter((t) => t !== "" && held.has(t)).slice(0, 200);
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
