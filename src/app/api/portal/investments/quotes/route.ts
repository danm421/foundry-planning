import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import { fetchEodQuotes, eodhdSymbol, type LiveQuote } from "@/lib/investments/quote";

export const dynamic = "force-dynamic";

export async function GET(req: Request): Promise<Response> {
  try {
    await resolvePortalClient(); // authenticate (client or advisor-preview)
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
