"use client";

import { useEffect, useState } from "react";
import type { AccountCascadeDependents } from "@/lib/accounts/cascade-dependents";

/**
 * The transfers and Roth conversions a database delete of this account takes
 * with it (audit F15: those foreign keys are ON DELETE CASCADE), read from the
 * read-only `/dependents` route. `accountId` null reads nothing.
 */
export function useAccountCascadeDependents(clientId: string, accountId: string | null) {
  const key = accountId ? `${clientId}/${accountId}` : null;
  // The answer is kept with the account it is for, so loading is "no answer for
  // this account yet" and a stale answer is never shown.
  const [answer, setAnswer] = useState<{ key: string; deps: AccountCascadeDependents | null } | null>(null);

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    fetch(`/api/clients/${clientId}/accounts/${accountId}/dependents`)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null)
      .then((deps: AccountCascadeDependents | null) => {
        if (!cancelled) setAnswer({ key, deps });
      });
    return () => {
      cancelled = true;
    };
  }, [clientId, accountId, key]);

  const current = key != null && answer?.key === key ? answer : null;
  return { deps: current?.deps ?? null, loading: key != null && current == null };
}

/** Lists those dependents by name. `action` leads the line ("Deleting this account"). */
export function AccountCascadeList({
  deps,
  loading,
  action,
}: {
  deps: AccountCascadeDependents | null;
  loading: boolean;
  action: string;
}) {
  if (loading) {
    return <p className="mt-3 text-[13px] text-ink-3">Checking for linked transfers and Roth conversions…</p>;
  }
  const cascades = [
    ...(deps?.transfers ?? []).map((t) => ({ kind: "Transfer", name: t.name })),
    ...(deps?.rothConversions ?? []).map((r) => ({ kind: "Roth conversion", name: r.name })),
  ];
  if (cascades.length === 0) return null;
  return (
    <div className="mt-3 rounded-md border border-warn/40 bg-warn/10 p-3">
      <p className="text-[13px] font-medium text-warn">
        {action} will also permanently delete {cascades.length} linked{" "}
        {cascades.length === 1 ? "item" : "items"}:
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
        {cascades.map((c, i) => (
          <li key={i}>
            <span className="text-ink-3">{c.kind}:</span> {c.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
