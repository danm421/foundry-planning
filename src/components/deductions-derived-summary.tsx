"use client";

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

// ── Component ───────────────────────────────────────────────────────────────

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

  const rawSalt =
    propertyTaxRows.reduce((s, r) => s + r.currentYearInflated, 0);
  const saltCapped = Math.min(rawSalt, saltCap);

  const belowLineFromExpenses = expenseRows
    .filter((r) => r.deductionType === "below_line" || r.deductionType === "charitable")
    .reduce((s, r) => s + r.annualAmount, 0);

  const totalItemized = mortgageTotal + saltCapped + belowLineFromExpenses;

  return (
    <section className="space-y-4">
      <div className="mb-1">
        <h2 className="text-base font-semibold text-gray-200">
          Auto-derived deductions
        </h2>
        <p className="mt-1 text-xs text-gray-400">
          These deductions are pulled automatically from your savings, expenses,
          mortgages, and real-estate data. Edit them on their respective tabs.
        </p>
      </div>

      {/* ── 1. Savings (above-line) ──────────────────────────────────────── */}
      <GroupCard title="From your savings (above-line)">
        {savingsRows.length === 0 ? (
          <EmptyState>
            No deductible savings rules yet. Add a Traditional IRA or 401(k)
            contribution on the Savings tab.
          </EmptyState>
        ) : (
          <ItemList>
            {savingsRows.map((r) => (
              <Item key={r.id}>
                <div className="flex flex-col">
                  <span className="text-gray-200">{r.accountName}</span>
                  <span className="text-xs text-gray-400">
                    {SUBTYPE_LABELS[r.subType] ?? r.subType} ·{" "}
                    {OWNER_LABELS[r.owner]} · {r.startYear}-{r.endYear}
                  </span>
                </div>
                <Amount>{fmt.format(r.annualAmount)}/yr</Amount>
              </Item>
            ))}
          </ItemList>
        )}
      </GroupCard>

      {/* ── 2. Expenses ──────────────────────────────────────────────────── */}
      <GroupCard title="From your expenses">
        {expenseRows.length === 0 ? (
          <EmptyState>
            No expenses flagged as deductible. Set a tax treatment on an expense
            to include it here.
          </EmptyState>
        ) : (
          <ItemList>
            {expenseRows.map((r) => (
              <Item key={r.id}>
                <div className="flex flex-col">
                  <span className="text-gray-200">{r.name}</span>
                  <span className="text-xs text-gray-400">
                    {DEDUCTION_TYPE_LABELS[r.deductionType] ?? r.deductionType}
                  </span>
                </div>
                <Amount>{fmt.format(r.annualAmount)}/yr</Amount>
              </Item>
            ))}
          </ItemList>
        )}
      </GroupCard>

      {/* ── 3. Mortgages (below-line) ────────────────────────────────────── */}
      <GroupCard title="From your mortgages (below-line)">
        {mortgageRows.length === 0 ? (
          <EmptyState>
            No deductible mortgages. Mark a liability as interest-deductible to
            include it here.
          </EmptyState>
        ) : (
          <ItemList>
            {mortgageRows.map((r) => (
              <Item key={r.id}>
                <span className="text-gray-200">{r.name}</span>
                <Amount>{fmt.format(r.estimatedInterest)}/yr</Amount>
              </Item>
            ))}
          </ItemList>
        )}
      </GroupCard>

      {/* ── 4. Real estate (SALT) ────────────────────────────────────────── */}
      <GroupCard title="From your real estate (SALT)">
        {propertyTaxRows.length === 0 ? (
          <EmptyState>
            No property taxes found. Set an annual property tax on a real-estate
            account to include it here.
          </EmptyState>
        ) : (
          <ItemList>
            {propertyTaxRows.map((r) => (
              <Item key={r.id}>
                <div className="flex flex-col">
                  <span className="text-gray-200">{r.name}</span>
                  <span className="text-xs text-gray-400">
                    Base {fmt.format(r.annualPropertyTax)} → {currentYear}{" "}
                    {fmt.format(r.currentYearInflated)}
                  </span>
                </div>
                <Amount>{fmt.format(r.currentYearInflated)}/yr</Amount>
              </Item>
            ))}
          </ItemList>
        )}
      </GroupCard>

      {/* ── Footer totals ────────────────────────────────────────────────── */}
      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4 space-y-2 text-sm">
        <div className="flex justify-between">
          <span className="text-gray-300">
            Total above-line for {currentYear}:
          </span>
          <span className="tabular-nums font-semibold text-gray-100">
            {fmt.format(totalAboveLine)}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-gray-300">
            Total itemized for {currentYear}:
          </span>
          <span className="tabular-nums font-semibold text-gray-100">
            {fmt.format(totalItemized)}
            {rawSalt > saltCap && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                (SALT: {fmt.format(rawSalt)} → capped at{" "}
                {fmt.format(saltCap)})
              </span>
            )}
          </span>
        </div>
      </div>
    </section>
  );
}

// ── Reusable sub-components ─────────────────────────────────────────────────

function GroupCard({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <h3 className="mb-2 text-sm font-medium text-gray-300">{title}</h3>
      {children}
    </div>
  );
}

function ItemList({ children }: { children: React.ReactNode }) {
  return (
    <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/60">
      {children}
    </ul>
  );
}

function Item({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-center justify-between px-4 py-2 text-sm">
      {children}
    </li>
  );
}

function Amount({ children }: { children: React.ReactNode }) {
  return <span className="tabular-nums text-gray-300">{children}</span>;
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-gray-800 bg-gray-900/60 px-4 py-6 text-center text-sm text-gray-300">
      {children}
    </div>
  );
}
