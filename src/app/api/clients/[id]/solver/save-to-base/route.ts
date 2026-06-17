// src/app/api/clients/[id]/solver/save-to-base/route.ts
//
// POST /api/clients/[id]/solver/save-to-base
//
// Commits a set of Solver working-state mutations into the client's BASE facts
// (plan of record), rather than into a new scenario. Covers the client
// singleton (retirement ages / life expectancy), incomes (incl. Social
// Security), expenses (incl. living-expense scale), savings rules (field edits
// + full upserts), and accounts. Field-edit levers apply PARTIAL column updates
// (see mutationsToBaseUpdates), so engine-unknown columns are never clobbered.
// Technique upserts (roth / asset-transaction / reinvestment) and the
// engine-only `income-self-employment` flag are not base-writable and are left
// in the working set for the user to save as a scenario instead.
//
// Insert vs update is classified against the loaded `source` tree: an account /
// savings rule whose id is NOT present in the source is INSERTED (the DB
// generates the canonical uuid); one already present is UPDATED.
//
// Security:
//   - INSERTs are written into the client's base-case scenario, scoped by
//     clientId + baseScenarioId.
//   - UPDATEs are scoped by BOTH clientId (org isolation) AND baseScenarioId,
//     so an overlay row belonging to a non-base scenario — or a row in another
//     firm — can never be touched by guessing its id.
//   - A savings rule's accountId is remapped to the just-inserted account uuid
//     when it references an account inserted in the same batch; any remaining
//     accountId is verified to belong to this client (assertAccountsInClient)
//     before it is written, mirroring the accounts route's parent-account guard.
// The whole batch runs in one transaction.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { accounts, accountOwners, savingsRules, scenarios, clients, incomes, expenses } from "@/db/schema";
import type { Account, SavingsRule } from "@/engine/types";
import type { SolverMutation } from "@/lib/solver/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { mutationsToBaseUpdates } from "@/lib/solver/mutations-to-base-updates";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import { assertAccountsInClient } from "@/lib/db-scoping";
import { requireClientEditAccess } from "@/lib/clients/authz";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import { recordAudit } from "@/lib/audit";
import { crossFirmAuditMeta } from "@/lib/clients/cross-firm-audit";

export const dynamic = "force-dynamic";

const BODY = z.object({
  source: z.union([z.literal("base"), z.string().uuid()]),
  mutations: z.array(SOLVER_MUTATION_SCHEMA).min(1),
});

type RouteCtx = { params: Promise<{ id: string }> };

/** Decimal columns reject empty strings — coerce blank/undefined inputs to
 *  "0" so the insert succeeds with default semantics rather than 500ing. */
function decOrZero(v: unknown): string {
  return typeof v === "number"
    ? String(v)
    : typeof v === "string" && v.trim() !== ""
      ? v
      : "0";
}

function accountInsertValues(
  a: Account,
  clientId: string,
  scenarioId: string,
): typeof accounts.$inferInsert {
  return {
    clientId,
    scenarioId,
    name: a.name,
    category: a.category,
    // Engine `subType` is a plain string; the DB column is an enum. Casting
    // here matches the accounts POST route, which writes the same value
    // straight through (its source object is untyped). Invalid values are
    // rejected at the DB layer.
    subType: (a.subType ?? "other") as typeof accounts.$inferInsert.subType,
    value: decOrZero(a.value),
    basis: decOrZero(a.basis),
    rothValue: decOrZero(a.rothValue),
    hsaCoverage: a.hsaCoverage ?? null,
    // null = inherit the default growth rate for this category from plan_settings.
    growthRate: a.growthRate != null ? String(a.growthRate) : null,
    rmdEnabled: a.rmdEnabled ?? false,
    priorYearEndValue: a.priorYearEndValue != null ? String(a.priorYearEndValue) : null,
    titlingType: a.titlingType ?? "jtwros",
  };
}

