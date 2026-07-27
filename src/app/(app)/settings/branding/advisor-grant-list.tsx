"use client";

import { useEffect, useState } from "react";
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
  /** The caller's own row — marked, not excluded. Their grant switch is the
   *  ONLY control in the product that can flip their own `brandingEnabled`
   *  (see `branding-content.tsx`), so it has to render like everyone
   *  else's, just labeled. */
  isSelf: boolean;
};

/**
 * Per-advisor "Allow custom branding" switches, one row per firm member,
 * caller included. The switch PATCHes
 * `/api/advisor-branding/[advisorUserId]/enabled`, which is admin-gated and
 * audited server-side; this component only renders the optimistic UI
 * around that call.
 */
export default function AdvisorGrantList({ rows }: { rows: AdvisorGrantRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-ink-3">No advisors in this firm yet.</p>;
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

  // `GrantRow` is keyed by a stable `row.userId` (see `AdvisorGrantList`),
  // so `useState(row.brandingEnabled)` above only seeds the FIRST render —
  // React reconciles the same instance on every later render and does not
  // re-run that initializer. Without this effect, `router.refresh()` below
  // would re-fetch fresh server props that never reach this row's own
  // state: a concurrent edit to this exact advisor from another tab/admin
  // would never show up here. This effect is what actually makes that true.
  useEffect(() => {
    setEnabled(row.brandingEnabled);
  }, [row.brandingEnabled]);

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
      // Re-reads the server-rendered list — picks up membership changes
      // (advisors added/removed) and, via the effect above, this row's own
      // confirmed value and any OTHER row's concurrent edit too.
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
        <div className="text-sm font-medium text-ink">
          {row.displayName}
          {row.isSelf ? <span className="ml-1.5 text-xs text-ink-3">(you)</span> : null}
        </div>
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
