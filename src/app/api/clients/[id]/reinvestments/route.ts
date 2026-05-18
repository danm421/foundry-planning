import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, reinvestments, reinvestmentAccounts } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { assertAccountsInClient, assertModelPortfoliosInFirm } from "@/lib/db-scoping";
import { recordCreate, recordUpdate, recordDelete } from "@/lib/audit";
import {
  toReinvestmentSnapshot,
  REINVESTMENT_FIELD_LABELS,
} from "@/lib/audit/snapshots/reinvestment";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(clientId: string, firmId: string): Promise<string | null> {
  const [client] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));

  if (!client) return null;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

// GET /api/clients/[id]/reinvestments — list reinvestments for base case scenario with accountIds
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(reinvestments)
      .where(and(eq(reinvestments.clientId, id), eq(reinvestments.scenarioId, scenarioId)));

    let accountRows: (typeof reinvestmentAccounts.$inferSelect)[] = [];
    if (rows.length > 0) {
      const reinvestmentIds = rows.map((r) => r.id);
      accountRows = await db
        .select()
        .from(reinvestmentAccounts)
        .where(inArray(reinvestmentAccounts.reinvestmentId, reinvestmentIds));
    }

    const result = rows.map((r) => ({
      ...r,
      accountIds: accountRows
        .filter((a) => a.reinvestmentId === r.id)
        .map((a) => a.accountId),
    }));

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/reinvestments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/reinvestments — create reinvestment for base case scenario
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      name,
      year,
      yearRef,
      targetType,
      modelPortfolioId,
      customGrowthRate,
      customPctOrdinaryIncome,
      customPctLtCapitalGains,
      customPctQualifiedDividends,
      customPctTaxExempt,
      realizeTaxesOnSwitch,
      accountIds,
    } = body;

    if (
      !name ||
      typeof year !== "number" ||
      !Array.isArray(accountIds) ||
      accountIds.length === 0 ||
      (targetType === "model_portfolio" && !modelPortfolioId) ||
      (targetType === "custom" && customGrowthRate == null)
    ) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const acctCheck = await assertAccountsInClient(id, accountIds);
    if (!acctCheck.ok) {
      return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
    }

    if (modelPortfolioId != null) {
      const mpCheck = await assertModelPortfoliosInFirm(firmId, [modelPortfolioId]);
      if (!mpCheck.ok) {
        return NextResponse.json({ error: mpCheck.reason }, { status: 400 });
      }
    }

    const created = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(reinvestments)
        .values({
          clientId: id,
          scenarioId,
          name,
          year,
          yearRef: yearRef ?? null,
          targetType: targetType ?? "model_portfolio",
          modelPortfolioId: modelPortfolioId ?? null,
          customGrowthRate: customGrowthRate != null ? String(customGrowthRate) : null,
          customPctOrdinaryIncome:
            customPctOrdinaryIncome != null ? String(customPctOrdinaryIncome) : null,
          customPctLtCapitalGains:
            customPctLtCapitalGains != null ? String(customPctLtCapitalGains) : null,
          customPctQualifiedDividends:
            customPctQualifiedDividends != null ? String(customPctQualifiedDividends) : null,
          customPctTaxExempt:
            customPctTaxExempt != null ? String(customPctTaxExempt) : null,
          realizeTaxesOnSwitch: realizeTaxesOnSwitch ?? false,
        })
        .returning();

      await tx.insert(reinvestmentAccounts).values(
        accountIds.map((accountId: string) => ({
          reinvestmentId: row.id,
          accountId,
        }))
      );

      return row;
    });

    await recordCreate({
      action: "reinvestment.create",
      resourceType: "reinvestment",
      resourceId: created.id,
      clientId: id,
      firmId,
      snapshot: await toReinvestmentSnapshot(created),
    });

    return NextResponse.json({ ...created, accountIds }, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/reinvestments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/clients/[id]/reinvestments — update reinvestment by reinvestmentId (in body)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      reinvestmentId,
      name,
      year,
      yearRef,
      targetType,
      modelPortfolioId,
      customGrowthRate,
      customPctOrdinaryIncome,
      customPctLtCapitalGains,
      customPctQualifiedDividends,
      customPctTaxExempt,
      realizeTaxesOnSwitch,
      accountIds,
    } = body;

    if (!reinvestmentId) {
      return NextResponse.json({ error: "Missing reinvestmentId" }, { status: 400 });
    }

    if (Array.isArray(accountIds) && accountIds.length === 0) {
      return NextResponse.json(
        { error: "A reinvestment must target at least one account" },
        { status: 400 }
      );
    }

    if (Array.isArray(accountIds) && accountIds.length > 0) {
      const acctCheck = await assertAccountsInClient(id, accountIds);
      if (!acctCheck.ok) {
        return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
      }
    }

    if (modelPortfolioId != null) {
      const mpCheck = await assertModelPortfoliosInFirm(firmId, [modelPortfolioId]);
      if (!mpCheck.ok) {
        return NextResponse.json({ error: mpCheck.reason }, { status: 400 });
      }
    }

    const [before] = await db
      .select()
      .from(reinvestments)
      .where(and(eq(reinvestments.id, reinvestmentId), eq(reinvestments.clientId, id)));

    if (!before) {
      return NextResponse.json({ error: "Reinvestment not found" }, { status: 404 });
    }

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(reinvestments)
        .set({
          ...(name !== undefined && { name }),
          ...(year !== undefined && { year }),
          ...(yearRef !== undefined && { yearRef: yearRef ?? null }),
          ...(targetType !== undefined && { targetType }),
          ...(modelPortfolioId !== undefined && { modelPortfolioId: modelPortfolioId ?? null }),
          ...(customGrowthRate !== undefined && {
            customGrowthRate: customGrowthRate != null ? String(customGrowthRate) : null,
          }),
          ...(customPctOrdinaryIncome !== undefined && {
            customPctOrdinaryIncome:
              customPctOrdinaryIncome != null ? String(customPctOrdinaryIncome) : null,
          }),
          ...(customPctLtCapitalGains !== undefined && {
            customPctLtCapitalGains:
              customPctLtCapitalGains != null ? String(customPctLtCapitalGains) : null,
          }),
          ...(customPctQualifiedDividends !== undefined && {
            customPctQualifiedDividends:
              customPctQualifiedDividends != null ? String(customPctQualifiedDividends) : null,
          }),
          ...(customPctTaxExempt !== undefined && {
            customPctTaxExempt: customPctTaxExempt != null ? String(customPctTaxExempt) : null,
          }),
          ...(realizeTaxesOnSwitch !== undefined && { realizeTaxesOnSwitch }),
          updatedAt: new Date(),
        })
        .where(and(eq(reinvestments.id, reinvestmentId), eq(reinvestments.clientId, id)))
        .returning();

      if (Array.isArray(accountIds)) {
        await tx
          .delete(reinvestmentAccounts)
          .where(eq(reinvestmentAccounts.reinvestmentId, reinvestmentId));

        if (accountIds.length > 0) {
          await tx.insert(reinvestmentAccounts).values(
            accountIds.map((accountId: string) => ({
              reinvestmentId,
              accountId,
            }))
          );
        }
      }

      return row;
    });

    if (!updated) {
      return NextResponse.json({ error: "Reinvestment not found" }, { status: 404 });
    }

    const updatedAccounts = await db
      .select()
      .from(reinvestmentAccounts)
      .where(eq(reinvestmentAccounts.reinvestmentId, reinvestmentId));

    await recordUpdate({
      action: "reinvestment.update",
      resourceType: "reinvestment",
      resourceId: reinvestmentId,
      clientId: id,
      firmId,
      before: await toReinvestmentSnapshot(before),
      after: await toReinvestmentSnapshot(updated),
      fieldLabels: REINVESTMENT_FIELD_LABELS,
    });

    return NextResponse.json({
      ...updated,
      accountIds: updatedAccounts.map((a) => a.accountId),
    });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/reinvestments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/reinvestments — delete reinvestment by reinvestmentId (in query params)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id, firmId);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const reinvestmentId = searchParams.get("reinvestmentId");

    if (!reinvestmentId) {
      return NextResponse.json({ error: "Missing reinvestmentId" }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(reinvestments)
      .where(and(eq(reinvestments.id, reinvestmentId), eq(reinvestments.clientId, id)));

    if (!existing) {
      return NextResponse.json({ error: "Reinvestment not found" }, { status: 404 });
    }

    const snapshot = await toReinvestmentSnapshot(existing);

    await db
      .delete(reinvestments)
      .where(and(eq(reinvestments.id, reinvestmentId), eq(reinvestments.clientId, id)));

    await recordDelete({
      action: "reinvestment.delete",
      resourceType: "reinvestment",
      resourceId: reinvestmentId,
      clientId: id,
      firmId,
      snapshot,
    });

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/reinvestments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
