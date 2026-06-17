import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scenarios, reinvestments, reinvestmentAccounts, reinvestmentGroups } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { assertAccountsInClient, assertModelPortfoliosInFirm } from "@/lib/db-scoping";
import { recordCreate, recordUpdate, recordDelete } from "@/lib/audit";
import {
  toReinvestmentSnapshot,
  REINVESTMENT_FIELD_LABELS,
} from "@/lib/audit/snapshots/reinvestment";
import { isDefaultKey } from "@/lib/account-groups/resolver";
import { listAccountGroups } from "@/lib/account-groups/queries";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

async function getBaseCaseScenarioId(clientId: string): Promise<string | null> {
  const a = await verifyClientAccess(clientId);
  if (!a.ok) return null;

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true)));

  return scenario?.id ?? null;
}

/** Validate group keys: each must be a default key or a custom group owned by
 *  the client. Returns the list of valid keys, or an error reason. */
async function validateGroupKeys(
  clientId: string,
  groupKeys: unknown,
): Promise<{ ok: true; keys: string[] } | { ok: false; reason: string }> {
  if (groupKeys == null) return { ok: true, keys: [] };
  if (!Array.isArray(groupKeys) || groupKeys.some((k) => typeof k !== "string")) {
    return { ok: false, reason: "groupKeys must be an array of strings" };
  }
  const keys = groupKeys as string[];
  const customKeys = keys.filter((k) => !isDefaultKey(k));
  if (customKeys.length > 0) {
    const owned = new Set((await listAccountGroups(clientId)).map((g) => g.id));
    const bad = customKeys.find((k) => !owned.has(k));
    if (bad) return { ok: false, reason: `Unknown account group: ${bad}` };
  }
  return { ok: true, keys };
}

