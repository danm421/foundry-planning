import { type NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { securityPriceHistory } from "@/db/schema";
import { fetchMonthlyAdjustedClose } from "@/lib/cma-eodhd-history";
import { eodhdSymbol } from "@/lib/investments/quote";
import {
  refreshReferencedPriceHistory,
  type ReferencedSecurity,
} from "@/lib/investments/refresh-price-history";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** History window start, matching FROM_DEFAULT in `lib/ticker-history.ts`. */
const FROM = "1996-01-01";

/** Courtesy pause between EODHD calls. */
const THROTTLE_MS = 120;

/**
 * Cap per run so one invocation cannot exceed `maxDuration`. At ~274 referenced
 * securities the steady-state month only refetches what actually went stale, so
 * this bites on a cold start only — and the next run picks up where this
 * stopped, because a security still missing the latest month stays unfresh.
 */
const FETCH_LIMIT = 400;

/**
 * GET /api/cron/refresh-security-price-history — monthly Vercel Cron (vercel.ts, 0 12 1 * *).
 * Auth: Bearer CRON_SECRET. System job across ALL firms.
 *
 * Keeps `security_price_history` current for every security a portfolio actually
 * references. The sibling `refresh-ticker-portfolios` job walks `ticker_portfolios`
 * only — prod has none — so before this job nothing refreshed the securities
 * clients actually hold, and a proposal's realized backtest quietly aged out.
 */
export async function GET(req: NextRequest): Promise<Response> {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Every security referenced by either side of a proposal. Account holdings are
  // keyed by security_id; fund-portfolio rows usually store only display_ticker
  // (the builder's write path leaves security_id null), so they resolve by
  // ticker the same way `getSecurityByTicker` does.
  const listReferenced = async (): Promise<ReferencedSecurity[]> => {
    const result = await db.execute(sql`
      WITH referenced AS (
        SELECT ah.security_id AS security_id, NULL::text AS ticker
          FROM account_holdings ah
         WHERE ah.security_id IS NOT NULL
        UNION ALL
        SELECT tph.security_id, tph.display_ticker
          FROM ticker_portfolio_holdings tph
      ),
      resolved AS (
        SELECT COALESCE(r.security_id, s2.id) AS security_id
          FROM referenced r
          LEFT JOIN securities s2
            ON s2.identifier_type = 'ticker'
           AND s2.identifier = upper(r.ticker)
         WHERE COALESCE(r.security_id, s2.id) IS NOT NULL
      )
      SELECT DISTINCT
             s.id,
             s.identifier,
             s.identifier_type,
             (SELECT max(p.month) FROM security_price_history p WHERE p.security_id = s.id) AS last_bar
        FROM resolved rs
        JOIN securities s ON s.id = rs.security_id
       ORDER BY s.identifier
    `);

    const rows = result.rows as unknown as {
      id: string;
      identifier: string;
      identifier_type: string;
      last_bar: string | null;
    }[];

    return rows.map((r) => ({
      id: r.id,
      identifier: r.identifier,
      identifierType: r.identifier_type,
      lastBar: r.last_bar ? String(r.last_bar).slice(0, 7) : null,
    }));
  };

  try {
    const summary = await refreshReferencedPriceHistory({
      listReferenced,
      fetchBars: (symbol) => fetchMonthlyAdjustedClose(symbol, { from: FROM }),
      toSymbol: eodhdSymbol,
      writeBars: async (securityId, bars) => {
        await db
          .insert(securityPriceHistory)
          .values(
            bars.map((b) => ({
              securityId,
              month: `${b.date.slice(0, 7)}-01`,
              adjustedClose: String(b.adjClose),
            })),
          )
          .onConflictDoNothing();
      },
      now: new Date(),
      limit: FETCH_LIMIT,
      throttleMs: THROTTLE_MS,
    });

    // A skip is expected and routine (money-market funds have no usable series);
    // a FAILURE is a transport or key problem worth seeing.
    if (summary.failed.length > 0) {
      Sentry.captureMessage("Security price-history refresh had fetch failures", {
        level: "warning",
        extra: { failed: summary.failed.slice(0, 20), count: summary.failed.length },
      });
    }

    return NextResponse.json({
      status: summary.failed.length > 0 ? "partial" : "ok",
      ...summary,
      // The reasons matter more than the list length when reading a cron log.
      skipped: summary.skipped.length,
      skippedStale: summary.skipped.filter((s) => s.stale).length,
      skippedDetail: summary.skipped.slice(0, 40),
    });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "refresh failed" },
      { status: 500 },
    );
  }
}
