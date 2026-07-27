"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PencilIcon } from "@/components/icons";
import { SwitchControl } from "@/components/forms/switch-control";

export type AdvisorGrantRow = {
  userId: string;
  displayName: string;
  /** Friendly Clerk org role, e.g. "Admin" / "Member". */
  role: string;
  brandingEnabled: boolean;
};

/**
 * Per-advisor "Allow custom branding" switches, one row per firm member
 * (the caller themselves excluded — see `branding-content.tsx`). The switch
 * PATCHes `/api/advisor-branding/[advisorUserId]/enabled`, which is
 * admin-gated and audited server-side; this component only renders the
 * optimistic UI around that call.
 */
export default function AdvisorGrantList({ rows }: { rows: AdvisorGrantRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-3">No other advisors in this firm yet.</p>;
  }

  return (
    <ul className="divide-y divide-hair rounded border border-hair">
      {rows.map((row) => (
        <GrantRow key={row.userId} row={row} />
      ))}
    </ul>
  );
}

function GrantRow({ row }: { row: AdvisorGrantRow }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(row.brandingEnabled);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function flip(next: boolean): Promise<void> {
    setError(null);
    const prev = enabled;
    setEnabled(next);
    setPending(true);
    try {
      const res = await fetch(
        `/api/advisor-branding/${encodeURIComponent(row.userId)}/enabled`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        },
      );
      if (!res.ok) {
        setEnabled(prev);
        setError("Couldn't save that change.");
        return;
      }
      // Re-reads the server-rendered list so a concurrent edit elsewhere
      // (or this row's own `brandingEnabled` source of truth) stays correct.
      router.refresh();
    } catch {
      setEnabled(prev);
      setError("Couldn't save that change.");
    } finally {
      setPending(false);
    }
  }

  return (
    <li className="flex items-center justify-between gap-4 px-3 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium text-ink">{row.displayName}</div>
        <div className="text-xs text-ink-3">{row.role}</div>
        {error ? <p className="mt-1 text-xs text-crit">{error}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <Link
          href={`/settings/branding?advisorUserId=${encodeURIComponent(row.userId)}`}
          className="inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink"
        >
          <PencilIcon width={14} height={14} aria-hidden="true" />
          Edit brand
        </Link>
        <SwitchControl
          checked={enabled}
          disabled={pending}
          ariaLabel={`Allow custom branding for ${row.displayName}`}
          stateLabel={enabled ? "Allowed" : "Off"}
          onChange={(next) => void flip(next)}
        />
      </div>
    </li>
  );
}
