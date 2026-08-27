import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { accounts, annuityContracts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgId } from "@/lib/db-helpers";
import { recordAudit } from "@/lib/audit";
import { parseBody } from "@/lib/schemas/common";
import { annuityContractSchema } from "@/lib/schemas/annuities";
import { verifyClientAccess, requireClientEditAccess } from "@/lib/clients/authz";
import { requireActiveSubscriptionForFirm, authErrorResponse } from "@/lib/authz";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

// QLACs are capped by IRS regulation, currently indexed to $210,000 for 2026.
// This is a soft warning, not an enforced limit — Foundry flags advisor
// entry, it does not block it.
const QLAC_PREMIUM_CAP_2026 = 210_000;

/**
 * Tenant-isolation guard, reused by GET and PUT: confirm the target account
 * exists, belongs to this client, and is an annuity account. A single guard
 * satisfies both "rejects a contract on a non-annuity account" and "scopes to
 * the caller's org" — a cross-client account id fails the `clientId` half of
 * the predicate exactly like a wrong-category account fails the `category`
 * half, and both come back as a 404 "Account not found" rather than leaking
 * which half failed.
 */
async function findAnnuityAccount(clientId: string, accountId: string) {
  const [target] = await db
    .select()
    .from(accounts)
    .where(
      and(
        eq(accounts.id, accountId),
        eq(accounts.clientId, clientId),
        eq(accounts.category, "annuity"),
      ),
    );
  return target;
}

/** Decimal columns are strings on the wire from drizzle; convert to numbers
 *  (or null) for the JSON response. Field-for-field symmetric with
 *  `annuityContractSchema`'s body — no `accountId`, which the schema
 *  `.strict()`-rejects as an unknown key and which the caller already has
 *  from the URL — so a GET response can be PUT straight back unmodified. */
function serializeContract(row: typeof annuityContracts.$inferSelect) {
  const num = (v: string | null): number | null => (v == null ? null : Number(v));
  return {
    carrier: row.carrier,
    contractNumberLast4: row.contractNumberLast4,
    productType: row.productType,
    taxTreatment: row.taxTreatment,
    costBasis: num(row.costBasis),
    surrenderChargePct: num(row.surrenderChargePct),
    surrenderEndYear: row.surrenderEndYear,
    annualFeePct: Number(row.annualFeePct),
    incomeMode: row.incomeMode,
    incomeStartYear: row.incomeStartYear,
    incomeStartYearRef: row.incomeStartYearRef,
    payoutStructure: row.payoutStructure,
    survivorPct: num(row.survivorPct),
    periodCertainYears: row.periodCertainYears,
    benefitBase: num(row.benefitBase),
    rollupRate: num(row.rollupRate),
    rollupEndYear: row.rollupEndYear,
    rollupRatchets: row.rollupRatchets,
    riderFeePct: num(row.riderFeePct),
    payoutPct: num(row.payoutPct),
    annuitizedPayment: num(row.annuitizedPayment),
    expectedReturnYears: num(row.expectedReturnYears),
  };
}

// GET /api/clients/[id]/annuity-contracts/[accountId]
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    await requireOrgId();
    const access = await verifyClientAccess(id);
    if (!access.ok) {
      return NextResponse.json({ error: "Client not found" }, { status: 404 });
    }
    const target = await findAnnuityAccount(id, accountId);
    if (!target) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }
    const [row] = await db
      .select()
      .from(annuityContracts)
      .where(eq(annuityContracts.accountId, accountId));
    return NextResponse.json(row ? serializeContract(row) : null);
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("GET /api/clients/[id]/annuity-contracts/[accountId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/clients/[id]/annuity-contracts/[accountId]
// Upsert of a 1:1 extension row keyed by accountId.
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; accountId: string }> },
) {
  try {
    const { id, accountId } = await params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(id);
    await requireActiveSubscriptionForFirm(firmId);

    const target = await findAnnuityAccount(id, accountId);
    if (!target) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    const parsed = await parseBody(annuityContractSchema, request);
    if (!parsed.ok) return parsed.response;
    const input = parsed.data;

    // Every column named once here — reused for both the insert values and
    // the upsert's `set`, never a spread of the raw request body or
    // `parsed.data` (the mass-assignment pattern already flagged across ~30
    // sites in this repo).
    const contractFields = {
      carrier: input.carrier ?? null,
      contractNumberLast4: input.contractNumberLast4 ?? null,
      productType: input.productType,
      taxTreatment: input.taxTreatment,
      costBasis: input.costBasis != null ? String(input.costBasis) : null,
      surrenderChargePct:
        input.surrenderChargePct != null ? String(input.surrenderChargePct) : null,
      surrenderEndYear: input.surrenderEndYear ?? null,
      annualFeePct: String(input.annualFeePct),
      incomeMode: input.incomeMode,
      incomeStartYear: input.incomeStartYear ?? null,
      // `YEAR_REFS` is asserted `[string, ...string[]]` in the schema so
      // `z.enum` accepts a runtime-shared array, which widens the inferred
      // type back to `string` — same cast insurance-policies.ts already
      // applies to this exact enum column at its DB write site.
      incomeStartYearRef: (input.incomeStartYearRef ?? null) as
        (typeof annuityContracts.$inferInsert)["incomeStartYearRef"],
      payoutStructure: input.payoutStructure ?? null,
      survivorPct: input.survivorPct != null ? String(input.survivorPct) : null,
      periodCertainYears: input.periodCertainYears ?? null,
      benefitBase: input.benefitBase != null ? String(input.benefitBase) : null,
      rollupRate: input.rollupRate != null ? String(input.rollupRate) : null,
      rollupEndYear: input.rollupEndYear ?? null,
      rollupRatchets: input.rollupRatchets,
      riderFeePct: input.riderFeePct != null ? String(input.riderFeePct) : null,
      payoutPct: input.payoutPct != null ? String(input.payoutPct) : null,
      annuitizedPayment: input.annuitizedPayment != null ? String(input.annuitizedPayment) : null,
      expectedReturnYears:
        input.expectedReturnYears != null ? String(input.expectedReturnYears) : null,
    };

    await db
      .insert(annuityContracts)
      .values({ accountId, ...contractFields })
      .onConflictDoUpdate({
        target: annuityContracts.accountId,
        set: { ...contractFields, updatedAt: new Date() },
      });

    // QLAC premiums are capped by IRS reg — flagged, never blocked. There is
    // no premium column on annuity_contracts; the premium is the account's
    // own value, already loaded above by the tenant-isolation guard.
    const warnings: string[] = [];
    const accountValue = Number(target.value);
    if (input.productType === "qlac" && accountValue > QLAC_PREMIUM_CAP_2026) {
      warnings.push(
        `QLAC premiums are capped at $210,000 for 2026 — this account's value of ` +
          `$${accountValue.toLocaleString()} exceeds it.`,
      );
    }

    await recordAudit({
      action: "account.annuity.update",
      resourceType: "annuity_contract",
      resourceId: accountId,
      clientId: id,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        productType: input.productType,
        incomeMode: input.incomeMode,
      }),
    });

    return NextResponse.json({ ok: true, warnings });
  } catch (err) {
    const r = authErrorResponse(err);
    if (r) return NextResponse.json(r.body, { status: r.status });
    console.error("PUT /api/clients/[id]/annuity-contracts/[accountId] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
