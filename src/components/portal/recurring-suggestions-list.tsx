"use client";
import type { ReactElement } from "react";
import { CategoryBadge } from "@/components/portal/category-badge";
import { fmtRecurringDue, fmtUsd } from "@/lib/portal/format";
import type { RecurringSuggestionDTO } from "@/lib/portal/contracts";

function CloseIcon(): ReactElement {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" strokeLinecap="round" />
    </svg>
  );
}

export function RecurringSuggestionsList({
  suggestions,
  month,
  onAdd,
  onDismiss,
}: {
  suggestions: RecurringSuggestionDTO[];
  month: string;
  onAdd: (s: RecurringSuggestionDTO) => void;
  onDismiss: (key: string) => void;
}): ReactElement | null {
  if (suggestions.length === 0) return null;
  return (
    <section className="space-y-1">
      <h2 className="text-[13px] font-medium text-ink-2">Suggested</h2>
      <p className="text-[12px] text-ink-3">
        Charges that repeat in your history and aren&rsquo;t tracked yet.
      </p>
      <ul className="divide-y divide-hair rounded-xl border border-hair bg-card">
        {suggestions.map((s) => (
          <li key={s.key} className="flex items-center gap-2 px-4 py-2.5 sm:gap-3">
            {/* The expected date is the first thing to go on a phone: the row
                already says how often, and the name needs the width more. */}
            <span className="hidden w-16 shrink-0 text-[12px] text-ink-3 sm:block">
              {fmtRecurringDue(s, month)}
            </span>
            <span className="w-5 shrink-0 text-center" aria-hidden>
              {s.categoryIcon ?? "🔁"}
            </span>
            {/* The merchant name is what the client recognises, so on a phone it
                takes the whole line and the evidence wraps underneath rather
                than truncating both into "Cos…". One line from sm up. */}
            <span className="min-w-0 flex-1 text-[13px]">
              <span className="block truncate text-ink sm:inline">{s.name}</span>{" "}
              <span className="block truncate text-[12px] text-ink-3 sm:inline sm:text-[13px]">
                {s.cadence === "monthly" ? "Monthly" : "Annually"} &middot;{" "}
                <span className="tabular">{s.occurrences}</span> charges
              </span>
            </span>
            {/* Two actions ride on this row, so the category name is the one thing
                that will not fit on a phone. Its icon is already in the column
                to the left, so hiding the label costs nothing there. */}
            <span className="hidden sm:contents">
              <CategoryBadge name={s.categoryName} color={s.categoryColor} icon={null} />
            </span>
            <span className="tabular w-16 shrink-0 text-right text-[13px] text-ink sm:w-20">
              {fmtUsd(s.predicted)}
            </span>
            <button
              type="button"
              onClick={() => onAdd(s)}
              className="shrink-0 rounded-md border border-hair px-2 py-1 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => onDismiss(s.key)}
              aria-label={`Dismiss ${s.name}`}
              className="shrink-0 rounded-md p-1 text-ink-3 transition-colors hover:bg-card-2 hover:text-ink-2"
            >
              <CloseIcon />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
