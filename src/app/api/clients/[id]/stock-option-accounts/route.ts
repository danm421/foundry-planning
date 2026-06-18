import { NextRequest, NextResponse } from "next/server";
import { formatZodIssues } from "@/lib/schemas/common";
import { db } from "@/db";
import {
  scenarios,
  accounts,
  accountOwners,
  familyMembers,
  stockOptionAccounts,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { stockOptionAccountCreateSchema } from "@/lib/schemas/stock-options";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(
  clientId: string,
): Promise<string | null> {
  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

// GET /api/clients/[id]/stock-option-accounts
// Lists all stock-option accounts for the client's base-case scenario,
// joined to their extension row.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select({
        account: accounts,
        extension: stockOptionAccounts,
      })
      .from(accounts)
      .leftJoin(stockOptionAccounts, eq(stockOptionAccounts.accountId, accounts.id))
      .where(
        and(
          eq(accounts.clientId, id),
          eq(accounts.scenarioId, scenarioId),
          eq(accounts.category, "stock_options"),
        ),
      );

    return NextResponse.json({ stockOptionAccounts: rows });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/stock-option-accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/stock-option-accounts
// Creates an accounts row + accountOwners row + stockOptionAccounts extension
// row in one transaction so a partial write can't leave a dangling account.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const parsed = stockOptionAccountCreateSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", issues: formatZodIssues(parsed.error) },
        { status: 400 },
      );
    }
    const input = parsed.data;

    // Look up FM ids so we can build the single accountOwners row.
    const fmRows = await db
      .select({ id: familyMembers.id, role: familyMembers.role })
      .from(familyMembers)
      .where(eq(familyMembers.clientId, id));
    const clientFmId = fmRows.find((f) => f.role === "client")?.id ?? null;
    const spouseFmId = fmRows.find((f) => f.role === "spouse")?.id ?? null;

    const newAccountId = await db.transaction(async (tx) => {
      // 1. Insert the accounts row.
      const [acct] = await tx
        .insert(accounts)
        .values({
          clientId: id,
          scenarioId,
          name: input.name,
          category: "stock_options",
          subType: "other",
          value: "0",
          basis: "0",
          ...(input.growthRate != null ? { growthRate: String(input.growthRate) } : {}),
        })
        .returning({ id: accounts.id, name: accounts.name });

      // 2. Insert the single owner row (skip if the family member doesn't exist).
      const ownerFmId = input.owner === "spouse" ? spouseFmId : clientFmId;
      if (ownerFmId != null) {
        await tx.insert(accountOwners).values({
          accountId: acct.id,
          familyMemberId: ownerFmId,
          percent: "1",
        });
      }

      // 3. Insert the stockOptionAccounts extension row.
      await tx.insert(stockOptionAccounts).values({
        accountId: acct.id,
        ticker: input.ticker ?? null,
        isPublic: input.isPublic,
        pricePerShare: String(input.pricePerShare),
        destinationAccountId: input.destinationAccountId ?? null,
        autoCreateDestination: input.autoCreateDestination,
        sellToCover: input.sellToCover,
        withholdingRate: String(input.withholdingRate),
        defaultExerciseTiming: input.defaultExerciseTiming,
        defaultExerciseYear: input.defaultExerciseYear ?? null,
        defaultSellTiming: input.defaultSellTiming,
        defaultSellYear: input.defaultSellYear ?? null,
        defaultSellPercentPerYear:
          input.defaultSellPercentPerYear != null
            ? String(input.defaultSellPercentPerYear)
            : null,
        defaultSellStartYear: input.defaultSellStartYear ?? null,
      });

      return acct.id;
    });

    await recordAudit({
      action: "account.stock_options.create",
      resourceType: "stock_option_account",
      resourceId: newAccountId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, { name: input.name, ticker: input.ticker ?? null }),
    });

    return NextResponse.json({ id: newAccountId }, { status: 201 });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("POST /api/clients/[id]/stock-option-accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
