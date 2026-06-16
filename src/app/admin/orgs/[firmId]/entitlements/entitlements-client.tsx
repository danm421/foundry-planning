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
    <form action={toggleEntitlementAction} className="space-y-3 rounded border border-neutral-800 p-4">
      <input type="hidden" name="firmId" value={firmId} />
      <input type="hidden" name="entitlement" value={row.key} />
      <input type="hidden" name="mode" value={mode} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="font-medium">{row.label}</div>
          <div className="text-sm text-neutral-400">{row.description}</div>
          <div className="mt-1 font-mono text-xs text-neutral-600">{row.key}</div>
        </div>
        <span
          className={`rounded px-2 py-0.5 text-xs ${
            row.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-neutral-500/15 text-neutral-300"
          }`}
        >
          {row.enabled ? "Enabled" : "Disabled"}
        </span>
      </div>
      {row.overrideMode && (
        <p className="text-xs text-amber-300/80">
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
          className="flex-1 rounded border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm placeholder:text-neutral-500"
        />
        <button
          type="submit"
          disabled={!reason.trim()}
          className={`rounded px-3 py-1.5 text-sm disabled:opacity-40 ${
            row.enabled
              ? "bg-red-500/15 text-red-300 hover:bg-red-500/25"
              : "bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25"
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
      <h2 className="text-sm font-medium text-neutral-300">Entitlements</h2>
      <p className="text-sm text-neutral-500">
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
