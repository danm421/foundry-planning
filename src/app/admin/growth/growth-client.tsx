"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { GrowthMetrics } from "@/lib/ops/growth/types";
import type { FunnelStageGroup } from "@/lib/ops/growth/funnel";
import type { AttentionRow } from "@/lib/ops/growth/attention";
import {
  sortFirmRows,
  type FirmRow,
  type FirmSortKey,
  type SortDirection,
} from "@/lib/ops/growth/firm-rows";

const STATUS_STYLE: Record<string, string> = {
  founder: "bg-violet-500/15 text-violet-300",
  active: "bg-emerald-500/15 text-emerald-300",
  trialing: "bg-sky-500/15 text-sky-300",
  past_due: "bg-amber-500/15 text-amber-300",
  unpaid: "bg-amber-500/15 text-amber-300",
  canceled: "bg-rose-500/15 text-rose-300",
  none: "bg-ink-4/15 text-ink-2",
};

const KIND_STYLE: Record<AttentionRow["kind"], string> = {
  canceled: "bg-rose-500/15 text-rose-300",
  trial_ending: "bg-amber-500/15 text-amber-300",
  stalled_checkout: "bg-amber-500/15 text-amber-300",
  signed_in_not_working: "bg-sky-500/15 text-sky-300",
  paywall_blocked: "bg-violet-500/15 text-violet-300",
  new_signup: "bg-emerald-500/15 text-emerald-300",
};

function ago(iso: string | null): string {
  if (!iso) return "never";
  const elapsed = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  // Attention rows carry `trialEnd`, which has NOT happened yet — without this
  // branch every "trial ending" row read "today".
  if (elapsed < 0) return `in ${Math.ceil(-elapsed)}d`;
  const days = Math.floor(elapsed);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

const FIRM_COLUMNS: Array<{ key: FirmSortKey; label: string }> = [
  { key: "displayName", label: "Firm" },
  { key: "status", label: "Status" },
  { key: "seats", label: "Seats" },
  { key: "lastSignInAt", label: "Last sign-in" },
  { key: "lastActionAt", label: "Last action" },
  { key: "clients", label: "Clients" },
];

function usd(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-hair p-4">
      <div className="text-xs uppercase tracking-wide text-ink-3">{label}</div>
      <div className="mt-1 text-2xl font-medium tabular text-ink">{value}</div>
      {sub ? <div className="mt-0.5 text-xs text-ink-3">{sub}</div> : null}
    </div>
  );
}

export default function GrowthClient({
  metrics,
  funnel,
  attention,
  firms,
}: {
  metrics: GrowthMetrics;
  funnel: FunnelStageGroup[];
  attention: AttentionRow[];
  firms: FirmRow[];
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: FirmSortKey; dir: SortDirection }>({
    key: "displayName",
    dir: "asc",
  });
  const sortedFirms = useMemo(() => sortFirmRows(firms, sort.key, sort.dir), [firms, sort]);

  return (
    <div className="space-y-8">
      <h1 className="text-lg font-medium text-ink">Growth</h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Tile label="Monthly revenue" value={usd(metrics.mrrCents)} />
        <Tile
          label="Trials running"
          value={String(metrics.trialsRunning)}
          sub={`${metrics.trialsEndingSoon} ending this week`}
        />
        <Tile
          label="Trial → paid"
          value={metrics.trialToPaidPct === null ? "—" : `${metrics.trialToPaidPct}%`}
          sub={
            metrics.resolvedTrials === 0
              ? "no trial has ended yet"
              : `${metrics.convertedTrials} of ${metrics.resolvedTrials}`
          }
        />
        <Tile label="Stalled at checkout" value={String(metrics.stalledAtCheckout)} />
        <Tile label="Active this week" value={String(metrics.activeThisWeek)} />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-ink">Needs you</h2>
        {attention.length === 0 ? (
          <p className="rounded border border-hair p-4 text-sm text-ink-3">
            Nothing needs you today.
          </p>
        ) : (
          <ul className="divide-y divide-hair rounded border border-hair">
            {attention.map((r, i) => (
              <li key={`${r.kind}-${r.firmId ?? r.email ?? i}`} className="flex items-center gap-3 p-3">
                <span className={`rounded px-2 py-0.5 text-xs ${KIND_STYLE[r.kind]}`}>
                  {r.kind.replace(/_/g, " ")}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-ink">
                  {r.firmId ? (
                    <Link href={`/admin/orgs/${r.firmId}`} className="text-accent hover:underline">
                      {r.who}
                    </Link>
                  ) : (
                    r.who
                  )}
                  {r.email ? <span className="text-ink-3"> · {r.email}</span> : null}
                </span>
                <span className="shrink-0 text-sm text-ink-2">{r.headline}</span>
                <span className="w-20 shrink-0 text-right text-xs text-ink-3">{ago(r.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-ink">Funnel</h2>
        <div className="divide-y divide-hair rounded border border-hair">
          {funnel.map((g) => (
            <div key={g.stage}>
              <button
                type="button"
                onClick={() => setOpen(open === g.stage ? null : g.stage)}
                className="flex w-full items-center justify-between p-3 text-left transition hover:bg-card-2"
              >
                <span className="text-sm text-ink">{g.label}</span>
                <span className="tabular text-sm text-ink-2">{g.people.length}</span>
              </button>
              {open === g.stage && g.people.length > 0 ? (
                <ul className="border-t border-hair bg-card-2">
                  {g.people.map((p) => (
                    <li key={p.userId} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1 truncate text-ink">{p.name}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-3">{p.email ?? "—"}</span>
                      <span className="min-w-0 flex-1 truncate text-ink-3">{p.firmName ?? "—"}</span>
                      <span className="w-20 shrink-0 text-right text-xs text-ink-3">
                        {ago(p.signedUpAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-ink">All firms</h2>
        <div className="overflow-x-auto rounded border border-hair">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-hair text-left text-xs uppercase tracking-wide text-ink-3">
                {FIRM_COLUMNS.map((c) => {
                  const active = sort.key === c.key;
                  return (
                    <th
                      key={c.key}
                      className="p-0 font-normal"
                      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setSort((s) =>
                            s.key === c.key
                              ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" }
                              : { key: c.key, dir: "asc" },
                          )
                        }
                        className="flex w-full items-center gap-1 p-3 uppercase tracking-wide transition hover:text-ink-2"
                      >
                        {c.label}
                        <span aria-hidden="true" className={active ? "" : "invisible"}>
                          {active && sort.dir === "desc" ? "▼" : "▲"}
                        </span>
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {sortedFirms.map((f) => (
                <tr key={f.firmId} className="border-b border-hair last:border-b-0">
                  <td className="p-3">
                    <Link href={`/admin/orgs/${f.firmId}`} className="text-accent hover:underline">
                      {f.displayName}
                    </Link>
                  </td>
                  <td className="p-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[f.status] ?? STATUS_STYLE.none}`}>
                      {f.status}
                    </span>
                  </td>
                  <td className="p-3 tabular text-ink-2">{f.seats}</td>
                  <td className="p-3 text-ink-2">{ago(f.lastSignInAt)}</td>
                  <td className="p-3 text-ink-2">{ago(f.lastActionAt)}</td>
                  <td className="p-3 tabular text-ink-2">{f.clients}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
