import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { classifyTickerSchema } from "@/lib/schemas/holdings";
import { getSecurityByTicker, upsertClassifiedSecurity } from "@/lib/investments/classification/persist";
import { classifySecurity } from "@/lib/investments/classification/classify";
import { lookupSecurityName } from "@/lib/investments/classification/lookup-name";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

async function assertAccountInFirm(clientId: string, accountId: string) {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;
  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)));
  return acct ?? null;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    await requireOrgId();
    const { id, accountId } = await params;
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }
    if (!(await assertAccountInFirm(id, accountId))) {
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
      // Classification needs EODHD's fundamentals feed, which is licensed
      // separately; when it's unavailable the advisor would otherwise get a
      // nameless row back and no sign the ticker was even recognised. Search is
      // on the base plan and still knows the name — return it for display only,
      // unpersisted, so the holding stays honestly unclassified and a later
      // run can still write the real security row.
      const named = await lookupSecurityName(ticker);
      return NextResponse.json({
        security: null,
        displayName: named?.name ?? null,
        weights: [],
      });
    }
    await upsertClassifiedSecurity(classified);
    const stored = await getSecurityByTicker(ticker);
    return NextResponse.json({
      security: stored?.security ?? null,
      weights: (stored?.weights ?? []).map((w) => ({ slug: w.assetClassSlug, weight: parseFloat(w.weight) })),
    });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST classify error:", err);
    // Fail soft: never block the holding save on a classification error.
    return NextResponse.json({ security: null, weights: [] });
  }
}