// GET /api/clients/[id]/reinvestments — list reinvestments for base case scenario with accountIds
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireOrgId();
    const { id } = await params;

    const scenarioId = await getBaseCaseScenarioId(id);
    if (!scenarioId) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }

    const rows = await db
      .select()
      .from(reinvestments)
      .where(and(eq(reinvestments.clientId, id), eq(reinvestments.scenarioId, scenarioId)));

    let accountRows: (typeof reinvestmentAccounts.$inferSelect)[] = [];
    let groupRows: (typeof reinvestmentGroups.$inferSelect)[] = [];
    if (rows.length > 0) {
      const reinvestmentIds = rows.map((r) => r.id);
      [accountRows, groupRows] = await Promise.all([
        db
          .select()
          .from(reinvestmentAccounts)
          .where(inArray(reinvestmentAccounts.reinvestmentId, reinvestmentIds)),
        db
          .select()
          .from(reinvestmentGroups)
          .where(inArray(reinvestmentGroups.reinvestmentId, reinvestmentIds)),
      ]);
    }

    const result = rows.map((r) => ({
      ...r,
      accountIds: accountRows
        .filter((a) => a.reinvestmentId === r.id)
        .map((a) => a.accountId),
      groupKeys: groupRows
        .filter((g) => g.reinvestmentId === r.id)
        .map((g) => g.groupKey),
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

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const scenarioId = await getBaseCaseScenarioId(id);
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
      groupKeys,
    } = body;

    const groupCheck = await validateGroupKeys(id, groupKeys);
    if (!groupCheck.ok) {
      return NextResponse.json({ error: groupCheck.reason }, { status: 400 });
    }
    const hasIndividual = Array.isArray(accountIds) && accountIds.length > 0;
    const hasGroups = groupCheck.keys.length > 0;

    if (
      !name ||
      typeof year !== "number" ||
      (!hasIndividual && !hasGroups) ||
      (targetType === "model_portfolio" && !modelPortfolioId) ||
      (targetType === "custom" && customGrowthRate == null)
    ) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const [acctCheck, mpCheck] = await Promise.all([
      hasIndividual
        ? assertAccountsInClient(id, accountIds)
        : Promise.resolve({ ok: true as const }),
      modelPortfolioId != null
        ? assertModelPortfoliosInFirm(firmId, [modelPortfolioId])
        : Promise.resolve(null),
    ]);
    if (!acctCheck.ok) {
      return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
    }
    if (mpCheck && !mpCheck.ok) {
      return NextResponse.json({ error: mpCheck.reason }, { status: 400 });
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

      if (hasIndividual) {
        await tx.insert(reinvestmentAccounts).values(
          accountIds.map((accountId: string) => ({
            reinvestmentId: row.id,
            accountId,
          }))
        );
      }
      if (hasGroups) {
        await tx.insert(reinvestmentGroups).values(
          groupCheck.keys.map((groupKey) => ({
            reinvestmentId: row.id,
            groupKey,
          }))
        );
      }

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

    return NextResponse.json(
      { ...created, accountIds: accountIds ?? [], groupKeys: groupCheck.keys },
      { status: 201 },
    );
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

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const scenarioId = await getBaseCaseScenarioId(id);
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
      groupKeys,
    } = body;

    if (!reinvestmentId) {
      return NextResponse.json({ error: "Missing reinvestmentId" }, { status: 400 });
    }

    const groupCheck = await validateGroupKeys(id, groupKeys);
    if (!groupCheck.ok) {
      return NextResponse.json({ error: groupCheck.reason }, { status: 400 });
    }
    const accountsProvided = Array.isArray(accountIds);
    const groupsProvided = Array.isArray(groupKeys);
    if (
      accountsProvided &&
      groupsProvided &&
      accountIds.length === 0 &&
      groupCheck.keys.length === 0
    ) {
      return NextResponse.json(
        { error: "A reinvestment must target at least one account or group" },
        { status: 400 },
      );
    }

    const [acctCheck, mpCheck] = await Promise.all([
      accountsProvided && accountIds.length > 0
        ? assertAccountsInClient(id, accountIds)
        : Promise.resolve(null),
      modelPortfolioId != null
        ? assertModelPortfoliosInFirm(firmId, [modelPortfolioId])
        : Promise.resolve(null),
    ]);
    if (acctCheck && !acctCheck.ok) {
      return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
    }
    if (mpCheck && !mpCheck.ok) {
      return NextResponse.json({ error: mpCheck.reason }, { status: 400 });
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

      if (accountsProvided) {
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

      if (groupsProvided) {
        await tx
          .delete(reinvestmentGroups)
          .where(eq(reinvestmentGroups.reinvestmentId, reinvestmentId));
        if (groupCheck.keys.length > 0) {
          await tx.insert(reinvestmentGroups).values(
            groupCheck.keys.map((groupKey) => ({ reinvestmentId, groupKey }))
          );
        }
      }

      return row;
    });

    if (!updated) {
      return NextResponse.json({ error: "Reinvestment not found" }, { status: 404 });
    }

    // When accountIds was supplied, the transaction reinserted exactly that
    // array — return it directly. Otherwise the join rows are untouched, so
    // read current state to build the response.
    let responseAccountIds: string[];
    if (accountsProvided) {
      responseAccountIds = accountIds;
    } else {
      const updatedAccounts = await db
        .select()
        .from(reinvestmentAccounts)
        .where(eq(reinvestmentAccounts.reinvestmentId, reinvestmentId));
      responseAccountIds = updatedAccounts.map((a) => a.accountId);
    }

    const responseGroupKeys = groupsProvided
      ? groupCheck.keys
      : (
          await db
            .select()
            .from(reinvestmentGroups)
            .where(eq(reinvestmentGroups.reinvestmentId, reinvestmentId))
        ).map((g) => g.groupKey);

    const [beforeSnapshot, afterSnapshot] = await Promise.all([
      toReinvestmentSnapshot(before),
      toReinvestmentSnapshot(updated),
    ]);

    await recordUpdate({
      action: "reinvestment.update",
      resourceType: "reinvestment",
      resourceId: reinvestmentId,
      clientId: id,
      firmId,
      before: beforeSnapshot,
      after: afterSnapshot,
      fieldLabels: REINVESTMENT_FIELD_LABELS,
    });

    return NextResponse.json({
      ...updated,
      accountIds: responseAccountIds,
      groupKeys: responseGroupKeys,
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

    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    if (access.permission !== "edit") {
      return NextResponse.json({ error: "View-only access" }, { status: 403 });
    }

    const scenarioId = await getBaseCaseScenarioId(id);
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
