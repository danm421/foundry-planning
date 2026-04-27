import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { clients, scenarios, accounts, accountOwners } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import {
  assertEntitiesInClient,
  assertModelPortfoliosInFirm,
} from "@/lib/db-scoping";
import { recordCreate } from "@/lib/audit";
import { toAccountSnapshot } from "@/lib/audit/snapshots/account";
import {
  type ValidatedOwner,
  validateOwnersShape,
  validateOwnersTenant,
  validateAccountOwnershipRules,
  synthesizeLegacyAccountOwners,
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

// GET /api/clients/[id]/accounts — list accounts for base case scenario
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
      .from(accounts)
      .where(and(eq(accounts.clientId, id), eq(accounts.scenarioId, scenarioId)));

    return NextResponse.json(rows);
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("GET /api/clients/[id]/accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/clients/[id]/accounts — create account for base case scenario
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
      category,
      subType,
      owner,
      value,
      basis,
      growthRate,
      rmdEnabled,
      ownerEntityId,
      growthSource,
      modelPortfolioId,
      turnoverPct,
      overridePctOi,
      overridePctLtCg,
      overridePctQdiv,
      overridePctTaxExempt,
    } = body;

    if (!name || !category) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const entCheck = await assertEntitiesInClient(id, [ownerEntityId]);
    if (!entCheck.ok) {
      return NextResponse.json({ error: entCheck.reason }, { status: 400 });
    }
    const mpCheck = await assertModelPortfoliosInFirm(firmId, [modelPortfolioId]);
    if (!mpCheck.ok) {
      return NextResponse.json({ error: mpCheck.reason }, { status: 400 });
    }

    // ── owners[] validation ────────────────────────────────────────────────
    let resolvedOwners: ValidatedOwner[] | undefined;

    if ("owners" in body && body.owners !== undefined) {
      // New owners[] path
      const shapeResult = validateOwnersShape(body.owners);
      if ("error" in shapeResult) {
        return NextResponse.json({ error: shapeResult.error }, { status: 400 });
      }
      const rulesError = validateAccountOwnershipRules(
        shapeResult.owners,
        subType ?? "other",
        body.isDefaultChecking ?? false,
      );
      if (rulesError) {
        return NextResponse.json({ error: rulesError.error }, { status: 400 });
      }
      const tenantError = await validateOwnersTenant(shapeResult.owners, id);
      if (tenantError) {
        return NextResponse.json({ error: tenantError.error }, { status: 400 });
      }
      resolvedOwners = shapeResult.owners;
    } else {
      // Legacy path: synthesize owners from legacy fields so account is never orphaned
      const synthesized = await synthesizeLegacyAccountOwners(
        id,
        owner,
        ownerEntityId,
        body.ownerFamilyMemberId,
      );
      if (synthesized.length > 0) {
        resolvedOwners = synthesized;
      }
    }
    // ── end owners[] validation ────────────────────────────────────────────

    let account: typeof accounts.$inferSelect;
    await db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(accounts)
        .values({
          clientId: id,
          scenarioId,
          name,
          category,
          subType: subType ?? "other",
          value: value ?? "0",
          basis: basis ?? "0",
          // null = inherit the default growth rate for this category from plan_settings
          growthRate: growthRate ?? null,
          rmdEnabled: rmdEnabled ?? false,
          growthSource: growthSource ?? "default",
          modelPortfolioId: modelPortfolioId ?? null,
          turnoverPct: turnoverPct ?? "0",
          overridePctOi: overridePctOi ?? null,
          overridePctLtCg: overridePctLtCg ?? null,
          overridePctQdiv: overridePctQdiv ?? null,
          overridePctTaxExempt: overridePctTaxExempt ?? null,
          annualPropertyTax: body.annualPropertyTax ?? "0",
          propertyTaxGrowthRate: body.propertyTaxGrowthRate ?? "0.03",
        })
        .returning();
      account = inserted;

      if (resolvedOwners && resolvedOwners.length > 0) {
        for (const o of resolvedOwners) {
          await tx.insert(accountOwners).values({
            accountId: account.id,
            familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
            entityId: o.kind === "entity" ? o.entityId : null,
            percent: o.percent.toString(),
          });
        }
      }
    });

    await recordCreate({
      action: "account.create",
      resourceType: "account",
      resourceId: account!.id,
      clientId: id,
      firmId,
      snapshot: await toAccountSnapshot(account!),
    });

    return NextResponse.json(account!, { status: 201 });
  } catch (err) {
    if (err instanceof Error && err.message === "Unauthorized") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("POST /api/clients/[id]/accounts error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
