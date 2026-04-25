import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, assetTransactions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import {
  assertAccountsInClient,
  assertModelPortfoliosInFirm,
} from "@/lib/db-scoping";
import { recordCreate, recordUpdate, recordDelete } from "@/lib/audit";
import { toAssetTransactionSnapshot, ASSET_TRANSACTION_FIELD_LABELS } from "@/lib/audit/snapshots/asset-transaction";

export const dynamic = "force-dynamic";

const toStr = (v: any) => (v != null ? String(v) : null);

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

// GET /api/clients/[id]/asset-transactions — list asset transactions for base case scenario
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
      .from(assetTransactions)
      .where(and(eq(assetTransactions.clientId, id), eq(assetTransactions.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/asset-transactions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/asset-transactions — create an asset transaction for base case scenario
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
      type,
      year,
      // Sale fields
      accountId,
      overrideSaleValue,
      overrideBasis,
      transactionCostPct,
      transactionCostFlat,
      proceedsAccountId,
      qualifiesForHomeSaleExclusion,
      // Buy fields
      assetName,
      assetCategory,
      assetSubType,
      purchasePrice,
      growthRate,
      growthSource,
      modelPortfolioId,
      basis,
      fundingAccountId,
      mortgageAmount,
      mortgageRate,
      mortgageTermMonths,
    } = body;

    if (!name || !type || typeof year !== "number") {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const acctCheck = await assertAccountsInClient(id, [
      accountId,
      proceedsAccountId,
      fundingAccountId,
    ]);
    if (!acctCheck.ok) {
      return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
    }
    const mpCheck = await assertModelPortfoliosInFirm(firmId, [modelPortfolioId]);
    if (!mpCheck.ok) {
      return NextResponse.json({ error: mpCheck.reason }, { status: 400 });
    }

    const [created] = await db
      .insert(assetTransactions)
      .values({
        clientId: id,
        scenarioId,
        name,
        type,
        year,
        // Sale fields
        accountId: accountId ?? null,
        overrideSaleValue: toStr(overrideSaleValue),
        overrideBasis: toStr(overrideBasis),
        transactionCostPct: toStr(transactionCostPct),
        transactionCostFlat: toStr(transactionCostFlat),
        proceedsAccountId: proceedsAccountId ?? null,
        qualifiesForHomeSaleExclusion: qualifiesForHomeSaleExclusion ?? false,
        // Buy fields
        assetName: assetName ?? null,
        assetCategory: assetCategory ?? null,
        assetSubType: assetSubType ?? null,
        purchasePrice: toStr(purchasePrice),
        growthRate: toStr(growthRate),
        growthSource: growthSource ?? null,
        modelPortfolioId: modelPortfolioId ?? null,
        basis: toStr(basis),
        fundingAccountId: fundingAccountId ?? null,
        mortgageAmount: toStr(mortgageAmount),
        mortgageRate: toStr(mortgageRate),
        mortgageTermMonths: mortgageTermMonths ?? null,
      })
      .returning();

    await recordCreate({
      action: "asset_transaction.create",
      resourceType: "asset_transaction",
      resourceId: created.id,
      clientId: id,
      firmId,
      snapshot: await toAssetTransactionSnapshot(created),
    });

    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/asset-transactions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/clients/[id]/asset-transactions — update an asset transaction by transactionId (in body)
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const body = await request.json();
    const { transactionId, ...rest } = body;

    if (!transactionId) {
      return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(assetTransactions)
      .where(and(eq(assetTransactions.id, transactionId), eq(assetTransactions.clientId, id)));
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const {
      name,
      type,
      year,
      // Sale fields
      accountId,
      overrideSaleValue,
      overrideBasis,
      transactionCostPct,
      transactionCostFlat,
      proceedsAccountId,
      qualifiesForHomeSaleExclusion,
      // Buy fields
      assetName,
      assetCategory,
      assetSubType,
      purchasePrice,
      growthRate,
      growthSource,
      modelPortfolioId,
      basis,
      fundingAccountId,
      mortgageAmount,
      mortgageRate,
      mortgageTermMonths,
    } = rest;

    const acctCheck = await assertAccountsInClient(id, [
      accountId,
      proceedsAccountId,
      fundingAccountId,
    ]);
    if (!acctCheck.ok) {
      return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
    }
    const mpCheck = await assertModelPortfoliosInFirm(firmId, [modelPortfolioId]);
    if (!mpCheck.ok) {
      return NextResponse.json({ error: mpCheck.reason }, { status: 400 });
    }

    const [updated] = await db
      .update(assetTransactions)
      .set({
        // Direct fields
        name: name !== undefined ? name : undefined,
        type: type ?? undefined,
        year: year ?? undefined,
        accountId: accountId !== undefined ? accountId : undefined,
        proceedsAccountId: proceedsAccountId !== undefined ? proceedsAccountId : undefined,
        qualifiesForHomeSaleExclusion:
          qualifiesForHomeSaleExclusion !== undefined ? qualifiesForHomeSaleExclusion : undefined,
        assetName: assetName !== undefined ? assetName : undefined,
        assetCategory: assetCategory !== undefined ? assetCategory : undefined,
        assetSubType: assetSubType !== undefined ? assetSubType : undefined,
        growthSource: growthSource !== undefined ? growthSource : undefined,
        modelPortfolioId: modelPortfolioId !== undefined ? modelPortfolioId : undefined,
        fundingAccountId: fundingAccountId !== undefined ? fundingAccountId : undefined,
        mortgageTermMonths: mortgageTermMonths !== undefined ? mortgageTermMonths : undefined,
        // Decimal fields
        overrideSaleValue: overrideSaleValue !== undefined ? toStr(overrideSaleValue) : undefined,
        overrideBasis: overrideBasis !== undefined ? toStr(overrideBasis) : undefined,
        transactionCostPct: transactionCostPct !== undefined ? toStr(transactionCostPct) : undefined,
        transactionCostFlat: transactionCostFlat !== undefined ? toStr(transactionCostFlat) : undefined,
        purchasePrice: purchasePrice !== undefined ? toStr(purchasePrice) : undefined,
        growthRate: growthRate !== undefined ? toStr(growthRate) : undefined,
        basis: basis !== undefined ? toStr(basis) : undefined,
        mortgageAmount: mortgageAmount !== undefined ? toStr(mortgageAmount) : undefined,
        mortgageRate: mortgageRate !== undefined ? toStr(mortgageRate) : undefined,
        updatedAt: new Date(),
      })
      .where(and(eq(assetTransactions.id, transactionId), eq(assetTransactions.clientId, id)))
      .returning();

    await recordUpdate({
      action: "asset_transaction.update",
      resourceType: "asset_transaction",
      resourceId: transactionId,
      clientId: id,
      firmId,
      before: await toAssetTransactionSnapshot(existing),
      after: await toAssetTransactionSnapshot(updated),
      fieldLabels: ASSET_TRANSACTION_FIELD_LABELS,
    });

    return NextResponse.json(updated);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("PUT /api/clients/[id]/asset-transactions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/clients/[id]/asset-transactions — delete an asset transaction by transactionId (query param)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const firmId = await requireOrgId();
    const { id } = await params;

    const [client] = await db
      .select()
      .from(clients)
      .where(and(eq(clients.id, id), eq(clients.firmId, firmId)));
    if (!client) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const transactionId = searchParams.get("transactionId");

    if (!transactionId) {
      return NextResponse.json({ error: "Missing transactionId" }, { status: 400 });
    }

    const [existing] = await db
      .select()
      .from(assetTransactions)
      .where(and(eq(assetTransactions.id, transactionId), eq(assetTransactions.clientId, id)));
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const snapshot = await toAssetTransactionSnapshot(existing);

    await db
      .delete(assetTransactions)
      .where(and(eq(assetTransactions.id, transactionId), eq(assetTransactions.clientId, id)));

    await recordDelete({
      action: "asset_transaction.delete",
      resourceType: "asset_transaction",
      resourceId: transactionId,
      clientId: id,
      firmId,
      snapshot,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("DELETE /api/clients/[id]/asset-transactions error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
