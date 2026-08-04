"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ExtractedAccount,
  ExtractedDependent,
  ExtractedExpense,
  ExtractedIncome,
  ExtractedLiability,
  ExtractedLifePolicy,
  ExtractedSavings,
  ExtractedPrimaryFamilyMember,
  ExtractedSpouseFamilyMember,
} from "@/lib/extraction/types";
import type { Annotated, ImportPayload, MatchAnnotation } from "@/lib/imports/types";
import { adoptMatches } from "@/lib/imports/commit-links";
import ReviewStepAccounts from "@/components/import/review-step-accounts";
import ReviewStepIncomes from "@/components/import/review-step-incomes";
import ReviewStepExpenses from "@/components/import/review-step-expenses";
import ReviewStepLiabilities from "@/components/import/review-step-liabilities";
import ReviewStepFamily from "@/components/import/review-step-family";
import ReviewStepInsurance from "@/components/import/review-step-insurance";
import type { MatchCandidate } from "@/components/import/match-link-picker";
import { SourceFilesContext } from "@/components/import/source-badge";
import {
  STEP_COMMIT_TABS,
  type ImportEligibleStep,
} from "@/lib/onboarding/import-sections";

interface CanonicalRows {
  accounts: { id: string; name: string }[];
  familyMembers: {
    id: string;
    firstName: string;
    lastName: string | null;
    role: string;
  }[];
  entities: { id: string; name: string }[];
}

const EMPTY_CANONICAL: CanonicalRows = {
  accounts: [],
  familyMembers: [],
  entities: [],
};

interface WizardImportReviewProps {
  clientId: string;
  importId: string;
  step: ImportEligibleStep;
  payload: ImportPayload;
  /** Map of CommitTab → ISO timestamp from client_imports.perTabCommittedAt. */
  perTabCommittedAt: Record<string, string> | null;
  /** Called after a successful commit so the drawer can refresh + close. */
  onCommitted: () => void;
  /** fileId → original filename, for the per-row source-document badge. */
  fileNames: Record<string, string>;
}

