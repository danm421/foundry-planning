"use client";

import { HelpTip } from "@/components/help-tip";

// ── Row types ───────────────────────────────────────────────────────────────

export interface DerivedRow {
  id: string;
  accountName: string;
  subType: string;
  annualAmount: number;
  owner: "client" | "spouse" | "joint";
  startYear: number;
  endYear: number;
}

export interface ExpenseDeductionRow {
  id: string;
  name: string;
  deductionType: string;
  annualAmount: number;
}

export interface MortgageInterestRow {
  id: string;
  name: string;
  estimatedInterest: number;
}

export interface PropertyTaxRow {
  id: string;
  name: string;
  annualPropertyTax: number;
  currentYearInflated: number;
}

interface DeductionsDerivedSummaryProps {
  savingsRows: DerivedRow[];
  expenseRows: ExpenseDeductionRow[];
  mortgageRows: MortgageInterestRow[];
  propertyTaxRows: PropertyTaxRow[];
  currentYear: number;
  saltCap: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

const SUBTYPE_LABELS: Record<string, string> = {
  traditional_ira: "Traditional IRA",
  "401k": "401(k) Traditional",
};

const OWNER_LABELS: Record<string, string> = {
  client: "Client",
  spouse: "Spouse",
  joint: "Joint",
};

const DEDUCTION_TYPE_LABELS: Record<string, string> = {
  charitable: "Charitable",
  above_line: "Above-line",
  below_line: "Below-line",
  property_tax: "Property tax",
};

const GROUP_HELP: Record<string, string> = {
  "Savings (above-line)":
    "Pulled from Traditional IRA / 401(k) contribution rules on the Savings tab. Edit there.",
  Expenses:
    "Pulled from expenses flagged with a tax treatment. Edit on the Expenses tab.",
  "Mortgages (below-line)":
    "Pulled from liabilities marked as interest-deductible. Edit on the Liabilities tab.",
  "Real estate (SALT)":
    "Pulled from real-estate accounts with an annual property tax. Edit on the Accounts tab. Subject to the SALT cap.",
};

const EMPTY_HINT: Record<string, string> = {
  "Savings (above-line)":
    "No deductible savings rules — add a Traditional IRA or 401(k) contribution on the Savings tab.",
  Expenses:
    "No expenses flagged as deductible — set a tax treatment on an expense to include it.",
  "Mortgages (below-line)":
    "No deductible mortgages — mark a liability as interest-deductible.",
  "Real estate (SALT)":
    "No property taxes found — set an annual property tax on a real-estate account.",
};

// ── Component ───────────────────────────────────────────────────────────────

interface FlatRow {
  group: string;
  id: string;
  name: string;
  meta: string;
  amount: number;
}

export function DeductionsDerivedSummary({
  savingsRows,
  expenseRows,
  mortgageRows,
  propertyTaxRows,
  currentYear,
  saltCap,
}: DeductionsDerivedSummaryProps) {
  // ── Totals ──────────────────────────────────────────────────────────────
  const aboveLineFromSavings = savingsRows.reduce((s, r) => s + r.annualAmount, 0);
  const aboveLineFromExpenses = expenseRows
    .filter((r) => r.deductionType === "above_line")
    .reduce((s, r) => s + r.annualAmount, 0);
  const totalAboveLine = aboveLineFromSavings + aboveLineFromExpenses;

  const mortgageTotal = mortgageRows.reduce((s, r) => s + r.estimatedInterest, 0);

  const rawSalt = propertyTaxRows.reduce((s, r) => s + r.currentYearInflated, 0);
  const saltCapped = Math.min(rawSalt, saltCap);

  const belowLineFromExpenses = expenseRows
    .filter((r) => r.deductionType === "below_line" || r.deductionType === "charitable")
    .reduce((s, r) => s + r.annualAmount, 0);

  const totalItemized = mortgageTotal + saltCapped + belowLineFromExpenses;

  // ── Build a single flat row list grouped by category ─────────────────────
  const groups: { name: string; rows: FlatRow[] }[] = [
    {
      name: "Savings (above-line)",
      rows: savingsRows.map((r) => ({
        group: "Savings (above-line)",
        id: r.id,
        name: r.accountName,
        meta: `${SUBTYPE_LABELS[r.subType] ?? r.subType} · ${OWNER_LABELS[r.owner]} · ${r.startYear}–${r.endYear}`,
        amount: r.annualAmount,
      })),
    },
    {
      name: "Expenses",
      rows: expenseRows.map((r) => ({
        group: "Expenses",
        id: r.id,
        name: r.name,
        meta: DEDUCTION_TYPE_LABELS[r.deductionType] ?? r.deductionType,
        amount: r.annualAmount,
      })),
    },
    {
      name: "Mortgages (below-line)",
      rows: mortgageRows.map((r) => ({
        group: "Mortgages (below-line)",
        id: r.id,
        name: r.name,
        meta: "Estimated annual interest",
        amount: r.estimatedInterest,
      })),
    },
    {
      name: "Real estate (SALT)",
      rows: propertyTaxRows.map((r) => ({
        group: "Real estate (SALT)",
        id: r.id,
        name: r.name,
        meta: `Base ${fmt.format(r.annualPropertyTax)} → ${currentYear} ${fmt.format(r.currentYearInflated)}`,
        amount: r.currentYearInflated,
      })),
    },
  ];

  const ROW_GRID =
    "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1.4fr)_8rem] items-center gap-3 px-3 py-1.5";

  return (
    <section className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-300">
          Auto-derived deductions
        </h2>
        <HelpTip text="Pulled automatically from your savings, expenses, mortgages, and real-estate data. Edit on their respective tabs." />
      </div>

      <div className="overflow-hidden rounded-md border border-gray-800 bg-gray-900/40">
        <div className={`${ROW_GRID} border-b border-gray-800 bg-gray-900/60 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400`}>
          <span>Item</span>
          <span>Detail</span>
          <span className="text-right">Amount / yr</span>
        </div>

        <div className="divide-y divide-gray-800">
          {groups.map((group) => (
            <div key={group.name}>
              <div className="flex items-center gap-1.5 bg-gray-900/30 px-3 py-1 text-[11px] font-medium text-gray-300">
                <span>{group.name}</span>
                <HelpTip text={GROUP_HELP[group.name]} />
              </div>
              {group.rows.length === 0 ? (
                <div className="px-3 py-2 text-xs italic text-gray-500">
                  {EMPTY_HINT[group.name]}
                </div>
              ) : (
                group.rows.map((r) => (
                  <div key={`${r.group}:${r.id}`} className={`${ROW_GRID} text-sm`}>
                    <span className="truncate text-gray-200">{r.name}</span>
                    <span className="truncate text-xs text-gray-400">{r.meta}</span>
                    <span className="justify-self-end tabular-nums text-gray-300">
                      {fmt.format(r.amount)}
                    </span>
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Footer totals */}
      <div className="rounded-md border border-gray-800 bg-gray-900/40 px-4 py-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-300">
            Total above-line for {currentYear}
          </span>
          <span className="tabular-nums font-semibold text-gray-100">
            {fmt.format(totalAboveLine)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="flex items-center gap-1.5 text-gray-300">
            Total itemized for {currentYear}
            {rawSalt > saltCap && (
              <HelpTip text={`SALT ${fmt.format(rawSalt)} capped at ${fmt.format(saltCap)}.`} />
            )}
          </span>
          <span className="tabular-nums font-semibold text-gray-100">
            {fmt.format(totalItemized)}
          </span>
        </div>
      </div>
    </section>
  );
}
