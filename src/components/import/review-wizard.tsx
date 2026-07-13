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
import type { CommitTab } from "@/lib/imports/commit/types";
import type { GrowthContext } from "@/lib/investments/growth-context";
import type { ClientMilestones } from "@/lib/milestones";
import type { AssetOption, RecipientOption } from "./will-bequest-mapper";
import { seedWizardBequest } from "./will-bequest-mapper";
import ReviewStepAccounts from "./review-step-accounts";
import ReviewStepIncomes from "./review-step-incomes";
import ReviewStepExpenses from "./review-step-expenses";
import ReviewStepLiabilities from "./review-step-liabilities";
import ReviewStepEntities from "./review-step-entities";
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
  | "family"
  | "accounts"
  | "incomes"
  | "expenses"
  | "liabilities"
  | "insurance"
  | "wills"
  | "entities"
  | "summary";

interface ReviewWizardProps {
  clientId: string;
  importId: string;
  payload: ImportPayload;
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
  accounts: { id: string; name: string }[];
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
  family: ["clients-identity", "family-members"],
  accounts: ["accounts"],
  incomes: ["incomes"],
  expenses: ["expenses"],
  liabilities: ["liabilities"],
  insurance: ["life-insurance"],
  wills: ["wills"],
  entities: ["entities"],
};

const TAB_LABEL: Record<WizardTabId, string> = {
  family: "Family",
  accounts: "Accounts",
  incomes: "Income",
  expenses: "Expenses",
  liabilities: "Liabilities",
  insurance: "Insurance",
  wills: "Wills",
  entities: "Trusts",
  summary: "Summary",
};

export default function ReviewWizard({
  clientId,
  importId,
  payload,
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
      const accountsRaw = await safeJson<{ id: string; name: string }>(aRes);
      const liabilitiesRaw = await safeJson<{ id: string; name: string }>(lRes);
      const familyRaw = await safeJson<{
        id: string;
        firstName: string;
        lastName: string | null;
        role: string;
      }>(fRes);
      const entitiesRaw = await safeJson<{ id: string; name: string }>(eRes);
      setCanonical({
        accounts: accountsRaw.map((a) => ({ id: a.id, name: a.name })),
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
    const t: WizardTabId[] = [];
    if (primary || spouse || dependents.length > 0) t.push("family");
    if (accounts.length > 0) t.push("accounts");
    if (incomes.length > 0) t.push("incomes");
    if (expenses.length > 0) t.push("expenses");
    if (liabilities.length > 0) t.push("liabilities");
    if (lifePolicies.length > 0) t.push("insurance");
    if (wills.length > 0) t.push("wills");
    if (entities.length > 0) t.push("entities");
    t.push("summary");
    return t;
  }, [primary, spouse, dependents.length, accounts.length, incomes.length, expenses.length, liabilities.length, lifePolicies.length, wills.length, entities.length]);

  const [currentTab, setCurrentTab] = useState<WizardTabId>(tabs[0] ?? "summary");
  const [committingTab, setCommittingTab] = useState<WizardTabId | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

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
    };
  }, [primary, spouse, dependents, accounts, incomes, expenses, liabilities, lifePolicies, wills, willMatches, entities, payload.warnings, payload.expenseSlots]);

  const handleCommit = useCallback(
    async (tab: WizardTabId) => {
      if (tab === "summary") return;
      if (tab === "wills" && !areAllBequestsResolved(wills)) {
        setCommitError("Resolve every bequest's asset + recipient (or discard) before committing.");
        return;
      }
      setCommittingTab(tab);
      setCommitError(null);
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
        if (!commitRes.ok) {
          const j = await commitRes.json().catch(() => ({}));
          throw new Error(j.error ?? `Commit failed (${commitRes.status})`);
        }
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
  const allCommitted = allCommittableTabs.every(tabCommitted);

  const tabCount = (tab: WizardTabId): number => {
    switch (tab) {
      case "family":
        return (primary ? 1 : 0) + (spouse ? 1 : 0) + dependents.length;
      case "accounts": return accounts.length;
      case "incomes": return incomes.length;
      case "expenses": return expenses.length;
      case "liabilities": return liabilities.length;
      case "insurance": return lifePolicies.length;
      case "wills": return wills.length;
      case "entities": return entities.length;
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
        onSelect={setCurrentTab}
        committed={tabCommitted}
        count={tabCount}
      />

      {commitError ? (
        <div className="rounded border border-red-700/50 bg-red-900/20 px-3 py-2 text-sm text-red-300">
          {commitError}
        </div>
      ) : null}

      <div>
        {currentTab === "family" && (
          <ReviewStepFamily
            primary={primary}
            spouse={spouse}
            dependents={dependents}
            onPrimaryChange={setPrimary}
            onSpouseChange={setSpouse}
            onDependentsChange={(d) => setDependents(d as Annotated<ExtractedDependent>[])}
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
        <div className="flex items-center justify-between border-t border-hair pt-3">
          <div className="text-xs text-ink-4">
            {tabCommitted(currentTab)
              ? `Committed ${formatTimestamp(currentTab, perTabCommittedAt)}`
              : "Pending commit"}
          </div>
          <button
            onClick={() => handleCommit(currentTab)}
            disabled={committingTab !== null || tabCommitted(currentTab)}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
          >
            {committingTab === currentTab
              ? "Committing…"
              : tabCommitted(currentTab)
                ? "✓ Committed"
                : `Commit ${TAB_LABEL[currentTab]}`}
          </button>
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
            {t !== "summary" && (
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
              <span className="rounded bg-card-2 px-1.5 py-0.5 text-[11px] text-ink-3">
                {tabCount(t)}
              </span>
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
