import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { listAccountCascadeDependents } from "@/lib/accounts/cascade-dependents";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

async function verifyClient(clientId: string) {
  const a = await verifyClientAccess(clientId);
  return a.ok;
}

// GET /api/clients/[id]/accounts/[accountId]/dependents — transfers + Roth
// conversions that would be cascade-deleted with this account (audit F15).
// Read-only; powers the pre-delete warning dialog.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    if (!(await verifyClient(id))) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const [account] = await db
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), eq(accounts.clientId, id)));
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const dependents = await listAccountCascadeDependents(id, accountId);
    return NextResponse.json(dependents);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/accounts/[accountId]/dependents error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
