"use client";

import type { ReactNode } from "react";

/** What a base-only control says inside a scenario. */
const BASE_PLAN_ONLY_NOTE = "Available on the base plan.";

/**
 * Some editors write tables with no scenario column (Medicare coverage,
 * per-year schedules, loan extra payments, trust beneficiaries, asset mix,
 * annuity contracts): inside a scenario a save there would either change the
 * base plan for every scenario or be dropped silently. Wrap such a control in
 * this. With `readOnly` set it shows the note above its children and disables
 * them; without it, it renders the children untouched, so base mode is
 * unchanged.
 *
 * Callers also leave their write buttons out while read-only: a disabled
 * fieldset stops a real click, but not a synthetic one.
 */
export function BasePlanOnly({
  readOnly,
  noteClassName,
  children,
}: {
  readOnly: boolean;
  /** Extra classes for the note, e.g. the spacing the wrapped block had. */
  noteClassName?: string;
  children: ReactNode;
}) {
  if (!readOnly) return <>{children}</>;
  return (
    <>
      <BasePlanOnlyNote className={noteClassName} />
      <fieldset disabled className="contents">
        {children}
      </fieldset>
    </>
  );
}

/** The note alone, for a read-only view with no form controls to disable. */
export function BasePlanOnlyNote({ className }: { className?: string }) {
  return (
    <p className={`rounded-md border border-hair bg-card-2 px-3 py-2 text-sm text-ink-3 ${className ?? ""}`}>
      {BASE_PLAN_ONLY_NOTE}
    </p>
  );
}
