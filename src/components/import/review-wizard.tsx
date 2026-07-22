"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type {
  ExtractedAccount,
  ExtractedDependent,
  ExtractedEntity,
  ExtractedExpense,
  ExtractedIncome,
  ExtractedLiability,
  ExtractedLifePolicy,
  ExtractedPrimaryFamilyMember,
  ExtractedSpouseFamilyMember,
  ExtractedWill,
} from "@/lib/extraction/types";
import type { Annotated, ImportPayload, MatchAnnotation } from "@/lib/imports/types";
import type { AssembleAssumption, AssembleGoals, AssemblePlanBasics } from "@/lib/imports/assemble/types";
import { emptyPlanBasics } from "@/lib/imports/assemble/plan-basics";
import { emptyGoals } from "@/lib/imports/assemble/goals";
import type { CommitTab } from "@/lib/imports/commit/types";
import { requiredCommitTabs, type CategoryPresence } from "@/lib/imports/required-tabs";
import type { GrowthContext } from "@/lib/investments/growth-context";
import type { ClientMilestones } from "@/lib/milestones";
import type { AssetOption, RecipientOption } from "./will-bequest-mapper";
import { seedWizardBequest } from "./will-bequest-mapper";
import ReviewStepAccounts from "./review-step-accounts";
import ReviewStepIncomes from "./review-step-incomes";
import ReviewStepExpenses from "./review-step-expenses";
import ReviewStepLiabilities from "./review-step-liabilities";
import ReviewStepEntities from "./review-step-entities";
import PlanBasicsStep from "./plan-basics-step";
import GoalsStep from "./goals-step";
import ReviewStepFamily from "./review-step-family";
import ReviewStepInsurance from "./review-step-insurance";
import ReviewStepWills, {
  areAllBequestsResolved,
  wizardWillsToCommitShape,
  type WizardWill,
} from "./review-step-wills";
import type { MatchCandidate } from "./match-link-picker";
import { SourceFilesContext } from "./source-badge";
import WarningsBanner from "./warnings-banner";

type WizardTabId =
  | "plan-basics"
  | "family"
  | "accounts"
  | "incomes"
  | "expenses"
  | "liabilities"
  | "insurance"
  | "wills"
  | "entities"
  | "goals"
  | "summary";

interface ReviewWizardProps {
  clientId: string;
  importId: string;
  payload: ImportPayload;
  /** Read-only provenance about gap-filled fields — never PATCHed back by commit. */
  assumptions?: AssembleAssumption[];
  perTabCommittedAt: Record<string, string> | null;
  defaultStartYear: number;
  defaultEndYear: number;
  growthContext: GrowthContext;
  /** fileId → original filename, for the per-row source-document badge. */
  fileNames: Record<string, string>;
  milestones?: ClientMilestones;
  clientFirstName?: string;
  spouseFirstName?: string;
}

interface CanonicalRows {
  /** `category`/`subType` carry through for the Goals step, which must scope
   *  its dedicated-funding list to education accounts the way `commitGoals`
   *  scopes its resolution candidates. */
  accounts: { id: string; name: string; category: string; subType: string }[];
  liabilities: { id: string; name: string }[];
  familyMembers: { id: string; firstName: string; lastName: string | null; role: string }[];
  entities: { id: string; name: string }[];
}

const EMPTY_CANONICAL: CanonicalRows = {
  accounts: [],
  liabilities: [],
  familyMembers: [],
  entities: [],
};

/**
 * Wizard tab → CommitTab[] mapping. Family commits both
 * clients-identity (for filing-status updates) and family-members
 * because they share the same wizard step.
 */
const TAB_TO_COMMIT: Record<Exclude<WizardTabId, "summary">, CommitTab[]> = {
  "plan-basics": ["plan-basics"],
  family: ["clients-identity", "family-members"],
  accounts: ["accounts"],
  incomes: ["incomes"],
  expenses: ["expenses"],
  liabilities: ["liabilities"],
  insurance: ["life-insurance"],
  wills: ["wills"],
  entities: ["entities"],
  goals: ["goals"],
};

