"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { AssetOption, RecipientOption } from "@/components/import/will-bequest-mapper";
import { seedWizardBequest } from "@/components/import/will-bequest-mapper";
import ReviewStepAccounts from "@/components/import/review-step-accounts";
import ReviewStepIncomes from "@/components/import/review-step-incomes";
import ReviewStepExpenses from "@/components/import/review-step-expenses";
import ReviewStepLiabilities from "@/components/import/review-step-liabilities";
import ReviewStepEntities from "@/components/import/review-step-entities";
import ReviewStepFamily from "@/components/import/review-step-family";
import ReviewStepInsurance from "@/components/import/review-step-insurance";
import ReviewStepWills, {
  areAllBequestsResolved,
  wizardWillsToCommitShape,
  type WizardWill,
} from "@/components/import/review-step-wills";
import type { MatchCandidate } from "@/components/import/match-link-picker";
import {
  STEP_COMMIT_TABS,
  type ImportEligibleStep,
} from "@/lib/onboarding/import-sections";

interface CanonicalRows {
  accounts: { id: string; name: string }[];
  liabilities: { id: string; name: string }[];
  familyMembers: {
    id: string;
    firstName: string;
    lastName: string | null;
    householdRole: string;
  }[];
  entities: { id: string; name: string }[];
}

const EMPTY_CANONICAL: CanonicalRows = {
  accounts: [],
  liabilities: [],
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
}

export default function WizardImportReview({
  clientId,
  importId,
  step,
  payload,
  perTabCommittedAt,
  onCommitted,
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
  const [entities, setEntities] = useState<Annotated<ExtractedEntity>[]>(payload.entities);

  // Wills get their own wizard-internal shape. Matches live in a parallel
  // array since WizardWill drops the Annotated wrapper.
  const [wills, setWills] = useState<WizardWill[]>(() =>
    payload.wills.map((w) => ({
      grantor: w.grantor,
      executor: w.executor,
      executionDate: w.executionDate,
      bequests: w.bequests.map(seedWizardBequest),
    })),
  );
  const [willMatches, setWillMatches] = useState<Array<MatchAnnotation | undefined>>(
    () => payload.wills.map((w) => w.match),
  );

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
        householdRole: string;
      }>(fRes);
      const entitiesRaw = await safeJson<{ id: string; name: string }>(eRes);
      setCanonical({
        accounts: accountsRaw.map((a) => ({ id: a.id, name: a.name })),
        liabilities: liabilitiesRaw.map((l) => ({ id: l.id, name: l.name })),
        familyMembers: familyRaw.map((f) => ({
          id: f.id,
          firstName: f.firstName,
          lastName: f.lastName,
          householdRole: f.householdRole,
        })),
        entities: entitiesRaw.map((e) => ({ id: e.id, name: e.name })),
      });
    } catch {
      // Leave dropdowns empty rather than crash — matches ReviewWizard.
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
        label: `${fm.firstName}${last} (${fm.householdRole})`,
      });
    }
    for (const e of canonical.entities) {
      opts.push({ kind: "entity", id: e.id, label: e.name });
    }
    return opts;
  }, [canonical]);

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
        match: willMatches[i],
      })) as ImportPayload["wills"],
      entities,
      warnings: payload.warnings,
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
    wills,
    willMatches,
    entities,
    payload.warnings,
  ]);

  const alreadyCommitted = STEP_COMMIT_TABS[step].every((ct) =>
    Boolean(perTabCommittedAt?.[ct]),
  );

  const handleCommit = useCallback(async () => {
    if (step === "estate" && !areAllBequestsResolved(wills)) {
      setCommitError(
        "Resolve every bequest's asset + recipient (or discard) before applying.",
      );
      return;
    }
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
      if (!commitRes.ok) {
        const j = await commitRes.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `Apply failed (${commitRes.status})`);
      }
      onCommitted();
    } catch (err) {
      setCommitError((err as Error).message);
    } finally {
      setCommitting(false);
    }
  }, [step, wills, buildLatestPayload, clientId, importId, onCommitted]);

  return (
    <div className="space-y-4">
      {commitError ? (
        <div className="rounded border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad">
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
        {step === "estate" && (
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
        {step === "entities" && (
          <ReviewStepEntities
            entities={entities}
            onChange={(e) => setEntities(e as Annotated<ExtractedEntity>[])}
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
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-50"
        >
          {committing
            ? "Applying…"
            : alreadyCommitted
              ? "Apply again"
              : "Apply to this step"}
        </button>
      </div>
    </div>
  );
}
