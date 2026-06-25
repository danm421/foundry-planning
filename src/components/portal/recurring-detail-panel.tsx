"use client";
import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import { describeRules } from "@/lib/portal/recurring-matching";
import type { RecurringRowDTO } from "@/lib/portal/recurring-matching";
import { CategoryBadge } from "@/components/portal/category-badge";
import { RecurringTimeline } from "@/components/portal/recurring-timeline";

function fmtDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short", day: "numeric", timeZone: "UTC",
  });
}

export function RecurringDetailPanel({
  r,
  editEnabled,
  onClose,
  onEdit,
  onDelete,
}: {
  r: RecurringRowDTO;
  editEnabled: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
}): ReactElement {
  const rules = describeRules(r);
  const amount = r.state === "paid" ? r.postedThisMonth : r.predicted;
  return (
    <div className="space-y-4 rounded-xl border border-hair bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <CategoryBadge name={r.categoryName} color={r.categoryColor} icon={r.categoryIcon} />
        <button type="button" onClick={onClose} className="text-[12px] text-ink-3 hover:text-ink">
          Close
        </button>
      </div>

      <div className="flex items-start justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[16px] font-semibold text-ink">
          {r.categoryIcon && <span aria-hidden>{r.categoryIcon}</span>}
          {r.name}
        </h2>
        <div className="text-right">
          <p className="tabular text-[16px] font-semibold text-ink">{fmtUsd(amount)}</p>
          {r.nextPaymentDate && (
            <p className="text-[11px] text-ink-3">around {fmtDay(r.nextPaymentDate)}</p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] uppercase tracking-wide text-ink-3">Rules</p>
        <div className="flex flex-wrap gap-1.5">
          {rules.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={editEnabled ? onEdit : undefined}
              disabled={!editEnabled}
              className="rounded-md border border-hair bg-card-2 px-2 py-0.5 text-[11px] text-ink-2 enabled:hover:bg-card"
            >
              {chip}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-[11px] uppercase tracking-wide text-ink-3">History</p>
        <RecurringTimeline timeline={r.timeline} upcoming={r.nextPaymentDate} />
      </div>

      {r.metricsByYear.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[11px] uppercase tracking-wide text-ink-3">Key metrics</p>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="text-ink-3">
                <th className="text-left font-normal" />
                <th className="text-right font-normal">Spent / yr</th>
                <th className="text-right font-normal">Avg / txn</th>
              </tr>
            </thead>
            <tbody>
              {r.metricsByYear.map((m) => (
                <tr key={m.year}>
                  <td className="py-0.5 text-ink-2">{m.year}</td>
                  <td className="tabular py-0.5 text-right text-ink">{fmtUsd(m.total)}</td>
                  <td className="tabular py-0.5 text-right text-ink">{fmtUsd(m.avg)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editEnabled && (
        <div className="flex gap-2 border-t border-hair pt-3">
          <button
            type="button"
            onClick={onEdit}
            className="flex-1 rounded-md border border-hair px-3 py-1.5 text-[13px] text-ink-2 hover:bg-card-2"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="flex-1 rounded-md border border-hair px-3 py-1.5 text-[13px] text-crit hover:bg-card-2"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
