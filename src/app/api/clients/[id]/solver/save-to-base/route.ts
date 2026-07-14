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
// Insert vs update is classified against BASE-scenario membership (NOT the
// possibly-overlay `source` tree): an account / savings rule whose id is NOT
// present in base is INSERTED (the DB generates the canonical uuid); one already
// present is UPDATED. This keeps an overlay-added row from becoming a base-scoped
// UPDATE that silently matches 0 rows. (When source IS base the two coincide.)
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
import { accounts, accountOwners, savingsRules, scenarios, clients, incomes, expenses, planSettings, expenseDedicatedAccounts } from "@/db/schema";
import type { Account, SavingsRule } from "@/engine/types";
import { EDUCATION_529_SENTINEL_OWNER_ID } from "@/engine/ownership";
import type { SolverMutation } from "@/lib/solver/types";
import { SOLVER_MUTATION_SCHEMA } from "@/lib/solver/mutation-schema";
import { mutationsToBaseUpdates } from "@/lib/solver/mutations-to-base-updates";
import { authErrorResponse, requireActiveSubscriptionForFirm } from "@/lib/authz";
import { requireOrgId } from "@/lib/db-helpers";
import {
  assertAccountsInClient,
  assertEntitiesInClient,
  assertExternalBeneficiariesInClient,
  assertFamilyMembersInClient,
} from "@/lib/db-scoping";
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

/** Inferred transaction handle so the owners helper shares the enclosing tx. */
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** (Re)write the account_owners satellite rows for one account. Shared by the
 *  insert path and the update path so a retitle (e.g. into a revocable trust)
 *  persists on UPDATE too — the account column update never touches this table.
 *  Carries external_beneficiary owners, which the solver supports. */
async function insertAccountOwnerRows(
  tx: Tx,
  accountId: string,
  owners: Account["owners"] | undefined,
): Promise<void> {
  for (const o of owners ?? []) {
    // gifted_away owners carry a recipient ref (not a direct FK) and originate
    // from gift events, never a base-savable account-upsert. account_owners has
    // no column for them, so skip rather than write an all-null row that violates
    // the one-owner check constraint.
    if (o.kind === "gifted_away") continue;
    // 529s carry no account_owners rows — the loader synthesizes this sentinel
    // external_beneficiary owner at load time. It is not a real DB row, so never
    // persist it (and its beneficiary lives in the education529 columns instead).
    if (o.kind === "external_beneficiary" && o.externalBeneficiaryId === EDUCATION_529_SENTINEL_OWNER_ID) {
      continue;
    }
    await tx.insert(accountOwners).values({
      accountId,
      familyMemberId: o.kind === "family_member" ? o.familyMemberId : null,
      entityId: o.kind === "entity" ? o.entityId : null,
      externalBeneficiaryId:
        o.kind === "external_beneficiary" ? o.externalBeneficiaryId : null,
      percent: String(o.percent),
    });
  }
}

/** (Re)write expense_dedicated_accounts for one expense, in draw order. Remaps
 *  solver-synthetic account ids to their inserted DB uuids via idRemap (a
 *  dedicated account may have just been created in this same save). Dedupes to
 *  respect the (expense_id, account_id) unique constraint. */