const TAB_LABEL: Record<WizardTabId, string> = {
  "plan-basics": "Plan basics",
  family: "Family",
  accounts: "Accounts",
  incomes: "Income",
  expenses: "Expenses",
  liabilities: "Liabilities",
  insurance: "Insurance",
  wills: "Wills",
  entities: "Trusts",
  goals: "Goals",
  summary: "Summary",
};

export default function ReviewWizard({
  clientId,
  importId,
  payload,
  assumptions = [],
  perTabCommittedAt,
  defaultStartYear,
  defaultEndYear,
  growthContext,
  fileNames,
  milestones,
  clientFirstName,
  spouseFirstName,
}: ReviewWizardProps) {
  const router = useRouter();

  // Local mutable state seeded from the payload. Each step's onChange
  // updates these; the per-tab Commit button PATCHes the payload back
  // to the server before the commit POST.
  const [primary, setPrimary] = useState<ExtractedPrimaryFamilyMember | undefined>(
    payload.primary,
  );
  const [spouse, setSpouse] = useState<ExtractedSpouseFamilyMember | undefined>(
    payload.spouse,
  );
  const [dependents, setDependents] = useState<Annotated<ExtractedDependent>[]>(
    payload.dependents,
  );
  const [accounts, setAccounts] = useState<Annotated<ExtractedAccount>[]>(
    payload.accounts,
  );
  const [incomes, setIncomes] = useState<Annotated<ExtractedIncome>[]>(payload.incomes);
  const [expenses, setExpenses] = useState<Annotated<ExtractedExpense>[]>(payload.expenses);
  const [liabilities, setLiabilities] = useState<Annotated<ExtractedLiability>[]>(
    payload.liabilities,
  );
  const [lifePolicies, setLifePolicies] = useState<Annotated<ExtractedLifePolicy>[]>(
    payload.lifePolicies,
  );
  const [entities, setEntities] = useState<Annotated<ExtractedEntity>[]>(payload.entities);

  // planBasics is absent on an import assembled before this feature existed,
  // or when derivePlanBasics had too little evidence to run at all. The Plan
  // basics tab is unconditional, so it must never crash on that — fall back
  // to an all-blank shape rather than requiring the caller to guarantee one.
  const [planBasics, setPlanBasics] = useState<AssemblePlanBasics>(
    () => payload.planBasics ?? emptyPlanBasics(),
  );

  // Same absent-on-old-imports rationale as planBasics: an import assembled
  // before this feature existed (or with too little evidence for
  // deriveGoals to run) has no `goals` key at all.
  const [goals, setGoals] = useState<AssembleGoals>(() => payload.goals ?? emptyGoals());

  // Established convention on this branch: a household "has a spouse" when
  // the wizard was handed a spouse first name, rather than a separate signal.
  const hasSpouse = Boolean(spouseFirstName);

  // Wills get their own wizard-internal shape because each bequest
  // gains FK / kind / recipient resolution fields the commit pipeline
  // demands. The matches array lives in parallel since WizardWill drops
  // the Annotated wrapper.
  const [wills, setWills] = useState<WizardWill[]>(() =>
    payload.wills.map((w) => ({
      grantor: w.grantor,
      executor: w.executor,
      executionDate: w.executionDate,
      bequests: w.bequests.map(seedWizardBequest),
      __provenance: w.__provenance,
    })),
  );
  const [willMatches, setWillMatches] = useState<Array<MatchAnnotation | undefined>>(
    () => payload.wills.map((w) => w.match),
  );

  // Canonical rows for the wills bequest mapper's pickers — fetched
  // from the existing client-data endpoints. Refreshed after each
  // commit so newly-created rows surface in the dropdowns.
  const [canonical, setCanonical] = useState<CanonicalRows>(EMPTY_CANONICAL);

  const fetchCanonical = useCallback(async () => {
    const safeJson = async <T,>(r: Response | null): Promise<T[]> => {
      if (!r || !r.ok) return [];
      const body = (await r.json().catch(() => null)) as T[] | null;
      return Array.isArray(body) ? body : [];
    };
    try {
      const [aRes, lRes, fRes, eRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/accounts`).catch(() => null),
        fetch(`/api/clients/${clientId}/liabilities`).catch(() => null),
        fetch(`/api/clients/${clientId}/family-members`).catch(() => null),
        fetch(`/api/clients/${clientId}/entities`).catch(() => null),
      ]);
      const accountsRaw = await safeJson<{
        id: string;
        name: string;
        category?: string;
        subType?: string;
      }>(aRes);
      const liabilitiesRaw = await safeJson<{ id: string; name: string }>(lRes);
      const familyRaw = await safeJson<{
        id: string;
        firstName: string;
        lastName: string | null;
        role: string;
      }>(fRes);
      const entitiesRaw = await safeJson<{ id: string; name: string }>(eRes);
      setCanonical({
        accounts: accountsRaw.map((a) => ({
          id: a.id,
          name: a.name,
          category: a.category ?? "",
          subType: a.subType ?? "",
        })),
        liabilities: liabilitiesRaw.map((l) => ({ id: l.id, name: l.name })),
        familyMembers: familyRaw.map((f) => ({
          id: f.id,
          firstName: f.firstName,
          lastName: f.lastName,
          role: f.role,
        })),
        entities: entitiesRaw.map((e) => ({ id: e.id, name: e.name })),
      });
    } catch {
      // Failures here just leave the dropdowns empty — the wills tab
      // will display zero options and the user will see the Commit
      // button stay disabled. Better than crashing the whole wizard.
    }
  }, [clientId]);

  useEffect(() => {
    fetchCanonical();
  }, [fetchCanonical]);

  const recipientOptions: RecipientOption[] = useMemo(() => {
    const opts: RecipientOption[] = [{ kind: "spouse", id: null, label: "Spouse" }];
    for (const fm of canonical.familyMembers) {
      const last = fm.lastName ? ` ${fm.lastName}` : "";
      opts.push({
        kind: "family_member",
        id: fm.id,
        label: `${fm.firstName}${last} (${fm.role})`,
      });
    }
    for (const e of canonical.entities) {
      opts.push({ kind: "entity", id: e.id, label: e.name });
    }
    return opts;
  }, [canonical]);

  // Stable reference so the accounts step's owner-seeding effect (keyed on this
  // array) only re-runs when the roster actually changes, not on every render.
  const accountFamilyMembers = useMemo(
    () =>
      canonical.familyMembers.map((f) => ({
        id: f.id,
        role: f.role as "client" | "spouse" | "child" | "other",
        firstName: f.firstName,
        lastName: f.lastName,
      })),
    [canonical.familyMembers],
  );

  const assetOptions: AssetOption[] = useMemo(() => {
    const opts: AssetOption[] = [
      { kind: "asset", id: null, assetMode: "all_assets", label: "All assets (residue)" },
    ];
    for (const a of canonical.accounts) {
      opts.push({ kind: "asset", id: a.id, assetMode: "specific", label: a.name });
    }
    for (const l of canonical.liabilities) {
      opts.push({ kind: "liability", id: l.id, label: `Liability: ${l.name}` });
    }
    return opts;
  }, [canonical]);

  const tabs: WizardTabId[] = useMemo(() => {
    const t: WizardTabId[] = ["plan-basics"];
    if (primary || spouse || dependents.length > 0) t.push("family");
    if (accounts.length > 0) t.push("accounts");
    if (incomes.length > 0) t.push("incomes");
    if (expenses.length > 0) t.push("expenses");
    if (liabilities.length > 0) t.push("liabilities");
    if (lifePolicies.length > 0) t.push("insurance");
    if (wills.length > 0) t.push("wills");
    if (entities.length > 0) t.push("entities");
    // Unconditional, like plan-basics: the advisor must be able to add a goal
    // for a household whose documents contained none. Placed last so the
    // strip order matches the commit order it depends on.
    t.push("goals");
    t.push("summary");
    return t;
  }, [primary, spouse, dependents.length, accounts.length, incomes.length, expenses.length, liabilities.length, lifePolicies.length, wills.length, entities.length]);

  const [currentTab, setCurrentTab] = useState<WizardTabId>(tabs[0] ?? "summary");
  const [committingTab, setCommittingTab] = useState<WizardTabId | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  // Warnings returned by the LAST commit POST, for the tabs that click
  // committed. Cleared when a new commit starts and when the advisor moves to
  // another tab, so a warning is never read against the wrong step.
  const [commitWarnings, setCommitWarnings] = useState<string[]>([]);

  /**
   * Snapshot the wizard state into ImportPayload shape so the PATCH
   * payload reflects the latest in-wizard edits.
   */
  const buildLatestPayload = useCallback((): ImportPayload => {
    return {
      primary,
      spouse,
      dependents,
      accounts,
      incomes,
      expenses,
      liabilities,
      lifePolicies,
      wills: wizardWillsToCommitShape(wills).map((w, i) => ({
        ...(w as unknown as ExtractedWill),
        __provenance: wills[i]?.__provenance,
        match: willMatches[i],
      })) as ImportPayload["wills"],
      entities,
      warnings: payload.warnings,
      expenseSlots: payload.expenseSlots,
      planBasics,
      goals,
    };
  }, [primary, spouse, dependents, accounts, incomes, expenses, liabilities, lifePolicies, wills, willMatches, entities, payload.warnings, payload.expenseSlots, planBasics, goals]);

  const handleCommit = useCallback(
    async (tab: WizardTabId) => {
      if (tab === "summary") return;
      if (tab === "wills" && !areAllBequestsResolved(wills)) {
        setCommitError("Resolve every bequest's asset + recipient (or discard) before committing.");
        return;
      }
      setCommittingTab(tab);
      setCommitError(null);
      setCommitWarnings([]);
      try {
        const latest = buildLatestPayload();
        const patchRes = await fetch(
          `/api/clients/${clientId}/imports/${importId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payloadJson: { payload: latest },
            }),
          },
        );
        if (!patchRes.ok) {
          const j = await patchRes.json().catch(() => ({}));
          throw new Error(j.error ?? `PATCH failed (${patchRes.status})`);
        }
        const commitTabs = TAB_TO_COMMIT[tab as Exclude<WizardTabId, "summary">];
        const commitRes = await fetch(
          `/api/clients/${clientId}/imports/${importId}/commit`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ tabs: commitTabs }),
          },
        );
        // The route answers `{ ok, results: Record<CommitTab, CommitResult>,
        // status }` (see the commit route handler). Parse once, then branch —
        // a Response body can only be read a single time.
        const commitBody = (await commitRes.json().catch(() => null)) as {
          error?: string;
          results?: Partial<Record<CommitTab, { warnings?: string[] }>>;
        } | null;
        if (!commitRes.ok) {
          throw new Error(commitBody?.error ?? `Commit failed (${commitRes.status})`);
        }
        // Read only the tabs THIS click committed. `results` is keyed by every
        // CommitTab, and the untouched ones carry an empty warnings array —
        // but a future shape change must not let another tab's warning leak in
        // under this tab's heading.
        setCommitWarnings(
          commitTabs.flatMap((ct) => commitBody?.results?.[ct]?.warnings ?? []),
        );
        await fetchCanonical();
        router.refresh();
      } catch (err) {
        setCommitError((err as Error).message);
      } finally {
        setCommittingTab(null);
      }
    },
    [buildLatestPayload, clientId, importId, fetchCanonical, router, wills],
  );

  const tabCommitted = useCallback(
    (tab: WizardTabId): boolean => {
      if (tab === "summary") return false;
      const commitTabs = TAB_TO_COMMIT[tab as Exclude<WizardTabId, "summary">];
      return commitTabs.every((ct) => Boolean(perTabCommittedAt?.[ct]));
    },
    [perTabCommittedAt],
  );

  const allCommittableTabs = tabs.filter((t) => t !== "summary");

  // Deliberately duplicates `presenceFromPayload` in required-tabs.ts (server
  // side, derived from the persisted ImportPayload) — this memo derives from
  // the wizard's own live edited state, a different shape. The two rules must
  // keep agreeing: a change here needs the matching change there too.
  const presence: CategoryPresence = useMemo(
    () => ({
      family: primary != null || spouse != null || dependents.length > 0,
      accounts: accounts.length > 0,
      incomes: incomes.length > 0,
      expenses: expenses.length > 0,
      liabilities: liabilities.length > 0,
      lifePolicies: lifePolicies.length > 0,
      wills: wills.length > 0,
      entities: entities.length > 0,
      goals: goals.education.length + goals.homePurchases.length > 0,
    }),
    [primary, spouse, dependents.length, accounts.length, incomes.length,
     expenses.length, liabilities.length, lifePolicies.length, wills.length,
     entities.length, goals],
  );

  // Completion is judged against the SAME required set the server uses, so the
  // "All tabs committed" banner can never disagree with the stored status.
  const requiredTabs = useMemo(() => requiredCommitTabs(presence), [presence]);
  const allCommitted = requiredTabs.every((ct) =>
    perTabCommittedAt ? perTabCommittedAt[ct] != null : false,
  );

  const tabCount = (tab: WizardTabId): number => {
    switch (tab) {
      // Not row-driven — there's nothing to count. The tab strip and summary
      // list both hide the count badge for this instead of showing a
      // misleading "0".
      case "plan-basics": return 0;
      case "family":
        return (primary ? 1 : 0) + (spouse ? 1 : 0) + dependents.length;
      case "accounts": return accounts.length;
      case "incomes": return incomes.length;
      case "expenses": return expenses.length;
      case "liabilities": return liabilities.length;
      case "insurance": return lifePolicies.length;
      case "wills": return wills.length;
      case "entities": return entities.length;
      case "goals": return goals.education.length + goals.homePurchases.length;
      case "summary": return 0;
    }
  };

  // Match-column candidates for review-step-accounts
  const accountCandidates: MatchCandidate[] = useMemo(
    () => canonical.accounts.map((a) => ({ id: a.id, name: a.name })),
    [canonical.accounts],
  );
  const accountMatches = accounts.map((a) => a.match);
  const onAccountMatchChange = (i: number, m: MatchAnnotation) => {
    setAccounts(accounts.map((a, idx) => (idx === i ? { ...a, match: m } : a)));
  };
  const existingAccountsById = useMemo(() => {
    const map: Record<string, Partial<ExtractedAccount> & { name?: string }> = {};
    for (const a of canonical.accounts) {
      map[a.id] = { name: a.name };
    }
    return map;
  }, [canonical.accounts]);

  // Match-column candidates for review-step-expenses (living-expense slot linking).
  const expenseCandidates: MatchCandidate[] = useMemo(
    () => (payload.expenseSlots ?? []).map((s) => ({ id: s.id, name: s.name })),
    [payload.expenseSlots],
  );
  const expenseMatches = expenses.map((e) => e.match);
  const onExpenseMatchChange = (i: number, m: MatchAnnotation) => {
    setExpenses(expenses.map((e, idx) => (idx === i ? { ...e, match: m } : e)));
  };

  /**
   * A goal can only be funded by a 529 that already has a DB row: commitGoals
   * resolves funding accounts by querying committed rows. If Goals is committed
   * before Accounts, resolution finds nothing and the goal lands with NO
   * dedicated funding — the 529 silently is never spent, which is the exact
   * defect this phase exists to fix.
   *
   * Commit warnings ARE surfaced now (see `commitWarnings`), so this is no
   * longer the only signal — but a warning arrives after the write, and
   * un-doing a goal that landed without funding means editing the expense by
   * hand. Blocking the click stays the mitigation; the warning is the backstop
   * for the cases this guard cannot see (a renamed 529, an unresolved fuzzy
   * row), which `GoalsStep` also flags before the click.
   */
  const goalsBlockedOnAccounts = useMemo(() => {
    if (currentTab !== "goals") return false;
    const referenced = goals.education.some((g) => g.dedicatedAccountNames.length > 0);
    if (!referenced) return false;
    const accountsPending = accounts.length > 0;
    const accountsCommitted = perTabCommittedAt?.accounts != null;
    return accountsPending && !accountsCommitted;
  }, [currentTab, goals, accounts.length, perTabCommittedAt]);

  return (
    <SourceFilesContext.Provider value={fileNames}>
    <div className="space-y-4">
      <WarningsBanner warnings={payload.warnings} />
      <ImportTotalsBar
        accounts={accounts}
        liabilities={liabilities}
        lifePolicies={lifePolicies}
      />

      <TabStrip
        tabs={tabs}
        currentTab={currentTab}
        committingTab={committingTab}
        onSelect={(t) => {
          // Warnings are about the step that produced them; carrying them onto
          // another tab would read as that tab's problem.
          setCommitWarnings([]);
          setCurrentTab(t);
        }}
        committed={tabCommitted}
        count={tabCount}
      />

      {commitError ? (
        <div className="rounded border border-red-700/50 bg-red-900/20 px-3 py-2 text-sm text-red-300">
          {commitError}
        </div>
      ) : null}

      {/* The commit modules' own warnings — a goal created without dedicated
          funding, a purchase whose down-payment account vanished, a row
          skipped for a missing year. These were previously discarded, which
          made every cross-tab resolution failure silent. */}
      {commitWarnings.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium uppercase tracking-wide text-amber-300">
            Warnings from the last commit
          </p>
          <WarningsBanner warnings={commitWarnings} />
        </div>
      )}

      <div>
        {currentTab === "plan-basics" && (
          <PlanBasicsStep value={planBasics} hasSpouse={hasSpouse} onChange={setPlanBasics} />
        )}
        {currentTab === "family" && (
          <ReviewStepFamily
            primary={primary}
            spouse={spouse}
            dependents={dependents}
            onPrimaryChange={setPrimary}
            onSpouseChange={setSpouse}
            onDependentsChange={(d) => setDependents(d as Annotated<ExtractedDependent>[])}
            assumptions={assumptions}
          />
        )}
        {currentTab === "accounts" && (
          <ReviewStepAccounts
            accounts={accounts}
            onChange={(a) => setAccounts(a as Annotated<ExtractedAccount>[])}
            matches={accountMatches}
            onMatchChange={onAccountMatchChange}
            candidates={accountCandidates}
            existingAccountsById={existingAccountsById}
            modelPortfolios={growthContext.modelPortfolios}
            fundPortfolios={growthContext.fundPortfolios}
            resolvedInflationRate={growthContext.resolvedInflationRate}
            categoryDefaults={growthContext.categoryDefaults}
            familyMembers={accountFamilyMembers}
            entities={canonical.entities}
          />
        )}
        {currentTab === "incomes" && (
          <ReviewStepIncomes
            incomes={incomes}
            onChange={(i) => setIncomes(i as Annotated<ExtractedIncome>[])}
            defaultStartYear={defaultStartYear}
            defaultEndYear={defaultEndYear}
            milestones={milestones}
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
          />
        )}
        {currentTab === "expenses" && (
          <ReviewStepExpenses
            expenses={expenses}
            onChange={(e) => setExpenses(e as Annotated<ExtractedExpense>[])}
            defaultStartYear={defaultStartYear}
            defaultEndYear={defaultEndYear}
            milestones={milestones}
            clientFirstName={clientFirstName}
            spouseFirstName={spouseFirstName}
            matches={expenseMatches}
            onMatchChange={onExpenseMatchChange}
            candidates={expenseCandidates}
          />
        )}
        {currentTab === "liabilities" && (
          <ReviewStepLiabilities
            liabilities={liabilities}
            onChange={(l) => setLiabilities(l as Annotated<ExtractedLiability>[])}
            defaultStartYear={defaultStartYear}
            defaultEndYear={defaultEndYear}
          />
        )}
        {currentTab === "insurance" && (
          <ReviewStepInsurance
            policies={lifePolicies}
            onChange={(p) => setLifePolicies(p as Annotated<ExtractedLifePolicy>[])}
          />
        )}
        {currentTab === "wills" && (
          <ReviewStepWills
            wills={wills}
            onChange={setWills}
            recipientOptions={recipientOptions}
            assetOptions={assetOptions}
            matches={willMatches}
            onMatchChange={(i, m) =>
              setWillMatches(willMatches.map((x, idx) => (idx === i ? m : x)))
            }
          />
        )}
        {currentTab === "entities" && (
          <ReviewStepEntities
            entities={entities}
            onChange={(e) => setEntities(e as Annotated<ExtractedEntity>[])}
          />
        )}
        {currentTab === "goals" && (
          <GoalsStep
            value={goals}
            accountOptions={canonical.accounts}
            dependentOptions={dependents.map((d) => d.firstName).filter(Boolean)}
            currentYear={defaultStartYear}
            onChange={setGoals}
          />
        )}
        {currentTab === "summary" && (
          <SummaryStep
            tabs={allCommittableTabs}
            tabCount={tabCount}
            committed={tabCommitted}
            perTabCommittedAt={perTabCommittedAt}
            allCommitted={allCommitted}
            onDone={() => router.refresh()}
          />
        )}
      </div>

      {currentTab !== "summary" && (
        <div className="space-y-2 border-t border-hair pt-3">
          {goalsBlockedOnAccounts && (
            <p className="text-xs text-amber-400">
              Commit the Accounts step first — these goals draw from a 529 that has not been created yet.
            </p>
          )}
          <div className="flex items-center justify-between">
            <div className="text-xs text-ink-4">
              {tabCommitted(currentTab)
                ? `Committed ${formatTimestamp(currentTab, perTabCommittedAt)}`
                : "Pending commit"}
            </div>
            <button
              onClick={() => handleCommit(currentTab)}
              disabled={committingTab !== null || tabCommitted(currentTab) || goalsBlockedOnAccounts}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
            >
              {committingTab === currentTab
                ? "Committing…"
                : tabCommitted(currentTab)
                  ? "✓ Committed"
                  : `Commit ${TAB_LABEL[currentTab]}`}
            </button>
          </div>
        </div>
      )}
    </div>
    </SourceFilesContext.Provider>
  );
}

