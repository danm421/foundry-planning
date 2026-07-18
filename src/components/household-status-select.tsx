"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { z } from "zod";
import type { crmHouseholdStatusSchema } from "@/lib/crm/schemas";
import { useToast } from "@/components/toast";
import { selectBaseClassName } from "@/components/forms/input-styles";

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
      className={`${selectBaseClassName} h-8 w-32 text-[13px] text-ink-2`}
    >
      {STATUS_OPTIONS.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
