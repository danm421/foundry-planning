"use client";

import { useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import type {
  ExtractionResult,
  ExtractedAccount,
  ExtractedIncome,
  ExtractedExpense,
  ExtractedLiability,
  ExtractedEntity,
} from "@/lib/extraction/types";
import ReviewStepAccounts from "./review-step-accounts";
import ReviewStepIncomes from "./review-step-incomes";
import ReviewStepExpenses from "./review-step-expenses";
import ReviewStepLiabilities from "./review-step-liabilities";
import ReviewStepEntities from "./review-step-entities";
import ReviewStepSummary from "./review-step-summary";

interface ReviewWizardProps {
  clientId: string;
  results: ExtractionResult[];
  existingAccountNames: string[];
  defaultStartYear: number;
  defaultEndYear: number;
  onReset: () => void;
}

type StepId = "accounts" | "incomes" | "expenses" | "liabilities" | "entities" | "summary";

interface WizardStep {
  id: StepId;
  label: string;
  count: number;
}

export default function ReviewWizard({
  clientId,
  results,
  existingAccountNames,
  defaultStartYear,
  defaultEndYear,
  onReset,
}: ReviewWizardProps) {
  const router = useRouter();

  // Merge all extraction results into unified lists
  const merged = useMemo(() => {
    const accounts: ExtractedAccount[] = [];
    const incomes: ExtractedIncome[] = [];
    const expenses: ExtractedExpense[] = [];
    const liabilities: ExtractedLiability[] = [];
    const entities: ExtractedEntity[] = [];

    for (const r of results) {
      accounts.push(...r.extracted.accounts);
      incomes.push(...r.extracted.incomes);
      expenses.push(...r.extracted.expenses);
      liabilities.push(...r.extracted.liabilities);
      entities.push(...r.extracted.entities);
    }

    return { accounts, incomes, expenses, liabilities, entities };
  }, [results]);

  const [accounts, setAccounts] = useState<ExtractedAccount[]>(merged.accounts);
  const [incomes, setIncomes] = useState<ExtractedIncome[]>(merged.incomes);
  const [expenses, setExpenses] = useState<ExtractedExpense[]>(merged.expenses);
  const [liabilities, setLiabilities] = useState<ExtractedLiability[]>(merged.liabilities);
  const [entities, setEntities] = useState<ExtractedEntity[]>(merged.entities);
  const [isCommitting, setIsCommitting] = useState(false);

  // Build dynamic step list — skip empty categories
  const steps: WizardStep[] = useMemo(() => {
    const s: WizardStep[] = [];
    if (accounts.length > 0) s.push({ id: "accounts", label: "Accounts", count: accounts.length });
    if (incomes.length > 0) s.push({ id: "incomes", label: "Income", count: incomes.length });
    if (expenses.length > 0) s.push({ id: "expenses", label: "Expenses", count: expenses.length });
    if (liabilities.length > 0) s.push({ id: "liabilities", label: "Liabilities", count: liabilities.length });
    if (entities.length > 0) s.push({ id: "entities", label: "Entities", count: entities.length });
    s.push({ id: "summary", label: "Summary", count: 0 });
    return s;
  }, [accounts.length, incomes.length, expenses.length, liabilities.length, entities.length]);

  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const currentStep = steps[currentStepIndex];

  const goNext = () => setCurrentStepIndex((i) => Math.min(i + 1, steps.length - 1));
  const goBack = () => setCurrentStepIndex((i) => Math.max(i - 1, 0));

  const handleCommit = useCallback(async () => {
    setIsCommitting(true);
    try {
      // Commit entities first (they may be referenced by accounts)
      for (const entity of entities) {
        if (!entity.name) continue;
        await fetch(`/api/clients/${clientId}/entities`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: entity.name,
            entityType: entity.entityType ?? "other",
          }),
        });
      }

      // Commit accounts
      for (const account of accounts) {
        if (!account.name || !account.category) continue;
        await fetch(`/api/clients/${clientId}/accounts`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: account.name,
            category: account.category,
            subType: account.subType ?? "other",
            owner: account.owner ?? "client",
            value: String(account.value ?? 0),
            basis: String(account.basis ?? 0),
            growthRate: account.growthRate != null ? String(account.growthRate) : null,
            rmdEnabled: account.rmdEnabled ?? false,
            source: "extracted",
          }),
        });
      }

      // Commit incomes
      for (const income of incomes) {
        if (!income.name) continue;
        await fetch(`/api/clients/${clientId}/incomes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: income.type ?? "other",
            name: income.name,
            annualAmount: String(income.annualAmount ?? 0),
            startYear: income.startYear ?? defaultStartYear,
            endYear: income.endYear ?? defaultEndYear,
            growthRate: String(income.growthRate ?? 0.03),
            owner: income.owner ?? "client",
            claimingAge: income.claimingAge ?? null,
            source: "extracted",
          }),
        });
      }

      // Commit expenses
      for (const expense of expenses) {
        if (!expense.name) continue;
        await fetch(`/api/clients/${clientId}/expenses`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: expense.type ?? "living",
            name: expense.name,
            annualAmount: String(expense.annualAmount ?? 0),
            startYear: expense.startYear ?? defaultStartYear,
            endYear: expense.endYear ?? defaultEndYear,
            growthRate: String(expense.growthRate ?? 0.03),
            source: "extracted",
          }),
        });
      }

      // Commit liabilities
      for (const liability of liabilities) {
        if (!liability.name) continue;
        await fetch(`/api/clients/${clientId}/liabilities`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: liability.name,
            balance: String(liability.balance ?? 0),
            interestRate: String(liability.interestRate ?? 0),
            monthlyPayment: String(liability.monthlyPayment ?? 0),
            startYear: liability.startYear ?? defaultStartYear,
            termMonths:
              liability.endYear && liability.startYear
                ? (liability.endYear - liability.startYear) * 12
                : 360,
            termUnit: "annual",
          }),
        });
      }

      router.push(`/clients/${clientId}/client-data/balance-sheet`);
      router.refresh();
    } catch (err) {
      console.error("Commit error:", err);
      setIsCommitting(false);
    }
  }, [clientId, accounts, incomes, expenses, liabilities, entities, defaultStartYear, defaultEndYear, router]);

  return (
    <div className="space-y-6">
      {/* Step progress bar */}
      <div className="flex items-center gap-1">
        {steps.map((step, i) => (
          <button
            key={step.id}
            onClick={() => setCurrentStepIndex(i)}
            className={`flex-1 rounded-md px-2 py-1.5 text-center text-xs font-medium transition-colors ${
              i === currentStepIndex
                ? "bg-blue-600 text-white"
                : i < currentStepIndex
                  ? "bg-gray-700 text-gray-300"
                  : "bg-gray-800 text-gray-400"
            }`}
          >
            {step.label}
            {step.count > 0 && ` (${step.count})`}
          </button>
        ))}
      </div>

      {/* Current step content */}
      {currentStep?.id === "accounts" && (
        <ReviewStepAccounts
          accounts={accounts}
          onChange={setAccounts}
          existingAccountNames={existingAccountNames}
        />
      )}
      {currentStep?.id === "incomes" && (
        <ReviewStepIncomes
          incomes={incomes}
          onChange={setIncomes}
          defaultStartYear={defaultStartYear}
          defaultEndYear={defaultEndYear}
        />
      )}
      {currentStep?.id === "expenses" && (
        <ReviewStepExpenses
          expenses={expenses}
          onChange={setExpenses}
          defaultStartYear={defaultStartYear}
          defaultEndYear={defaultEndYear}
        />
      )}
      {currentStep?.id === "liabilities" && (
        <ReviewStepLiabilities
          liabilities={liabilities}
          onChange={setLiabilities}
          defaultStartYear={defaultStartYear}
          defaultEndYear={defaultEndYear}
        />
      )}
      {currentStep?.id === "entities" && (
        <ReviewStepEntities entities={entities} onChange={setEntities} />
      )}
      {currentStep?.id === "summary" && (
        <ReviewStepSummary
          accounts={accounts}
          incomes={incomes}
          expenses={expenses}
          liabilities={liabilities}
          entities={entities}
          onCommit={handleCommit}
          isCommitting={isCommitting}
        />
      )}

      {/* Navigation */}
      <div className="flex justify-between">
        <button
          onClick={currentStepIndex === 0 ? onReset : goBack}
          className="rounded-md border border-gray-600 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800"
        >
          {currentStepIndex === 0 ? "Back to Upload" : "Back"}
        </button>
        {currentStep?.id !== "summary" && (
          <button
            onClick={goNext}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Next
          </button>
        )}
      </div>
    </div>
  );
}
