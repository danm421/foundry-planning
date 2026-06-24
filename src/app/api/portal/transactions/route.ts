import { NextResponse } from "next/server";
import { authErrorResponse } from "@/lib/authz";
import { resolvePortalClient } from "@/lib/portal/resolve-portal-client";
import {
  loadPortalTransactions,
  countPortalTransactions,
  type TransactionFilters,
} from "@/lib/portal/transactions-query";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

export async function GET(req: Request): Promise<Response> {
  try {
    // Act-as aware so advisor "preview as client" reads the client's transactions.
    const { clientId } = await resolvePortalClient();
    const url = new URL(req.url);
    const qp = url.searchParams;
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(qp.get("limit")) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(qp.get("offset")) || 0);
    const filters: TransactionFilters = {
      from: qp.get("from") ?? undefined,
      to: qp.get("to") ?? undefined,
      categoryId: qp.get("categoryId") ?? undefined,
      q: qp.get("q") ?? undefined,
      includeExcluded: qp.get("includeExcluded") === "true",
      limit,
      offset,
    };
    const [transactions, total] = await Promise.all([
      loadPortalTransactions(clientId, filters),
      countPortalTransactions(clientId, filters),
    ]);
    return NextResponse.json({ transactions, total, hasMore: offset + transactions.length < total });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    throw err;
  }
}
