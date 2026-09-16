"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import type { crmHouseholdStatusSchema } from "@/lib/crm/schemas";
import { useToast } from "@/components/toast";
import { selectChevronClassName } from "@/components/forms/input-styles";

type HouseholdStatus = z.infer<typeof crmHouseholdStatusSchema>;

/**
 * Display labels for every household status, keyed exhaustively against the
 * server enum so a schema change breaks the build instead of the dropdown.
 * Also consumed by the clients table for read-only (trashed) rows.
 */
export const HOUSEHOLD_STATUS_LABELS: Record<HouseholdStatus, string> = {
  prospect: "Prospect",
  active: "Active",
  inactive: "Inactive",
  archived: "Archived",
};

const STATUS_OPTIONS = Object.entries(HOUSEHOLD_STATUS_LABELS).map(
  ([value, label]) => ({ value, label }),
);

/**
 * Composed, not `selectBaseClassName` plus an override.
 *
 * The shared form recipe draws its box with `border-hair-2`, which measures
 * 1.75:1 against the card this table sits on — present in the DOM, invisible
 * on the screen, so the status read as loose text in a column rather than as
 * the box it is. `control` is the same fill token the row's CRM button uses
 * and holds 3.22:1 dark · 3.13:1 industrial against the card, which is what
 * makes the box actually draw.
 *
 * It is composed rather than appended because two `border-*` utilities in one
 * class string are resolved by their order in the GENERATED stylesheet, not in
 * the attribute — an appended `border-control` would win or lose by accident.
 *
 * `bg-paper` stays: the box reads as an inset well one step BEHIND the card,
 * which is what separates "a field you can change" from "a button you press".
 */
const STATUS_SELECT =
  "h-8 w-32 rounded-[var(--radius-sm)] border border-control bg-paper px-3 text-sm text-ink-2 outline-none " +
  "transition-colors hover:border-accent focus:border-accent focus:ring-2 focus:ring-accent/25 " +
  `disabled:opacity-50 ${selectChevronClassName}`;

interface HouseholdStatusSelectProps {
  householdId: string;
  /** For the accessible label — "Status for {name}". */
  householdName: string;
  status: string;
}

/**
 * Inline status editor for a clients-list row. Updates optimistically, then
 * PATCHes the household and refreshes the route so server-filtered views stay
 * in sync; on failure the previous value is restored and the error surfaces
 * as a toast.
 */
export function HouseholdStatusSelect({
  householdId,
  householdName,
  status,
}: HouseholdStatusSelectProps) {
  const router = useRouter();
  const { showToast } = useToast();
  const [value, setValue] = useState(status);
  const [busy, setBusy] = useState(false);

  async function changeStatus(next: string) {
    const prev = value;
    setValue(next);
    setBusy(true);
    try {
      const res = await fetch(`/api/crm/households/${householdId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
        throw new Error(
          typeof body?.error === "string" ? body.error : "Status update failed.",
        );
      }
      router.refresh();
    } catch (err) {
      setValue(prev);
      showToast({ message: err instanceof Error ? err.message : "Status update failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <select
      value={value}
      disabled={busy}
      onChange={(e) => void changeStatus(e.target.value)}
      aria-label={`Status for ${householdName}`}
      className={STATUS_SELECT}
    >
      {STATUS_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