function formatTimestamp(
  tab: WizardTabId,
  perTabCommittedAt: Record<string, string> | null,
): string {
  if (tab === "summary" || !perTabCommittedAt) return "";
  const commitTabs = TAB_TO_COMMIT[tab as Exclude<WizardTabId, "summary">];
  const ts = perTabCommittedAt[commitTabs[0]];
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

const fmtUsd = (val: number): string =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(val);

interface ImportTotalsBarProps {
  accounts: Annotated<ExtractedAccount>[];
  liabilities: Annotated<ExtractedLiability>[];
  lifePolicies: Annotated<ExtractedLifePolicy>[];
}

/**
 * At-a-glance dollar totals of the data being imported, shown above the tabs.
 * Each stat appears only when its category has rows; "Net worth" surfaces only
 * when there are both accounts and liabilities (otherwise it just restates one
 * of them). Recomputes live as the user edits values in the tabs.
 */
function ImportTotalsBar({ accounts, liabilities, lifePolicies }: ImportTotalsBarProps) {
  const stats = useMemo(() => {
    const totalAccounts = accounts.reduce((s, a) => s + (a.value ?? 0), 0);
    const totalLiabilities = liabilities.reduce((s, l) => s + (l.balance ?? 0), 0);
    const totalDeathBenefit = lifePolicies.reduce((s, p) => s + (p.faceValue ?? 0), 0);

    const out: { label: string; value: string }[] = [];
    if (accounts.length > 0) out.push({ label: "Accounts", value: fmtUsd(totalAccounts) });
    if (liabilities.length > 0)
      out.push({ label: "Liabilities", value: fmtUsd(totalLiabilities) });
    if (accounts.length > 0 && liabilities.length > 0)
      out.push({ label: "Net worth", value: fmtUsd(totalAccounts - totalLiabilities) });
    if (lifePolicies.length > 0)
      out.push({ label: "Death benefit", value: fmtUsd(totalDeathBenefit) });
    return out;
  }, [accounts, liabilities, lifePolicies]);

  if (stats.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-10 gap-y-3 rounded-lg border border-hair bg-card-2 px-5 py-4">
      {stats.map((s) => (
        <div key={s.label} className="flex flex-col gap-1">
          <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3">
            {s.label}
          </span>
          <span className="tabular text-2xl font-semibold leading-none text-ink">
            {s.value}
          </span>
        </div>
      ))}
    </div>
  );
}

interface TabStripProps {
  tabs: WizardTabId[];
  currentTab: WizardTabId;
  committingTab: WizardTabId | null;
  onSelect: (t: WizardTabId) => void;
  committed: (t: WizardTabId) => boolean;
  count: (t: WizardTabId) => number;
}

function TabStrip({ tabs, currentTab, committingTab, onSelect, committed, count }: TabStripProps) {
  return (
    <div className="flex flex-wrap gap-2 border-b border-hair pb-2">
      {tabs.map((t) => {
        const isCurrent = t === currentTab;
        const isCommitted = committed(t);
        const isCommitting = committingTab === t;
        return (
          <button
            key={t}
            onClick={() => onSelect(t)}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              isCurrent
                ? "bg-accent text-accent-on"
                : isCommitted
                  ? "bg-good/15 text-good"
                  : "bg-card-2 text-ink-3 hover:bg-card-hover hover:text-ink-2"
            }`}
          >
            <span>{TAB_LABEL[t]}</span>
            {t !== "summary" && t !== "plan-basics" && (
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] ${
                  isCurrent ? "bg-black/20" : "bg-black/10"
                }`}
              >
                {count(t)}
              </span>
            )}
            {isCommitting ? (
              <span className="text-[10px]">…</span>
            ) : isCommitted ? (
              <span className="text-[10px]">✓</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

interface SummaryStepProps {
  tabs: WizardTabId[];
  tabCount: (t: WizardTabId) => number;
  committed: (t: WizardTabId) => boolean;
  perTabCommittedAt: Record<string, string> | null;
  allCommitted: boolean;
  onDone: () => void;
}

function SummaryStep({
  tabs,
  tabCount,
  committed,
  perTabCommittedAt,
  allCommitted,
  onDone,
}: SummaryStepProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-lg font-medium text-gray-100">Summary</h3>
      <ul className="divide-y divide-hair rounded-lg border border-hair">
        {tabs.map((t) => (
          <li key={t} className="flex items-center justify-between px-3 py-2 text-sm">
            <div className="flex items-center gap-3">
              <span className="text-ink-2">{TAB_LABEL[t]}</span>
              {t !== "plan-basics" && (
                <span className="rounded bg-card-2 px-1.5 py-0.5 text-[11px] text-ink-3">
                  {tabCount(t)}
                </span>
              )}
            </div>
            <div className="text-xs">
              {committed(t) ? (
                <span className="text-good">
                  ✓ Committed {formatTimestamp(t, perTabCommittedAt)}
                </span>
              ) : (
                <span className="text-amber-400">Pending</span>
              )}
            </div>
          </li>
        ))}
      </ul>

      {allCommitted ? (
        <div className="flex items-center justify-between rounded-md bg-good/10 px-3 py-2">
          <span className="text-sm text-good">All tabs committed.</span>
          <button
            onClick={onDone}
            className="rounded-md bg-good px-4 py-2 text-sm font-medium text-black hover:bg-good/80"
          >
            Done
          </button>
        </div>
      ) : (
        <p className="text-xs text-ink-4">
          Commit each remaining tab from its own page to enable Done.
        </p>
      )}
    </div>
  );
}
