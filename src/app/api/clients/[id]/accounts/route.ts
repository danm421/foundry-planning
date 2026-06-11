import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { scenarios, accounts, accountOwners } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import {
  assertAccountsInClient,
  assertEntitiesInClient,
  assertModelPortfoliosInFirm,
  assertTickerPortfoliosInFirm,
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
import { AddBusinessInputSchema } from "@/lib/schemas/accounts-business";
import { verifyClientAccess } from "@/lib/clients/authz";

export const dynamic = "force-dynamic";

/** Map the business-type enum to the analogous `account_sub_type` value so
 *  accounts.sub_type stays consistent with category-specific UIs that filter
 *  on it. `other` business types fall through to the generic `other` sub-type. */
function mapBusinessTypeToSubType(
  bt: "sole_prop" | "partnership" | "s_corp" | "c_corp" | "llc" | "other",
): "sole_proprietorship" | "partnership" | "s_corp" | "c_corp" | "llc" | "other" {
  switch (bt) {
    case "sole_prop":
      return "sole_proprietorship";
    case "partnership":
      return "partnership";
    case "s_corp":
      return "s_corp";
    case "c_corp":
      return "c_corp";
    case "llc":
      return "llc";
    default:
      return "other";
  }
}

async function getBaseCaseScenarioId(clientId: string, firmId: string): Promise<string | null> {
  if (!(await verifyClientAccess(clientId, firmId))) return null;

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

    const rawBody = await request.json();

    // ── Business category: validate with the dedicated schema, then normalize
    //    its `{ familyMemberId | entityId }` owner rows into the canonical
    //    `{ kind, ... }` shape that validateOwnersShape expects below.
    let body = rawBody;
    if (rawBody?.category === "business") {
      const parsed = AddBusinessInputSchema.safeParse(rawBody);
      if (!parsed.success) {
        return NextResponse.json(
          { error: parsed.error.issues[0]?.message ?? "Invalid business input" },
          { status: 400 },
        );
      }
      const b = parsed.data;
      body = {
        ...rawBody,
        ...b,
        // Always derive sub_type from businessType — never honor a client-supplied
        // subType for business accounts (would let callers store nonsensical
        // sub_types like "checking" on a business row).
        subType: mapBusinessTypeToSubType(b.businessType),
      };
    }

    const {
      name,
      category,
      subType,
      owner,
      value,
      basis,
      rothValue,
      growthRate,
      rmdEnabled,
      priorYearEndValue,
      ownerEntityId,
      growthSource,
      modelPortfolioId,
      tickerPortfolioId,
      turnoverPct,
      overridePctOi,
      overridePctLtCg,
      overridePctQdiv,
      overridePctTaxExempt,
      titlingType,
      // Business-only fields. Undefined for every other category.
      businessType,
      distributionPolicyPercent,
      flowMode,
      businessTaxTreatment,
      parentAccountId,
      hsaCoverage,
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
    const tpCheck = await assertTickerPortfoliosInFirm(firmId, [tickerPortfolioId]);
    if (!tpCheck.ok) {
      return NextResponse.json({ error: tpCheck.reason }, { status: 400 });
    }
    // parentAccountId may be set on any category. Verify the referenced row
    // is in this client AND is a business account — the DB FK only checks
    // existence, so without this a crafted POST could attach to an account in
    // another firm or to a non-business parent.
    if (parentAccountId != null) {
      const parentCheck = await assertAccountsInClient(id, [parentAccountId]);
      if (!parentCheck.ok) {
        return NextResponse.json({ error: parentCheck.reason }, { status: 400 });
      }
      const [parentRow] = await db
        .select({ category: accounts.category })
        .from(accounts)
        .where(eq(accounts.id, parentAccountId));
      if (!parentRow || parentRow.category !== "business") {
        return NextResponse.json(
          { error: "parentAccountId must reference a business account" },
          { status: 400 },
        );
      }
    }

    // ── owners[] validation ────────────────────────────────────────────────
    let resolvedOwners: ValidatedOwner[] | undefined;

    if (parentAccountId != null) {
      // Children of a business inherit their ownership via parentAccountId.
      // Skip both the owners[] write and the legacy synthesis path so we
      // don't create stray account_owners rows.
      if (
        "owners" in body &&
        body.owners !== undefined &&
        Array.isArray(body.owners) &&
        body.owners.length > 0
      ) {
        return NextResponse.json(
          {
            error:
              "An account cannot have both a parent business and explicit owners",
          },
          { status: 400 },
        );
      }
      resolvedOwners = undefined;
    } else if ("owners" in body && body.owners !== undefined) {
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

    // Decimal columns reject empty strings — coerce blank inputs (user left
     // the CurrencyInput empty) to "0" so the insert succeeds with the schema
     // default semantics rather than 500ing on a malformed numeric.
     const decOrZero = (v: unknown): string =>
       typeof v === "string" && v.trim() !== "" ? v : typeof v === "number" ? String(v) : "0";

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
          value: decOrZero(value),
          basis: decOrZero(basis),
          rothValue: decOrZero(rothValue),
          // null = inherit the default growth rate for this category from plan_settings
          growthRate: growthRate ?? null,
          rmdEnabled: rmdEnabled ?? false,
          priorYearEndValue: priorYearEndValue ?? null,
          growthSource: growthSource ?? "default",
          modelPortfolioId: modelPortfolioId ?? null,
          tickerPortfolioId: tickerPortfolioId ?? null,
          turnoverPct: turnoverPct ?? "0",
          overridePctOi: overridePctOi ?? null,
          overridePctLtCg: overridePctLtCg ?? null,
          overridePctQdiv: overridePctQdiv ?? null,
          overridePctTaxExempt: overridePctTaxExempt ?? null,
          annualPropertyTax: body.annualPropertyTax ?? "0",
          propertyTaxGrowthRate: body.propertyTaxGrowthRate ?? "0.03",
          propertyTaxGrowthSource: body.propertyTaxGrowthSource ?? "custom",
          titlingType: titlingType ?? "jtwros",
          // Business-only columns (null for non-business categories).
          businessType: category === "business" ? (businessType ?? null) : null,
          distributionPolicyPercent:
            category === "business" && distributionPolicyPercent != null
              ? distributionPolicyPercent.toString()
              : null,
          // flowMode has a NOT NULL default of 'annual' at the DB layer.
          flowMode: category === "business" ? (flowMode ?? "annual") : "annual",
          businessTaxTreatment:
            category === "business" ? (businessTaxTreatment ?? "qbi") : null,
          // parentAccountId allowed on any category — tenant + business-target-validated above.
          parentAccountId: parentAccountId ?? null,
          // hsaCoverage is only meaningful for HSA retirement accounts; null otherwise.
          hsaCoverage:
            category === "retirement" && subType === "hsa"
              ? (hsaCoverage === "family" ? "family" : "self")
              : null,
          custodian: (body.custodian ?? null) || null,
          accountNumberLast4: (body.accountNumberLast4 ?? null) || null,
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

      // Auto-provision a child default-checking cash account on every new
      // top-level business. The Phase-3 engine looks for this exact row to
      // route business income/expense and retained earnings; auto-creating
      // it removes the silent-drop failure mode that hit when users created
      // a business without manually adding a cash bucket underneath.
      //
      // Children of a business inherit ownership via parentAccountId — no
      // account_owners rows. isDefaultChecking=true brings the existing
      // PUT/DELETE guards along (category / sub-type / parent / ownership /
      // deletion are all locked).
      if (category === "business" && parentAccountId == null) {
        await tx.insert(accounts).values({
          clientId: id,
          scenarioId,
          name: `${name} — Cash`,
          category: "cash",
          subType: "checking",
          value: "0",
          basis: "0",
          rothValue: "0",
          growthRate: null,
          rmdEnabled: false,
          growthSource: "default",
          turnoverPct: "0",
          annualPropertyTax: "0",
          propertyTaxGrowthRate: "0.03",
          propertyTaxGrowthSource: "custom",
          titlingType: "jtwros",
          flowMode: "annual",
          parentAccountId: account.id,
          isDefaultChecking: true,
        });
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