async function insertExpenseDedicatedRows(
  tx: Tx,
  expenseId: string,
  accountIds: string[] | undefined,
  idRemap: Map<string, string>,
): Promise<void> {
  const deduped = [...new Set(accountIds ?? [])];
  if (deduped.length === 0) return;
  await tx.insert(expenseDedicatedAccounts).values(
    deduped.map((accountId, i) => ({
      expenseId,
      accountId: idRemap.get(accountId) ?? accountId,
      sortOrder: i,
    })),
  );
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
    // 529 / education-savings columns (null for every other category). The
    // beneficiary is required for a real 529; the solver sets it from the goal's
    // "For" person. Grantor stays null → the sentinel external beneficiary owner.
    grantorFamilyMemberId: a.education529?.grantorFamilyMemberId ?? null,
    grantorName: a.education529?.grantorName ?? null,
    beneficiaryFamilyMemberId: a.education529?.beneficiaryFamilyMemberId ?? null,
    beneficiaryName: a.education529?.beneficiaryName ?? null,
    rothRolloverEnabled: a.education529?.rothRolloverEnabled ?? false,
    rothRolloverStartYear: a.education529?.rothRolloverStartYear ?? null,
    rothRolloverAccountId: a.education529?.rothRolloverAccountId ?? null,
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
    const [{ effectiveTree: sourceTree }, baseScenarioRows, baseTreeLoad] = await Promise.all([
      loadEffectiveTree(clientId, firmId, source, {}),
      db
        .select({ id: scenarios.id })
        .from(scenarios)
        .where(and(eq(scenarios.clientId, clientId), eq(scenarios.isBaseCase, true))),
      // Base tree for insert-vs-update classification (see the baseMembership
      // block below). Loaded alongside the source tree so a non-base save pays one
      // parallel round-trip, not a second serial one. Null when source IS base —
      // the source tree already reflects base membership.
      source === "base" ? null : loadEffectiveTree(clientId, firmId, "base", {}),
    ]);

    const baseScenarioId = baseScenarioRows[0]?.id;
    if (!baseScenarioId) {
      return NextResponse.json(
        { error: "Client has no base case scenario" },
        { status: 409 },
      );
    }

    // Classify insert-vs-update against what actually lives in the BASE scenario,
    // not the (possibly overlay) source tree. An account/rule added only in an
    // overlay is absent from base, so a source-classified UPDATE would be scoped
    // to base and touch 0 rows — a silent no-op reported as success. When source
    // IS base the source tree already reflects base, so reuse it (baseTreeLoad is
    // null in that case; see the Promise.all above).
    const baseTree = source === "base" ? sourceTree : baseTreeLoad!.effectiveTree;
    const baseMembership = {
      accountIds: new Set((baseTree.accounts ?? []).map((a) => a.id)),
      expenseIds: new Set((baseTree.expenses ?? []).map((e) => e.id)),
      ruleIds: new Set((baseTree.savingsRules ?? []).map((r) => r.id)),
    };

    const {
      accountInserts,
      accountUpdates,
      accountRemoves,
      savingsInserts,
      savingsUpdates,
      savingsRemoves,
      savingsFieldUpdates,
      clientUpdate,
      planSettingsUpdate,
      incomeUpdates,
      expenseUpdates,
      expenseInserts,
      expenseFullUpdates,
      expenseRemoves,
    } = mutationsToBaseUpdates(sourceTree, mutations as SolverMutation[], baseMembership);

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

    // Validate every dedicated-account id an education goal draws from. The
    // expense_dedicated_accounts.account_id FK is GLOBAL (no tenant column), so an
    // unvalidated id could FK-succeed against another firm's account (cross-tenant
    // link) or FK-crash the whole save. Ids satisfied by an in-batch account insert
    // are remapped to their generated uuid inside the txn, so skip those here (same
    // pattern as the savings-rule guard above).
    const dedicatedAccountIds = [...expenseInserts, ...expenseFullUpdates]
      .flatMap((e) => e.dedicatedAccountIds ?? [])
      .filter((aid) => !insertedSyntheticIds.has(aid));
    const dedicatedCheck = await assertAccountsInClient(clientId, dedicatedAccountIds);
    if (!dedicatedCheck.ok) {
      return NextResponse.json({ error: dedicatedCheck.reason }, { status: 400 });
    }

    // Validate the surplus "save remainder to" destination when it's a non-null
    // account NOT satisfied by an in-batch insert. surplus_save_account_id →
    // accounts.id is a GLOBAL FK (no tenant column), so an unvalidated id could
    // link cross-tenant or FK-crash the whole save — same posture as the
    // savings-rule and dedicated-account guards above. In-batch inserts are
    // remapped to their generated uuid inside the txn (below).
    const surplusSaveAccountId =
      typeof planSettingsUpdate?.surplusSaveAccountId === "string"
        ? planSettingsUpdate.surplusSaveAccountId
        : null;
    const surplusAcctToCheck =
      surplusSaveAccountId && !insertedSyntheticIds.has(surplusSaveAccountId)
        ? [surplusSaveAccountId]
        : [];
    const surplusCheck = await assertAccountsInClient(clientId, surplusAcctToCheck);
    if (!surplusCheck.ok) {
      return NextResponse.json({ error: surplusCheck.reason }, { status: 400 });
    }

    // Validate the 529 Roth-rollover destination account FK. education529
    // .roth_rollover_account_id → accounts.id is a GLOBAL FK (no tenant column),
    // so — like the savings-rule, dedicated-account, and surplus guards above —
    // an unvalidated id could link cross-tenant or FK-crash the whole save. Ids
    // satisfied by an in-batch account insert are remapped to their generated
    // uuid inside the txn, so skip those here.
    const rothRolloverAccountIds = [...accountInserts, ...accountUpdates]
      .flatMap((a) => (a.education529?.rothRolloverAccountId ? [a.education529.rothRolloverAccountId] : []))
      .filter((aid) => !insertedSyntheticIds.has(aid));
    const rothRolloverCheck = await assertAccountsInClient(clientId, rothRolloverAccountIds);
    if (!rothRolloverCheck.ok) {
      return NextResponse.json({ error: rothRolloverCheck.reason }, { status: 400 });
    }

    // Validate the owner FKs on every account we (re)write — family members,
    // entities, and external beneficiaries must all belong to this client. Without
    // this a crafted owner id would either FK-crash the whole save (500) or attach
    // a cross-tenant owner. Mirrors the accounts write-core's owner tenant guard,
    // extended to the external_beneficiary kind the solver supports.
    const ownerRows = [...accountInserts, ...accountUpdates].flatMap((a) => a.owners ?? []);
    const fmCheck = await assertFamilyMembersInClient(clientId, [
      ...ownerRows.flatMap((o) => (o.kind === "family_member" ? [o.familyMemberId] : [])),
      // 529 grantor/beneficiary reference family members via the education529
      // block, not account_owners — validate them here or a crafted id could
      // FK-crash the save or attach a cross-tenant beneficiary.
      ...[...accountInserts, ...accountUpdates].flatMap((a) => [
        a.education529?.beneficiaryFamilyMemberId,
        a.education529?.grantorFamilyMemberId,
      ]),
    ]);
    if (!fmCheck.ok) {
      return NextResponse.json({ error: fmCheck.reason }, { status: 400 });
    }
    const entCheck = await assertEntitiesInClient(
      clientId,
      ownerRows.flatMap((o) => (o.kind === "entity" ? [o.entityId] : [])),
    );
    if (!entCheck.ok) {
      return NextResponse.json({ error: entCheck.reason }, { status: 400 });
    }
    const ebCheck = await assertExternalBeneficiariesInClient(
      clientId,
      ownerRows.flatMap((o) =>
        o.kind === "external_beneficiary" && o.externalBeneficiaryId !== EDUCATION_529_SENTINEL_OWNER_ID
          ? [o.externalBeneficiaryId]
          : [],
      ),
    );
    if (!ebCheck.ok) {
      return NextResponse.json({ error: ebCheck.reason }, { status: 400 });
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

        await insertAccountOwnerRows(tx, inserted.id, a.owners);
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

        // The column update above leaves the account_owners satellite untouched,
        // so a retitle (owners changed — e.g. into a revocable trust) would be
        // lost. Re-materialize owners: delete-then-reinsert, mirroring
        // updateAccountForClient. Guarded on a non-empty owners set so a malformed
        // ownerless upsert can't orphan an otherwise-owned account. `a.id` is a
        // base account (it classified as an UPDATE against base membership), so
        // the by-accountId delete stays within this client.
        if (a.owners && a.owners.length > 0) {
          await tx.delete(accountOwners).where(eq(accountOwners.accountId, a.id));
          await insertAccountOwnerRows(tx, a.id, a.owners);
        }
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

      // Insert synthesized / new expense rows (a retirement living expense that
      // didn't previously exist, or a solver-added education goal). Runs AFTER the
      // account-insert loop so a goal's just-created dedicated account resolves via
      // idRemap. Captures the generated id to (re)write the dedicated-account join.
      for (const e of expenseInserts) {
        const [inserted] = await tx
          .insert(expenses)
          .values({
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
            payShortfallOutOfPocket: e.payShortfallOutOfPocket ?? false,
            institutionState: e.institutionState ?? null,
            institutionName: e.institutionName ?? null,
            forFamilyMemberId: e.forFamilyMemberId ?? null,
          })
          .returning({ id: expenses.id });
        await insertExpenseDedicatedRows(tx, inserted.id, e.dedicatedAccountIds, idRemap);
      }

      // Full-row updates to existing base expenses from an education-goal edit
      // (expense-upsert against a row already in base). Re-materialize the
      // dedicated-account join delete-then-reinsert, mirroring updateExpenseForClient.
      for (const e of expenseFullUpdates) {
        await tx
          .update(expenses)
          .set({
            type: e.type,
            name: e.name,
            annualAmount: String(e.annualAmount),
            startYear: e.startYear,
            endYear: e.endYear,
            growthRate: String(e.growthRate),
            payShortfallOutOfPocket: e.payShortfallOutOfPocket ?? false,
            institutionState: e.institutionState ?? null,
            institutionName: e.institutionName ?? null,
            forFamilyMemberId: e.forFamilyMemberId ?? null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(expenses.id, e.id),
              eq(expenses.clientId, clientId),
              eq(expenses.scenarioId, baseScenarioId),
            ),
          );
        await tx
          .delete(expenseDedicatedAccounts)
          .where(eq(expenseDedicatedAccounts.expenseId, e.id));
        await insertExpenseDedicatedRows(tx, e.id, e.dedicatedAccountIds, idRemap);
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

      // Removed education goals. The expense_dedicated_accounts.expense_id FK is
      // onDelete: "cascade", so the join rows disappear with the expense — no
      // explicit join delete needed.
      for (const id of expenseRemoves) {
        await tx
          .delete(expenses)
          .where(
            and(
              eq(expenses.id, id),
              eq(expenses.clientId, clientId),
              eq(expenses.scenarioId, baseScenarioId),
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

      // Horizon follow-through: a life-expectancy edit re-derives planEndYear,
      // pushed to ALL the client's plan_settings rows so the engine's year loop
      // extends with the new LE — mirrors the base-facts PUT route.
      if (planSettingsUpdate) {
        // A surplus "save remainder to" account created inline in THIS batch is a
        // synthetic id until inserted — remap it to the generated DB uuid, the same
        // way savings rules and dedicated accounts are remapped above. Otherwise the
        // FK (surplus_save_account_id → accounts.id) would reference a non-existent
        // id and roll back the whole save. Existing-account and null destinations
        // pass through unchanged.
        const rawSurplusAcct = planSettingsUpdate.surplusSaveAccountId;
        const remappedPlanSettings =
          typeof rawSurplusAcct === "string" && idRemap.has(rawSurplusAcct)
            ? { ...planSettingsUpdate, surplusSaveAccountId: idRemap.get(rawSurplusAcct)! }
            : planSettingsUpdate;
        await tx
          .update(planSettings)
          .set({
            ...(remappedPlanSettings as Partial<typeof planSettings.$inferInsert>),
            updatedAt: new Date(),
          })
          .where(eq(planSettings.clientId, clientId));
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
        planSettingsUpdate: planSettingsUpdate ? 1 : 0,
        incomeUpdates: incomeUpdates.length,
        expenseUpdates: expenseUpdates.length,
        expenseInserts: expenseInserts.length,
        expenseFullUpdates: expenseFullUpdates.length,
        expenseRemoves: expenseRemoves.length,
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
      expenseFullUpdates: expenseFullUpdates.length,
      expenseRemoves: expenseRemoves.length,
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
