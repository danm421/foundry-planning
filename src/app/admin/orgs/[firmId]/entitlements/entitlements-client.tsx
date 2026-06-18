"use client";

import { useState } from "react";
import { toggleEntitlementAction } from "./actions";

export type EntitlementRow = {
  key: string;
  label: string;
  description: string;
  enabled: boolean;
  overrideMode: "grant" | "revoke" | null;
  reason: string | null;
  setBy: string | null;
  createdAt: string | null;
};

function RowCard({ firmId, row }: { firmId: string; row: EntitlementRow }) {
  const [reason, setReason] = useState("");
  const mode = row.enabled ? "revoke" : "grant";
  return (
    <form action={toggleEntitlementAction} className="space-y-3 rounded border border-hair p-4">
      <input type="hidden" name="firmId" value={firmId} />
      <input type="hidden" name="entitlement" value={row.key} />
      <input type="hidden" name="mode" value={mode} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium text-ink">{row.label}</div>
          <div className="text-sm text-ink-2">{row.description}</div>
          <div className="mt-1 tabular text-xs text-ink-3">{row.key}</div>
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            row.enabled ? "bg-good/15 text-good" : "bg-ink-4/15 text-ink-2"
          }`}
        >
          {row.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      {row.overrideMode && (
        <p className="text-xs text-warn">
          Manual {row.overrideMode} · &ldquo;{row.reason}&rdquo; · {row.setBy}
          {row.createdAt ? ` · ${new Date(row.createdAt).toLocaleDateString()}` : ""}
        </p>
      )}
      <div className="flex gap-2">
        <input
          required
          name="reason"
          aria-label={`Reason to ${mode} ${row.label}`}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={`Reason to ${mode} (required)`}
          className="flex-1 rounded border border-hair-2 bg-card-2 px-3 py-1.5 text-sm text-ink placeholder:text-ink-4 focus:border-accent focus:outline-none"
        />
        <button
          type="submit"
          disabled={!reason.trim()}
          className={`rounded px-3 py-1.5 text-sm disabled:opacity-40 ${
            row.enabled
              ? "bg-crit/15 text-crit hover:bg-crit/25"
              : "bg-good/15 text-good hover:bg-good/25"
          }`}
        >
          {row.enabled ? "Revoke" : "Grant"}
        </button>
      </div>
    </form>
  );
}

export default function EntitlementsClient({
  firmId,
  rows,
}: {
  firmId: string;
  rows: EntitlementRow[];
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-ink-2">Entitlements</h2>
      <p className="text-sm text-ink-3">
        Toggling writes a durable, attributable override that survives billing reconciliation. Each
        change requires a reason and is recorded in the audit log.
      </p>
      <div className="grid gap-3">
        {rows.map((r) => (
          <RowCard key={r.key} firmId={firmId} row={r} />
        ))}
      </div>
    </section>
  );
}
