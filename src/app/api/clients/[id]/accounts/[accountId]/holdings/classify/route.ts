import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, clients } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { classifyTickerSchema } from "@/lib/schemas/holdings";
import { getSecurityByTicker, upsertClassifiedSecurity } from "@/lib/investments/classification/persist";
import { classifySecurity } from "@/lib/investments/classification/classify";

export const dynamic = "force-dynamic";

async function assertAccountInFirm(clientId: string, accountId: string, firmId: string) {
  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .innerJoin(clients, eq(clients.id, accounts.clientId))
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId), eq(clients.firmId, firmId)));
  return acct ?? null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;
    if (!(await assertAccountInFirm(id, accountId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const parsed = await parseBody(classifyTickerSchema, req);
    if (!parsed.ok) return parsed.response;
    const ticker = parsed.data.ticker.toUpperCase();

    // Cache hit → return immediately.
    const cached = await getSecurityByTicker(ticker);
    if (cached) {
      return NextResponse.json({
        security: cached.security,
        weights: cached.weights.map((w) => ({ slug: w.assetClassSlug, weight: parseFloat(w.weight) })),
      });
    }

    // Miss → classify + cache. classifySecurity NEVER throws (soft-fail → null).
    const classified = await classifySecurity(ticker);
    if (!classified) {
      return NextResponse.json({ security: null, weights: [] });
    }
    await upsertClassifiedSecurity(classified);
    const stored = await getSecurityByTicker(ticker);
    return NextResponse.json({
      security: stored?.security ?? null,
      weights: (stored?.weights ?? []).map((w) => ({ slug: w.assetClassSlug, weight: parseFloat(w.weight) })),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST classify error:", err);
    // Fail soft: never block the holding save on a classification error.
    return NextResponse.json({ security: null, weights: [] });
  }
}
