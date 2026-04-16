"use client";

interface DerivedRow {
  id: string;
  accountName: string;
  subType: string;
  annualAmount: number;
  owner: "client" | "spouse" | "joint";
  startYear: number;
  endYear: number;
}

const fmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const SUBTYPE_LABELS: Record<string, string> = {
  traditional_ira: "Traditional IRA",
  "401k": "401(k) Traditional",
};

const OWNER_LABELS: Record<string, string> = {
  client: "Client",
  spouse: "Spouse",
  joint: "Joint",
};

export function DeductionsDerivedSummary({
  rows,
  currentYear,
}: {
  rows: DerivedRow[];
  currentYear: number;
}) {
  const total = rows.reduce((sum, r) => sum + r.annualAmount, 0);

  return (
    <section className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-gray-200">Auto-derived from your savings</h2>
        <p className="mt-1 text-xs text-gray-500">
          These contributions to traditional retirement accounts flow into your above-line
          deductions automatically. Edit on the{" "}
          <span className="text-gray-300">Income, Expenses &amp; Savings</span> tab.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-md border border-gray-800 bg-gray-900/60 px-4 py-6 text-center text-sm text-gray-400">
          No deductible savings rules yet. Add a Traditional IRA or 401(k) contribution
          on the Savings tab to deduct it from your taxes.
        </div>
      ) : (
        <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/60">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center justify-between px-4 py-2 text-sm">
              <div className="flex flex-col">
                <span className="text-gray-200">{r.accountName}</span>
                <span className="text-xs text-gray-500">
                  {SUBTYPE_LABELS[r.subType] ?? r.subType} · {OWNER_LABELS[r.owner]} · {r.startYear}-{r.endYear}
                </span>
              </div>
              <span className="tabular-nums text-gray-300">{fmt.format(r.annualAmount)}/yr</span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex justify-between text-sm">
        <span className="text-gray-400">Total above-line for {currentYear}:</span>
        <span className="tabular-nums font-semibold text-gray-100">{fmt.format(total)}</span>
      </div>
    </section>
  );
}