export default function WizardImportReview({
  clientId,
  importId,
  step,
  payload,
  perTabCommittedAt,
  onCommitted,
  fileNames,
}: WizardImportReviewProps) {
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
  // No step EDITS savings, but the Assets step commits it
  // (`STEP_COMMIT_TABS.accounts` includes "savings"), so its rows must be held
  // in state to carry the links a commit stamps on them. Left as the frozen
  // mount prop, an "Apply again" would PATCH a link-less array back over the
  // server's link and insert a duplicate savings rule.
  const [savings, setSavings] = useState<Annotated<ExtractedSavings>[]>(payload.savings);

  const [canonical, setCanonical] = useState<CanonicalRows>(EMPTY_CANONICAL);
  const [committing, setCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  const currentYear = new Date().getFullYear();

  const fetchCanonical = useCallback(async () => {
    const safeJson = async <T,>(r: Response | null): Promise<T[]> => {
      if (!r || !r.ok) return [];
      const body = (await r.json().catch(() => null)) as T[] | null;
      return Array.isArray(body) ? body : [];
    };
    try {
      const [aRes, fRes, eRes] = await Promise.all([
        fetch(`/api/clients/${clientId}/accounts`).catch(() => null),
        fetch(`/api/clients/${clientId}/family-members`).catch(() => null),
        fetch(`/api/clients/${clientId}/entities`).catch(() => null),
      ]);
      const accountsRaw = await safeJson<{ id: string; name: string }>(aRes);
      const familyRaw = await safeJson<{
        id: string;
        firstName: string;
        lastName: string | null;
        role: string;
      }>(fRes);
      const entitiesRaw = await safeJson<{ id: string; name: string }>(eRes);
      setCanonical({
        accounts: accountsRaw.map((a) => ({ id: a.id, name: a.name })),
        familyMembers: familyRaw.map((f) => ({
          id: f.id,
          firstName: f.firstName,
          lastName: f.lastName,
          role: f.role,
        })),
        entities: entitiesRaw.map((e) => ({ id: e.id, name: e.name })),
      });
    } catch {
      // Leave dropdowns empty rather than crash — matches ReviewWizard.
    }
  }, [clientId]);

  // Canonical rows only feed the accounts match-picker — the other steps
  // never read them.
  useEffect(() => {
    if (step === "accounts") fetchCanonical();
  }, [step, fetchCanonical]);

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

  const accountCandidates: MatchCandidate[] = useMemo(
    () => canonical.accounts.map((a) => ({ id: a.id, name: a.name })),
    [canonical.accounts],
  );
  const accountMatches = accounts.map((a) => a.match);
  const existingAccountsById = useMemo(() => {
    const map: Record<string, Partial<ExtractedAccount> & { name?: string }> = {};
    for (const a of canonical.accounts) map[a.id] = { name: a.name };
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

  // The wizard PATCHes the whole payload before committing its own tabs, so
  // sections no step edits (wills, entities, savings…) have to round-trip
  // untouched — dropping them here would erase them from the shared draft.
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
      wills: payload.wills,
      entities: payload.entities,
      savings,
      warnings: payload.warnings,
      expenseSlots: payload.expenseSlots,
      planBasics: payload.planBasics,
    };
  }, [
    primary,
    spouse,
    dependents,
    accounts,
    incomes,
    expenses,
    liabilities,
    lifePolicies,
    payload.wills,
    payload.entities,
    savings,
    payload.warnings,
    payload.expenseSlots,
    payload.planBasics,
  ]);

  const alreadyCommitted = STEP_COMMIT_TABS[step].every((ct) =>
    Boolean(perTabCommittedAt?.[ct]),
  );

  /**
   * Adopt the row → canonical-record links the commit just stamped server-side.
   *
   * This drawer's "Apply again" re-POSTs the same tabs, and each apply PATCHes
   * the whole local payload first — which replaces `payloadJson.payload`
   * wholesale. Without adopting the links here, a second apply would ship a
   * link-less payload and INSERT a duplicate of every row the first apply
   * created. Matched positionally: commit mutates the arrays in place and
   * never reorders them; the length guard makes a mismatch a no-op.
   */
  const adoptCommitLinks = useCallback((server: ImportPayload | undefined) => {
    if (!server) return;
    setDependents((p) => adoptMatches(p, server.dependents));
    setAccounts((p) => adoptMatches(p, server.accounts));
    setIncomes((p) => adoptMatches(p, server.incomes));
    setExpenses((p) => adoptMatches(p, server.expenses));
    setLiabilities((p) => adoptMatches(p, server.liabilities));
    setLifePolicies((p) => adoptMatches(p, server.lifePolicies));
    setSavings((p) => adoptMatches(p, server.savings));
  }, []);

  const handleCommit = useCallback(async () => {
    setCommitting(true);
    setCommitError(null);
    try {
      const latest = buildLatestPayload();
      const patchRes = await fetch(`/api/clients/${clientId}/imports/${importId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payloadJson: { payload: latest } }),
      });
      if (!patchRes.ok) {
        const j = await patchRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `Save failed (${patchRes.status})`);
      }
      const commitRes = await fetch(
        `/api/clients/${clientId}/imports/${importId}/commit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tabs: STEP_COMMIT_TABS[step] }),
        },
      );
      const commitBody = (await commitRes.json().catch(() => null)) as {
        error?: string;
        payload?: ImportPayload;
      } | null;
      if (!commitRes.ok) {
        throw new Error(commitBody?.error ?? `Apply failed (${commitRes.status})`);
      }
      adoptCommitLinks(commitBody?.payload);
      onCommitted();
    } catch (err) {
      setCommitError((err as Error).message);
    } finally {
      setCommitting(false);
    }
  }, [step, adoptCommitLinks, buildLatestPayload, clientId, importId, onCommitted]);

  return (
    <SourceFilesContext.Provider value={fileNames}>
    <div className="space-y-4">
      {commitError ? (
        <div
          role="alert"
          className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad"
        >
          {commitError}
        </div>
      ) : null}

      <div>
        {step === "family" && (
          <ReviewStepFamily
            primary={primary}
            spouse={spouse}
            dependents={dependents}
            onPrimaryChange={setPrimary}
            onSpouseChange={setSpouse}
            onDependentsChange={(d) => setDependents(d as Annotated<ExtractedDependent>[])}
          />
        )}
        {step === "accounts" && (
          <ReviewStepAccounts
            accounts={accounts}
            onChange={(a) => setAccounts(a as Annotated<ExtractedAccount>[])}
            matches={accountMatches}
            onMatchChange={(i, m) =>
              setAccounts(accounts.map((a, idx) => (idx === i ? { ...a, match: m } : a)))
            }
            candidates={accountCandidates}
            existingAccountsById={existingAccountsById}
            familyMembers={accountFamilyMembers}
            entities={canonical.entities}
          />
        )}
        {step === "cash-flow" && (
          <div className="space-y-6">
            <ReviewStepIncomes
              incomes={incomes}
              onChange={(i) => setIncomes(i as Annotated<ExtractedIncome>[])}
              defaultStartYear={currentYear}
              defaultEndYear={currentYear + 30}
            />
            <ReviewStepExpenses
              expenses={expenses}
              onChange={(e) => setExpenses(e as Annotated<ExtractedExpense>[])}
              defaultStartYear={currentYear}
              defaultEndYear={currentYear + 30}
              matches={expenseMatches}
              onMatchChange={onExpenseMatchChange}
              candidates={expenseCandidates}
            />
          </div>
        )}
        {step === "liabilities" && (
          <ReviewStepLiabilities
            liabilities={liabilities}
            onChange={(l) => setLiabilities(l as Annotated<ExtractedLiability>[])}
            defaultStartYear={currentYear}
            defaultEndYear={currentYear + 30}
          />
        )}
        {step === "insurance" && (
          <ReviewStepInsurance
            policies={lifePolicies}
            onChange={(p) => setLifePolicies(p as Annotated<ExtractedLifePolicy>[])}
          />
        )}
      </div>

      <div className="flex items-center justify-between border-t border-hair pt-3">
        <span className="text-xs text-ink-4">
          {alreadyCommitted ? "Already applied" : "Review, then apply to this step"}
        </span>
        <button
          type="button"
          onClick={handleCommit}
          disabled={committing}
          aria-busy={committing}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-ink disabled:opacity-50"
        >
          {committing
            ? "Applying…"
            : alreadyCommitted
              ? "Apply again"
              : "Apply to this step"}
        </button>
      </div>
    </div>
    </SourceFilesContext.Provider>
  );
}
