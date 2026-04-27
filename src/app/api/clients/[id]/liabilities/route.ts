import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, liabilities, liabilityOwners } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { assertAccountsInClient, assertEntitiesInClient } from "@/lib/db-scoping";
import { recordCreate } from "@/lib/audit";
import { toLiabilitySnapshot } from "@/lib/audit/snapshots/liability";
import {
  type ValidatedOwner,
  validateOwnersShape,
  validateOwnersTenant,
  synthesizeLegacyLiabilityOwners,
} from "@/lib/ownership";

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

// GET /api/clients/[id]/liabilities — list liabilities for base case scenario
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
      .from(liabilities)
      .where(and(eq(liabilities.clientId, id), eq(liabilities.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/liabilities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/liabilities — create liability
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
      balance,
      interestRate,
      monthlyPayment,
      startYear,
      startMonth,
      termMonths,
      termUnit,
      balanceAsOfMonth,
      balanceAsOfYear,
      linkedPropertyId,
      ownerEntityId,
    } = body;
    const startYearRef = body.startYearRef ?? null;

    if (!name || startYear == null || termMonths == null) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const entCheck = await assertEntitiesInClient(id, [ownerEntityId]);
    if (!entCheck.ok) {
      return NextResponse.json({ error: entCheck.reason }, { status: 400 });
    }
    // linkedPropertyId is an account id (real-estate account) — ensure it
     // belongs to this client before linking.
    const acctCheck = await assertAccountsInClient(id, [linkedPropertyId]);
    if (!acctCheck.ok) {
      return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
    }

    // ── owners[] validation ────────────────────────────────────────────────
    let resolvedOwners: ValidatedOwner[] | undefined;

    if ("owners" in body && body.owners !== undefined) {
      // New owners[] path
      const shapeResult = validateOwnersShape(body.owners);
      if ("error" in shapeResult) {
        return NextResponse.json({ error: shapeResult.error }, { status: 400 });
      }
      const tenantError = await validateOwnersTenant(shapeResult.owners, id);
      if (tenantError) {
        return NextResponse.json({ error: tenantError.error }, { status: 400 });
      }
      resolvedOwners = shapeResult.owners;
    } else {
      // Legacy path: synthesize from ownerEntityId or client family member
      const synthesized = await synthesizeLegacyLiabilityOwners(id, ownerEntityId);
      if (synthesized.length > 0) {
        resolvedOwners = synthesized;
      }
    }
    // ── end owners[] validation ────────────────────────────────────────────

    let liability: typeof liabilities.$inferSelect;
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(liabilities)
        .values({
          clientId: id,
          scenarioId,
          name,
          balance: balance ?? "0",
          interestRate: interestRate ?? "0",
          monthlyPayment: monthlyPayment ?? "0",
          startYear: Number(startYear),
          startMonth: startMonth != null ? Number(startMonth) : 1,
          termMonths: Number(termMonths),
          termUnit: termUnit ?? "annual",
          balanceAsOfMonth: balanceAsOfMonth != null ? Number(balanceAsOfMonth) : null,
          balanceAsOfYear: balanceAsOfYear != null ? Number(balanceAsOfYear) : null,
          linkedPropertyId: linkedPropertyId ?? null,
          startYearRef,
          isInterestDeductible: body.isInterestDeductible ?? false,
        })
        .returning();
      liability = inserted;

      if (resolvedOwners && resolvedOwners.length > 0) {
        for (const o of resolvedOwners) {
          await tx.insert(liabilityOwners).values({
            liabilityId: liability.id,
            familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
            entityId: o.kind === "entity" ? o.entityId : null,
            percent: o.percent.toString(),
          });
        }
      }
    });

    await recordCreate({
      action: "liability.create",
      resourceType: "liability",
      resourceId: liability!.id,
      clientId: id,
      firmId,
      snapshot: await toLiabilitySnapshot(liability!),
    });

    return NextResponse.json(liability!, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/liabilities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
