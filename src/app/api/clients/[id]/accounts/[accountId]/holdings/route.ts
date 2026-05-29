import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accountHoldings, accounts, clients } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { requireOrgId, UnauthorizedError } from "@/lib/db-helpers";
import { parseBody } from "@/lib/schemas/common";
import { holdingCreateSchema } from "@/lib/schemas/holdings";
import { recordAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";

async function assertAccountInFirm(clientId: string, accountId: string, firmId: string) {
  const [acct] = await db
    .select({ id: accounts.id })
    .from(accounts)
    .innerJoin(clients, eq(clients.id, accounts.clientId))
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.clientId, clientId),
        eq(clients.firmId, firmId)
      )
    );
  return acct ?? null;
}

// GET — list all holdings for this account, ordered by sortOrder then createdAt
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;

    const acct = await assertAccountInFirm(id, accountId, firmId);
    if (!acct) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(accountHoldings)
      .where(eq(accountHoldings.accountId, accountId))
      .orderBy(asc(accountHoldings.sortOrder), asc(accountHoldings.createdAt));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/accounts/[accountId]/holdings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST — create a single holding on this account
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id, accountId } = await params;

    const acct = await assertAccountInFirm(id, accountId, firmId);
    if (!acct) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const parsed = await parseBody(holdingCreateSchema, req);
    if (!parsed.ok) return parsed.response;
    const b = parsed.data;

    const [row] = await db
      .insert(accountHoldings)
      .values({
        accountId,
        securityId: b.securityId ?? null,
        displayTicker: b.displayTicker ?? null,
        displayName: b.displayName ?? null,
        shares: String(b.shares),
        price: String(b.price),
        priceAsOf: b.priceAsOf ?? null,
        costBasis: String(b.costBasis),
        sortOrder: b.sortOrder ?? 0,
        notes: b.notes ?? null,
      })
      .returning();

    await recordAudit({
      action: "account.holding.create",
      resourceType: "account",
      resourceId: accountId,
      clientId: id,
      firmId,
      metadata: { holdingId: row.id, ticker: b.displayTicker ?? null },
    });

    return NextResponse.json(row, { status: 201 });
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/accounts/[accountId]/holdings error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
