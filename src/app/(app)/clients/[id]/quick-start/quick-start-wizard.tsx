"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { QS_STEPS, type QsStepSlug } from "@/lib/quick-start/steps";
import { buildQsContext } from "@/lib/quick-start/derive";
import { WizardChrome } from "@/components/wizard-chrome";
import { IncomeStep } from "@/components/quick-start/income-step";
import { ExpensesStep } from "@/components/quick-start/expenses-step";
import { AccountsStep } from "@/components/quick-start/accounts-step";
import { SavingsStep } from "@/components/quick-start/savings-step";
import { InsuranceStep } from "@/components/quick-start/insurance-step";
import { AssumptionsStep } from "@/components/quick-start/assumptions-step";
import type { CreatedAccount } from "@/components/quick-start/step-props";
import { useLiftedList } from "@/lib/quick-start/use-lifted-list";
import type { IncomeRow } from "@/lib/quick-start/income-save";
import type { AccountRow } from "@/lib/quick-start/account-save";
import type { InsuranceRow } from "@/lib/quick-start/insurance-save";

import type { QsBootstrap } from "@/lib/quick-start/bootstrap";
export type { QsBootstrap };

/** The steps that live inside this route, in order (Basics is the /clients/new form). */
const ORDER: QsStepSlug[] = [
  "income",
  "expenses",
  "accounts",
  "savings",
  "insurance",
  "assumptions",
];

export function QuickStartWizard({ bootstrap }: { bootstrap: QsBootstrap }) {
  const router = useRouter();
  const params = useSearchParams();
  const stepParam = params.get("step") as QsStepSlug | null;
  const current: QsStepSlug =
    stepParam && ORDER.includes(stepParam) ? stepParam : "income";

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ctx = useMemo(() => buildQsContext(bootstrap.ctxInput), [bootstrap]);

  const incomeList = useLiftedList<IncomeRow>((makeId) => {
    const seed: IncomeRow[] = [
      {
        _id: makeId(),
        kind: "social_security",
        owner: "client",
        serverId: bootstrap.ssStubs.client?.id,
        monthlyBenefit: bootstrap.ssStubs.client?.monthlyBenefit ?? undefined,
        claimingAge: bootstrap.ssStubs.client?.claimingAge ?? undefined,
      },
    ];
    if (ctx.hasSpouse) {
      seed.push({
        _id: makeId(),
        kind: "social_security",
        owner: "spouse",
        serverId: bootstrap.ssStubs.spouse?.id,
        monthlyBenefit: bootstrap.ssStubs.spouse?.monthlyBenefit ?? undefined,
        claimingAge: bootstrap.ssStubs.spouse?.claimingAge ?? undefined,
      });
    }
    return seed;
  });

  const accountList = useLiftedList<AccountRow>();
  const insuranceList = useLiftedList<InsuranceRow>();

  const labels = QS_STEPS.map((s) => s.label);
  const idxInAll = QS_STEPS.findIndex((s) => s.slug === current);
  const orderIdx = ORDER.indexOf(current);
  const isLast = orderIdx === ORDER.length - 1;

  // The active step registers its save fn here during render; Next runs it.
  const saveRef = useRef<() => Promise<void>>(async () => {});
  const registerSave = (fn: () => Promise<void>) => {
    saveRef.current = fn;
  };

  // Accounts → Savings hand-off: created account ids persist while the wizard
  // stays mounted across step navigations.
  const [createdAccounts, setCreatedAccounts] = useState<CreatedAccount[]>([]);

  const goto = (slug: QsStepSlug) =>
    router.push(`/clients/${bootstrap.clientId}/quick-start?step=${slug}`);

  const handleNext = async () => {
    setBusy(true);
    setError(null);
    try {
      await saveRef.current();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save this step.");
      setBusy(false);
      return;
    }
    if (isLast) {
      router.push(`/clients/${bootstrap.clientId}/solver`);
    } else {
      goto(ORDER[orderIdx + 1]);
    }
    setBusy(false);
  };

  const handleBack = () => {
    if (orderIdx <= 0) router.back();
    else goto(ORDER[orderIdx - 1]);
  };

  const common = { ctx, bootstrap, busy, registerSave };

  return (
    <WizardChrome
      stepLabels={labels}
      current={idxInAll}
      title={QS_STEPS[idxInAll].label}
      busy={busy}
      backDisabled={false}
      nextLabel={isLast ? "Finish → Solver" : "Next"}
      onBack={handleBack}
      onNext={handleNext}
    >
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
      {current === "income" && <IncomeStep {...common} list={incomeList} />}
      {current === "expenses" && <ExpensesStep {...common} />}
      {current === "accounts" && (
        <AccountsStep {...common} list={accountList} setCreatedAccounts={setCreatedAccounts} />
      )}
      {current === "savings" && (
        <SavingsStep {...common} createdAccounts={createdAccounts} />
      )}
      {current === "insurance" && <InsuranceStep {...common} list={insuranceList} />}
      {current === "assumptions" && <AssumptionsStep {...common} />}
    </WizardChrome>
  );
}