function savingsInsertValues(
  r: SavingsRule,
  clientId: string,
  scenarioId: string,
  accountId: string,
): typeof savingsRules.$inferInsert {
  return {
    clientId,
    scenarioId,
    accountId,
    annualAmount: decOrZero(r.annualAmount),
    annualPercent: r.annualPercent != null ? String(r.annualPercent) : null,
    rothPercent: r.rothPercent != null ? String(r.rothPercent) : null,
    isDeductible: r.isDeductible ?? true,
    applyContributionLimit: r.applyContributionLimit ?? true,
    contributeMax: r.contributeMax ?? false,
    startYear: Number(r.startYear),
    endYear: Number(r.endYear),
    growthRate: r.growthRate != null ? String(r.growthRate) : undefined,
    startYearRef: (r.startYearRef ?? null) as typeof savingsRules.$inferInsert.startYearRef,
    endYearRef: (r.endYearRef ?? null) as typeof savingsRules.$inferInsert.endYearRef,
  };
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id: clientId } = await ctx.params;
    const callerOrg = await requireOrgId();
    const { firmId, access } = await requireClientEditAccess(clientId);
    await requireActiveSubscriptionForFirm(firmId);

    const raw = await req.json();
    const parsed = BODY.safeParse(raw);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid body", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const { source, mutations } = parsed.data;

    // Load the source tree to classify insert-vs-update, and fetch the base
    // scenario id to scope every write. Base-facts writes always target the
    // base case regardless of which tree the solver worked against.
    const [{ effectiveTree: sourceTree }, baseScenarioRows] = await Promise.all([
      loadEffectiveTree(clientId, firmId, source, {}),
      db
        .select({ id: scenarios.id })
        .from(scenarios)
        .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true))),
    ]);

    const baseScenarioId = baseScenarioRows[0]?.id;
    if (!baseScenarioId) {
      return NextResponse.json(
        { error: "Client has no base case scenario" },
        { status: 409 },
      );
    }

    const {
      accountInserts,
      accountUpdates,
      accountRemoves,
      savingsInserts,
      savingsUpdates,
      savingsRemoves,
      savingsFieldUpdates,
      clientUpdate,
      incomeUpdates,
      expenseUpdates,
      expenseInserts,
    } = mutationsToBaseUpdates(sourceTree, mutations as SolverMutation[]);

    // Validate any savings-rule accountId that is NOT satisfied by an account
    // inserted in this same batch — it must already belong to this client.
    // (In-batch inserts are remapped to their generated uuid inside the txn.)
    const insertedSyntheticIds = new Set(accountInserts.map((a) => a.id));
    const externalAccountIds = [...savingsInserts, ...savingsUpdates]
      .map((r) => r.accountId)
      .filter((aid) => !insertedSyntheticIds.has(aid));
    const acctCheck = await assertAccountsInClient(clientId, externalAccountIds);
    if (!acctCheck.ok) {
      return NextResponse.json({ error: acctCheck.reason }, { status: 400 });
    }

    await db.transaction(async (tx) => {
      // Maps a solver-supplied (synthetic) account id → the canonical DB uuid
      // generated on insert, so paired savings rules attach to the real row.
      const idRemap = new Map<string, string>();

      for (const a of accountInserts) {
        const [inserted] = await tx
          .insert(accounts)
          .values(accountInsertValues(a, clientId, baseScenarioId))
          .returning({ id: accounts.id });
        idRemap.set(a.id, inserted.id);

        for (const o of a.owners ?? []) {
          await tx.insert(accountOwners).values({
            accountId: inserted.id,
            familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
            entityId: o.kind === "entity" ? o.entityId : null,
            externalBeneficiaryId:
              o.kind === "external_beneficiary" ? o.externalBeneficiaryId : null,
            percent: String(o.percent),
          });
        }
      }

      for (const a of accountUpdates) {
        await tx
          .update(accounts)
          .set({
            name: a.name,
            subType: (a.subType ?? "other") as typeof accounts.$inferInsert.subType,
            value: decOrZero(a.value),
            basis: decOrZero(a.basis),
            rothValue: decOrZero(a.rothValue),
            hsaCoverage: a.hsaCoverage ?? null,
            growthRate: a.growthRate != null ? String(a.growthRate) : null,
            rmdEnabled: a.rmdEnabled ?? false,
            priorYearEndValue:
              a.priorYearEndValue != null ? String(a.priorYearEndValue) : null,
            titlingType: a.titlingType ?? "jtwros",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(accounts.id, a.id),
              eq(accounts.clientId, clientId),
              eq(accounts.scenarioId, baseScenarioId),
            ),
          );
      }

      for (const r of savingsInserts) {
        const accountId = idRemap.get(r.accountId) ?? r.accountId;
        await tx
          .insert(savingsRules)
          .values(savingsInsertValues(r, clientId, baseScenarioId, accountId));
      }

      for (const r of savingsUpdates) {
        const accountId = idRemap.get(r.accountId) ?? r.accountId;
        await tx
          .update(savingsRules)
          .set({
            accountId,
            annualAmount: decOrZero(r.annualAmount),
            annualPercent: r.annualPercent != null ? String(r.annualPercent) : null,
            rothPercent: r.rothPercent != null ? String(r.rothPercent) : null,
            isDeductible: r.isDeductible ?? true,
            applyContributionLimit: r.applyContributionLimit ?? true,
            contributeMax: r.contributeMax ?? false,
            startYear: Number(r.startYear),
            endYear: Number(r.endYear),
            growthRate: r.growthRate != null ? String(r.growthRate) : undefined,
          })
          .where(
            and(
              eq(savingsRules.id, r.id),
              eq(savingsRules.clientId, clientId),
              eq(savingsRules.scenarioId, baseScenarioId),
            ),
          );
      }

      // Partial column updates to existing savings rules from field-edit levers.
      for (const { id, set } of savingsFieldUpdates) {
        await tx
          .update(savingsRules)
          .set({ ...(set as Partial<typeof savingsRules.$inferInsert>), updatedAt: new Date() })
          .where(
            and(
              eq(savingsRules.id, id),
              eq(savingsRules.clientId, clientId),
              eq(savingsRules.scenarioId, baseScenarioId),
            ),
          );
      }

      // Partial column updates to existing incomes (incl. Social Security rows).
      for (const { id, set } of incomeUpdates) {
        await tx
          .update(incomes)
          .set({ ...(set as Partial<typeof incomes.$inferInsert>), updatedAt: new Date() })
          .where(
            and(
              eq(incomes.id, id),
              eq(incomes.clientId, clientId),
              eq(incomes.scenarioId, baseScenarioId),
            ),
          );
      }

      // Partial column updates to existing expenses (incl. living-expense scale).
      for (const { id, set } of expenseUpdates) {
        await tx
          .update(expenses)
          .set({ ...(set as Partial<typeof expenses.$inferInsert>), updatedAt: new Date() })
          .where(
            and(
              eq(expenses.id, id),
              eq(expenses.clientId, clientId),
              eq(expenses.scenarioId, baseScenarioId),
            ),
          );
      }

      // Insert synthesized expense rows (e.g. a retirement living expense that
      // didn't previously exist in the base facts).
      for (const e of expenseInserts) {
        await tx.insert(expenses).values({
          clientId,
          scenarioId: baseScenarioId,
          type: e.type,
          name: e.name,
          annualAmount: String(e.annualAmount),
          startYear: e.startYear,
          endYear: e.endYear,
          growthRate: String(e.growthRate),
          startYearRef: (e.startYearRef ?? null) as typeof expenses.$inferInsert.startYearRef,
          endYearRef: (e.endYearRef ?? null) as typeof expenses.$inferInsert.endYearRef,
          source: (e.source ?? "manual") as typeof expenses.$inferInsert.source,
        });
      }

      // Removes — savings rules before accounts (FK: rules reference accounts).
      for (const id of savingsRemoves) {
        await tx
          .delete(savingsRules)
          .where(
            and(
              eq(savingsRules.id, id),
              eq(savingsRules.clientId, clientId),
              eq(savingsRules.scenarioId, baseScenarioId),
            ),
          );
      }
      for (const id of accountRemoves) {
        await tx
          .delete(accounts)
          .where(
            and(
              eq(accounts.id, id),
              eq(accounts.clientId, clientId),
              eq(accounts.scenarioId, baseScenarioId),
            ),
          );
      }

      // Client singleton update (retirement ages / life expectancy). The clients
      // row is firm-scoped, not scenario-scoped.
      if (clientUpdate) {
        await tx
          .update(clients)
          .set({ ...(clientUpdate as Partial<typeof clients.$inferInsert>), updatedAt: new Date() })
          .where(and(eq(clients.id, clientId), eq(clients.firmId, firmId)));
      }
    });

    await recordAudit({
      action: "client.base_facts.update",
      resourceType: "client",
      resourceId: clientId,
      clientId,
      firmId,
      metadata: crossFirmAuditMeta({ access }, callerOrg, {
        source: "solver",
        requestSource: source,
        accountInserts: accountInserts.length,
        accountUpdates: accountUpdates.length,
        accountRemoves: accountRemoves.length,
        savingsInserts: savingsInserts.length,
        savingsUpdates: savingsUpdates.length,
        savingsRemoves: savingsRemoves.length,
        savingsFieldUpdates: savingsFieldUpdates.length,
        clientUpdate: clientUpdate ? 1 : 0,
        incomeUpdates: incomeUpdates.length,
        expenseUpdates: expenseUpdates.length,
        expenseInserts: expenseInserts.length,
      }),
    });

    return NextResponse.json({
      ok: true,
      accountInserts: accountInserts.length,
      accountUpdates: accountUpdates.length,
      accountRemoves: accountRemoves.length,
      savingsInserts: savingsInserts.length,
      savingsUpdates: savingsUpdates.length,
      savingsRemoves: savingsRemoves.length,
      savingsFieldUpdates: savingsFieldUpdates.length,
      clientUpdate: clientUpdate ? 1 : 0,
      incomeUpdates: incomeUpdates.length,
      expenseUpdates: expenseUpdates.length,
      expenseInserts: expenseInserts.length,
    });
  } catch (err) {
    const authResp = authErrorResponse(err);
    if (authResp) {
      return NextResponse.json(authResp.body, { status: authResp.status });
    }
    console.error("POST /api/clients/[id]/solver/save-to-base error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
