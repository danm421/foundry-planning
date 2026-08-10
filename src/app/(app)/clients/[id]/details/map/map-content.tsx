import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  assetClasses,
  crmHouseholdContacts,
  entities,
  familyMembers,
  modelPortfolioAllocations,
  planSettings,
  scenarios,
} from "@/db/schema";
import { ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";
import { requireClientAccess } from "@/lib/clients/authz";
import { birthYearFromDob } from "@/lib/age-year";
import { loadEffectiveTree } from "@/lib/scenario/loader";
import {
  accountEngineToView,
  expenseEngineToView,
  incomeEngineToView,
  savingsRuleEngineToView,
  type ExpenseView,
  type IncomeView,
  type SavingsRuleView,
} from "@/lib/scenario/view-adapters";
import {
  buildAccountRows,
  linkedSourceMapFrom,
  loadAccountMetaRows,
} from "@/lib/accounts/load-account-rows";
import { loadOverlaidAccountMeta } from "@/lib/scenario/account-meta";
import { loadImportGrowthContext } from "@/lib/investments/growth-context";
import { categoryDefaultRates as buildCategoryDefaultRates } from "@/lib/investments/category-default-rates";
import { buildMapBoards } from "@/lib/household-map/build-boards";
import { moneyLabel } from "@/lib/household-map/format";
import { isHydratableExpense, isHydratableIncome } from "@/lib/household-map/map-items";
import { isSocialSecurityIncome } from "@/lib/household-map/social-security";
import { buildFlowScenarioFields } from "@/lib/inline-edit/flow-write";
import { pruneScenarioFields } from "@/lib/inline-edit/scenario-fields";
import type { Expense, Income, SavingsRule } from "@/engine/types";
import HouseholdMapView from "@/components/household-map/household-map-view";

interface MapContentProps {
  clientId: string;
  scenarioParam: string | undefined;
}

export async function MapContent({ clientId: id, scenarioParam }: MapContentProps) {
  // Access gate + client row + permission in one call. Returns the OWNING
  // firmId, which is what the engine loader needs (a cross-firm shared client
  // still loads against the firm that owns it).
  const access = await requireClientAccess(id).catch((err: unknown) => {
    // Narrow: only an auth denial becomes a 404. A DB/runtime fault must stay
    // a 500 rather than being laundered into "not found".
    if (err instanceof ForbiddenError || err instanceof UnauthorizedError) return null;
    throw err;
  });
  if (!access) notFound();
  const { client: clientRow, firmId, permission } = access;

  // CRM contacts — sole source of identity (firstName, DOB) for milestone math.
  const contactRows = await db
    .select()
    .from(crmHouseholdContacts)
    .where(eq(crmHouseholdContacts.householdId, clientRow.crmHouseholdId));
  const primaryContact = contactRows.find((c) => c.role === "primary");
  const spouseContact = contactRows.find((c) => c.role === "spouse");
  if (!primaryContact?.dateOfBirth) notFound();
  const client = {
    ...clientRow,
    dateOfBirth: primaryContact.dateOfBirth,
    spouseDob: spouseContact?.dateOfBirth ?? null,
  };

  const [scenario] = await db
    .select()
    .from(scenarios)
    .where(and(eq(scenarios.clientId, id), eq(scenarios.isBaseCase, true)));

  if (!scenario) {
    return (
      <div className="rounded-lg border border-hair bg-card p-6 text-center text-ink-2">
        No base case scenario found.
      </div>
    );
  }

  const [
    entityRows,
    familyMemberRows,
    { effectiveTree },
    accountMetaRows,
    growthContext,
    settingsRows,
    assetClassRows,
    allocationRows,
  ] =
    await Promise.all([
      db.select().from(entities).where(eq(entities.clientId, id)).orderBy(asc(entities.name)),
      db
        .select({
          id: familyMembers.id,
          role: familyMembers.role,
          firstName: familyMembers.firstName,
          dateOfBirth: familyMembers.dateOfBirth,
        })
        .from(familyMembers)
        .where(eq(familyMembers.clientId, id))
        .orderBy(asc(familyMembers.role), asc(familyMembers.firstName)),
      loadEffectiveTree(id, firmId, scenarioParam ?? "base", {}),
      // Both take the BASE scenario id, not `scenarioParam`, and both are
      // correct for opposite reasons.
      //
      //   `loadAccountMetaRows` is base-scoped BY DESIGN — the scenario overlay
      //   is a separate step (`loadOverlaidAccountMeta` below), because scenario
      //   account metadata lives in `scenario_changes` payloads rather than in
      //   duplicated `accounts` rows.
      //
      //   `loadImportGrowthContext` reads `plan_settings` with a direct
      //   `(clientId, scenarioId)` equality. Only the base scenario has a row,
      //   so a non-base id returns ZERO rows and the function degrades silently:
      //   `resolvedInflationRate` collapses to 0% and every `categoryDefaults`
      //   entry goes null. `net-worth-content.tsx` scopes its own plan-settings
      //   select the same way — do not "fix" either of these to `scenarioParam`.
      loadAccountMetaRows(id, scenario.id),
      loadImportGrowthContext(id, firmId, scenario.id),
      db
        .select()
        .from(planSettings)
        .where(and(eq(planSettings.clientId, id), eq(planSettings.scenarioId, scenario.id))),
      db.select().from(assetClasses).where(eq(assetClasses.firmId, firmId)),
      db.select().from(modelPortfolioAllocations),
    ]);

  const effectiveClient = effectiveTree.client;

  // Every board — cards, goals, net worth, person nodes — comes out of
  // `buildMapBoards`, which the client portal's Organizer also calls, so a card
  // cannot mean one thing on one surface and something else on the other. The
  // provenance rule it enforces (everything scenario-overridable is read off the
  // effective tree, never the raw client row) is documented there, with the code.
  //
  // `dateOfBirth` / `spouseDob` are passed separately, from their CRM-contact
  // source (`client`, gated above): identity is not scenario-overridable.
  const { people, items, goals, netWorth } = buildMapBoards({
    effectiveTree,
    identity: {
      dateOfBirth: client.dateOfBirth,
      spouseDob: client.spouseDob,
      lifeExpectancy: client.lifeExpectancy,
    },
    familyMemberRows,
    entityRows,
    today: new Date(),
  });

  // Editor hydration rows — the SAME `effectiveTree` the cards above are built
  // from, run through the house view-adapters (`@/lib/scenario/view-adapters`,
  // the layer that exists so pages read through `loadEffectiveTree` instead of
  // querying base rows). Client-side editors seed from these, never from the
  // base-scoped list-GETs, so a save made while a scenario is active carries
  // that scenario's values rather than clobbering them with base ones.
  //
  // Two classes of row deliberately get NO hydration entry, and both keep their
  // card — `isHydratableIncome` / `isHydratableExpense` in
  // `@/lib/household-map/map-items` own the rule and document it in full:
  //
  //   1. Synthesized life-insurance rows (`source: "policy"` — `premium-<uuid>`
  //      expenses from `insurance-policies/premium-expense.ts`,
  //      `policy-income-<uuid>` incomes from `policy-income.ts`) have no DB row,
  //      so neither write path can accept them.
  //   2. Social-security incomes. The quick-edit drawer submits a fixed
  //      nine-key body and the scenario changes-writer replaces the change
  //      payload WHOLESALE, so a no-op Save from the Map would delete a
  //      "claim at 70" scenario's edit row outright.
  //
  // Both keep their cards on purpose: a premium is a real outflow and an SS
  // benefit is real income, so dropping either would understate a band
  // subtotal.
  //
  // The two exclusions no longer mean the same thing for the CARD, though.
  // Policy rows stay inert — no DB row exists, so no write path can accept them.
  // Social security is excluded from THIS map only to keep it away from the
  // quick-edit drawer; `ssIncomeRows` below routes it to `SocialSecurityDialog`
  // instead, which submits every SS field and so cannot produce the empty diff.
  const incomeRows: Record<string, IncomeView> = Object.fromEntries(
    effectiveTree.incomes
      .filter(isHydratableIncome)
      .map((i: Income) => [i.id, incomeEngineToView(i)] as const),
  );
  // The FULL engine rows, not `IncomeView`s: the view type carries none of
  // `claimingAge`, `claimingAgeMonths`, `claimingAgeMode`, `piaMonthly` or
  // `ssBenefitMode`, so a view-hydrated dialog would open every scenario at
  // "claim at FRA" and save that back over the scenario's real choice.
  const ssIncomes = effectiveTree.incomes.filter(isSocialSecurityIncome);
  const ssIncomeRows: Record<string, Income> = Object.fromEntries(
    ssIncomes.map((i: Income) => [i.id, i] as const),
  );
  const expenseRows: Record<string, ExpenseView> = Object.fromEntries(
    effectiveTree.expenses
      .filter(isHydratableExpense)
      .map((e: Expense) => [e.id, expenseEngineToView(e)] as const),
  );
  const savingsRuleRows: Record<string, SavingsRuleView> = Object.fromEntries(
    effectiveTree.savingsRules.map((s: SavingsRule) => [s.id, savingsRuleEngineToView(s)] as const),
  );
  // Built separately because `savingsRuleEngineToView` is a documented partial
  // and does not carry `scheduleOverrides`. Engine shape is
  // `Record<number, number>`; `SavingsRuleDialog` wants `{year, amount}[]`.
  // Sorted explicitly — numeric-keyed object iteration is ascending-integer in
  // practice, but the grid's ordering must not rest on that.
  const savingsSchedules: Record<string, { year: number; amount: number }[]> = Object.fromEntries(
    effectiveTree.savingsRules
      .filter((s: SavingsRule) => s.scheduleOverrides && Object.keys(s.scheduleOverrides).length > 0)
      .map(
        (s: SavingsRule) =>
          [
            s.id,
            Object.entries(s.scheduleOverrides!)
              .map(([year, amount]) => ({ year: Number(year), amount }))
              .sort((a, b) => a.year - b.year),
          ] as const,
      ),
  );
  // Scenario-edit field sets for the Cash Flow board's inline amount editor —
  // the EFFECTIVE ENGINE ROWS, pruned, not the view rows above. A scenario edit's
  // payload is stored as a wholesale replace, so it has to carry every field this
  // scenario already overrides; the three view types are strict subsets of the
  // engine types and the fields they drop (`endsAtMedicareEligibilityOwner`,
  // `fundFromExpenseReduction`, `isSelfEmployment`) are ones real producers
  // override. `lib/inline-edit/flow-write.ts` documents the whole rule.
  //
  // Filtered by the SAME hydratability predicates as the rows above so the two
  // maps agree on which flows the Map may write — a row with a card but no
  // hydration entry must not become writable through this map instead.
  const flowScenarioFields: Record<string, Record<string, unknown>> = Object.fromEntries([
    ...effectiveTree.incomes
      .filter(isHydratableIncome)
      .map((i: Income) => [i.id, buildFlowScenarioFields(i)] as const),
    ...effectiveTree.expenses
      .filter(isHydratableExpense)
      .map((e: Expense) => [e.id, buildFlowScenarioFields(e)] as const),
    ...effectiveTree.savingsRules.map(
      (s: SavingsRule) => [s.id, buildFlowScenarioFields(s)] as const,
    ),
  ]);

  // The same pruned WRITE payload `flowScenarioFields` carries, for the SS rows
  // that map deliberately omits (it is filtered by `isHydratableIncome`, which
  // excludes them). Kept as its own map rather than folded into that one so the
  // two stay legible as what they are: `flowScenarioFields` is the Cash Flow
  // board's, this is the Goals board's Social Security card's. They are keyed by
  // the same ids and built by the same function; nothing but the reader differs.
  const ssScenarioFields: Record<string, Record<string, unknown>> = Object.fromEntries(
    ssIncomes.map((i: Income) => [i.id, buildFlowScenarioFields(i)] as const),
  );

  const accountOptions = effectiveTree.accounts.map(accountEngineToView);

  // The COMPLETE per-account row: scenario-effective engine accounts merged
  // with the scenario-overlaid view-only metadata the engine type discards.
  // `accountOptions` above is `accountEngineToView`, a documented PARTIAL that
  // drops `growthSource` / `modelPortfolioId` — anything reading or writing
  // growth reads THIS map instead. Keyed by id because the boards look rows up
  // per card, not by iterating.
  const accountMetaById = await loadOverlaidAccountMeta(id, accountMetaRows, scenarioParam);
  const accountRows = Object.fromEntries(
    buildAccountRows({
      accounts: effectiveTree.accounts,
      familyMembers: effectiveTree.familyMembers ?? [],
      accountMetaById,
      linkedSourceById: linkedSourceMapFrom(accountMetaRows),
    }).map((r) => [r.id, r]),
  );

  // Per-category default RATES (decimal strings, all ten categories) — the
  // shared extraction the Net Worth page uses, so the Map's "Plan default"
  // option cannot quote a different number than the account dialog does.
  // Distinct from `growthContext.categoryDefaults`, which is a display-label
  // map covering three categories.
  const categoryDefaultRates = buildCategoryDefaultRates(
    settingsRows[0],
    growthContext.modelPortfolios,
    growthContext.resolvedInflationRate,
  );

  // Built exactly as `net-worth-content.tsx` builds them for the same dialog:
  // `geometricReturn` and `weight` parsed to numbers, and `slug` carried (the
  // form keys its inflation asset class off it). The plan's snippet passed the
  // raw Drizzle strings and omitted the slug.
  const assetClassOptions = assetClassRows.map((ac) => ({
    id: ac.id,
    name: ac.name,
    slug: ac.slug,
    geometricReturn: parseFloat(ac.geometricReturn),
  }));

  const portfolioAllocationsMap: Record<string, { assetClassId: string; weight: number }[]> = {};
  for (const a of allocationRows) {
    (portfolioAllocationsMap[a.modelPortfolioId] ??= []).push({
      assetClassId: a.assetClassId,
      weight: parseFloat(a.weight),
    });
  }

  // The dialog labels "Plan default" with the portfolio backing that category.
  // `growthContext.categoryDefaults` already carries name + blended pct per
  // category; reshape it rather than re-deriving. It covers only taxable / cash
  // / retirement — the dialog treats a missing category as having no named
  // default, which is correct.
  const categoryDefaultSources: Record<
    string,
    { source: string; portfolioId?: string; portfolioName?: string; blendedReturn?: number }
  > = {};
  for (const [category, d] of Object.entries(growthContext.categoryDefaults)) {
    categoryDefaultSources[category] = d.portfolioName
      ? {
          source: "model_portfolio",
          portfolioName: d.portfolioName,
          blendedReturn: d.blendedReturnPct != null ? d.blendedReturnPct / 100 : undefined,
        }
      : { source: "inflation" };
  }

  const accountRowList = Object.values(accountRows);
  const businessOptions = accountRowList
    .filter((a) => a.category === "business" && a.parentAccountId == null)
    .map((a) => ({ id: a.id, name: a.name }));
  const rothIraAccountOptions = accountRowList
    .filter((a) => a.subType === "roth_ira")
    .map((a) => ({ id: a.id, name: a.name }));

  // Scenario-edit field sets for the two singletons the Goals board's
  // life-expectancy editor writes. Same wholesale-replace rule as
  // `flowScenarioFields` above: a scenario edit's stored payload REPLACES the
  // previous one, so the write has to carry every field this scenario already
  // overrides or it deletes them. Two of them because the plan horizon straddles
  // both singletons — `planEndAge` on `client`, `planEndYear` on `plan_settings`
  // — and one `scenario_changes` row targets exactly one kind. See
  // `lib/household-map/life-expectancy-write.ts`.
  const clientScenarioFields = pruneScenarioFields(effectiveClient);
  const planSettingsScenarioFields = pruneScenarioFields(effectiveTree.planSettings);

  return (
    <HouseholdMapView
      clientId={id}
      people={people}
      netWorthLabel={moneyLabel(netWorth)}
      items={items}
      goals={goals}
      canEdit={permission === "edit"}
      incomeRows={incomeRows}
      ssIncomeRows={ssIncomeRows}
      expenseRows={expenseRows}
      savingsRuleRows={savingsRuleRows}
      savingsSchedules={savingsSchedules}
      flowScenarioFields={flowScenarioFields}
      ssScenarioFields={ssScenarioFields}
      clientScenarioFields={clientScenarioFields}
      planSettingsScenarioFields={planSettingsScenarioFields}
      // The typed READ models for `SocialSecurityDialog`, distinct from the two
      // pruned WRITE payloads above. Scenario-effective, so a solver "retire at
      // 62" scenario resolves an `at_retirement` claim age to 62 in the dialog
      // exactly as `ssStartNote` did on the card that opened it.
      clientInfo={effectiveClient}
      planSettings={effectiveTree.planSettings}
      accountOptions={accountOptions}
      accountRows={accountRows}
      growthContext={growthContext}
      categoryDefaultRates={categoryDefaultRates}
      assetClassOptions={assetClassOptions}
      portfolioAllocationsMap={portfolioAllocationsMap}
      categoryDefaultSources={categoryDefaultSources}
      businessOptions={businessOptions}
      rothIraAccountOptions={rothIraAccountOptions}
      resolvedInflationRate={effectiveTree.planSettings.inflationRate}
      // `birthYear` is for the quick-edit drawer's education goal, which
      // time-boxes the goal to the beneficiary's college years. Null when the
      // DOB is absent or unparseable — the drawer then simply skips the
      // auto-fill rather than inventing a start year.
      familyMemberOptions={familyMemberRows.map(({ id: fmId, role, firstName, dateOfBirth }) => ({
        id: fmId,
        role,
        firstName,
        birthYear: birthYearFromDob(dateOfBirth),
      }))}
      entityOptions={entityRows.map((e) => ({ id: e.id, name: e.name }))}
    />
  );
}
