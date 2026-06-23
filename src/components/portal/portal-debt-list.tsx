import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { PortalDebtRow } from "@/lib/portal/portal-networth";

const TYPE_LABEL: Record<string, string> = {
  mortgage: "Mortgage", heloc: "HELOC", auto: "Auto loan", student: "Student loan",
  personal: "Personal loan", credit_card: "Credit card", other: "Loan",
};

export function PortalDebtList({ rows }: { rows: PortalDebtRow[] }): ReactElement | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.balance, 0);
  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink-2">Debt</h3>
        <span className="text-sm font-semibold text-ink">{fmtUsd(total)}</span>
      </header>
      <ul className="divide-y divide-hair rounded-xl border border-hair bg-card">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-4 p-4">
            <div className="min-w-0">
              <div className="truncate font-medium text-ink">{r.name}</div>
              <div className="text-[12px] text-ink-3">
                {r.liabilityType ? TYPE_LABEL[r.liabilityType] ?? "Loan" : "Loan"}
                {r.isPlaidLinked && r.aprPercentage != null && (
                  <span> · {r.aprPercentage.toFixed(2)}% APR</span>
                )}
                {r.isPlaidLinked && r.minimumPayment != null && (
                  <span> · Min {fmtUsd(r.minimumPayment)}</span>
                )}
                {r.isPlaidLinked && r.nextPaymentDueDate != null && (
                  <span> · Due {r.nextPaymentDueDate}</span>
                )}
              </div>
            </div>
            <div className="shrink-0 font-semibold text-ink">{fmtUsd(r.balance)}</div>
          </li>
        ))}
      </ul>
    </section>
  );
}
