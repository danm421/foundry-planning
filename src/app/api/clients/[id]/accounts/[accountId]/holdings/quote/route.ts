import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { quoteTickerSchema } from "@/lib/schemas/holdings";
import { fetchEodClose } from "@/lib/investments/quote";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

async function assertAccountInFirm(clientId: string, accountId: string, firmId: string) {
  if (!(await verifyClientAccess(clientId, firmId))) return null;
  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.clientId, clientId)));
  return acct ?? null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;
    if (!(await assertAccountInFirm(id, accountId, firmId))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const parsed = quoteTickerSchema.safeParse({
      ticker: req.nextUrl.searchParams.get("ticker") ?? "",
    });
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
    }
    const quote = await fetchEodClose(parsed.data.ticker);
    // Fail soft: never block the form on a price miss.
    return NextResponse.json(quote ?? { price: null });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET quote error:", err);
    return NextResponse.json({ price: null });
  }
}
