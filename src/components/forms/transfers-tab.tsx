"use client";

import { useState } from "react";

// ── Money formatters ──────────────────────────────────────────────────────────

const fmtFull = new Intl.NumberFormat("en-US", {
  style: "decimal",
  maximumFractionDigits: 0,
});

/** "19,000" */
function formatMoney(value: number): string {
  return fmtFull.format(value);
}

/** "$4.2M", "$120K", "$500" — compact form for the exemption bar */
function formatCompact(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) {
    const m = value / 1_000_000;
    // Show one decimal only when it's non-zero
    const str = Number.isInteger(m) || m.toFixed(1).endsWith(".0")
      ? m.toFixed(1).replace(/\.0$/, "")
      : m.toFixed(1);
    return `$${str}M`;
  }
  if (abs >= 1_000) {
    const k = value / 1_000;
    const str = Number.isInteger(k) || k.toFixed(1).endsWith(".0")
      ? k.toFixed(1).replace(/\.0$/, "")
      : k.toFixed(1);
    return `$${str}K`;
  }
  return `$${fmtFull.format(value)}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export type TransferEvent =
  | {
      kind: "cash";
      id: string;
      year: number;
      amount: number;
      grantor: "client" | "spouse";
      useCrummeyPowers: boolean;
      notes?: string;
    }
  | {
      kind: "asset";
      id: string;
      year: number;
      accountName: string;
      percent: number; // 0–1
      value: number;
      grantor: "client" | "spouse";
      bundledLiability?: { name: string; value: number; percent: number };
    }
  | {
      kind: "liability_only";
      id: string;
      year: number;
      liabilityName: string;
      percent: number; // 0–1
      value: number;
      grantor: "client" | "spouse";
    };

export interface TransferSeries {
  id: string;
  startYear: number;
  endYear: number;
  annualAmount: number;
  inflationAdjust: boolean;
  useCrummeyPowers: boolean;
  grantor: "client" | "spouse";
}

export interface ExemptionDisplay {
  client?: { used: number; total: number };
  spouse?: { used: number; total: number };
}

interface Props {
  events: TransferEvent[];
  series: TransferSeries[];
  exemption: ExemptionDisplay;
  totalConsumedByThisTrust: { client: number; spouse: number };
  onAdd: (kind: "asset" | "cash" | "series") => void;
  onEdit: (item: TransferEvent | TransferSeries) => void;
  onDelete: (item: TransferEvent | TransferSeries) => void;
}

// ── ExemptionPanel ────────────────────────────────────────────────────────────

function ExemptionBar({ label, used, total }: { label: string; used: number; total: number }) {
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[12px]">
        <span className="text-ink-3 font-medium">{label}</span>
        <span className="text-ink-2 tabular">
          used {formatCompact(used)} / {formatCompact(total)}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-card-2 overflow-hidden">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function ExemptionPanel({ exemption }: { exemption: ExemptionDisplay }) {
  const hasSomething = exemption.client || exemption.spouse;
  if (!hasSomething) return null;
  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2.5 space-y-2">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-3">
        Lifetime Gift / Estate Exemption
      </p>
      {exemption.client && (
        <ExemptionBar
          label="Client"
          used={exemption.client.used}
          total={exemption.client.total}
        />
      )}
      {exemption.spouse && (
        <ExemptionBar
          label="Spouse"
          used={exemption.spouse.used}
          total={exemption.spouse.total}
        />
      )}
    </div>
  );
}

// ── AddTransferMenu ───────────────────────────────────────────────────────────

const ADD_MENU_ITEMS: { label: string; kind: "asset" | "cash" | "series" }[] = [
  { label: "Asset transfer", kind: "asset" },
  { label: "Cash gift", kind: "cash" },
  { label: "Recurring gift series", kind: "series" },
];

function AddTransferMenu({
  open,
  setOpen,
  onAdd,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  onAdd: (kind: "asset" | "cash" | "series") => void;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Add transfer"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="text-[12px] text-accent hover:text-accent-deep font-medium"
      >
        + Add transfer
      </button>
      {open && (
        <>
          {/* Backdrop to close on outside click */}
          <div
            className="fixed inset-0 z-10"
            onClick={() => setOpen(false)}
          />
          <div
            role="menu"
            className="absolute right-0 z-20 mt-1 w-48 rounded-[var(--radius-sm)] border border-hair bg-card shadow-lg py-1"
          >
            {ADD_MENU_ITEMS.map((item) => (
              <button
                key={item.kind}
                type="button"
                role="menuitem"
                aria-label={item.label}
                onClick={() => {
                  setOpen(false);
                  onAdd(item.kind);
                }}
                className="w-full text-left px-3 py-1.5 text-[13px] text-ink hover:bg-card-hover"
              >
                {item.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── TransfersList ─────────────────────────────────────────────────────────────

function pctLabel(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

function EventRow({
  event,
  onEdit,
  onDelete,
}: {
  event: TransferEvent;
  onEdit: (e: TransferEvent) => void;
  onDelete: (e: TransferEvent) => void;
}) {
  switch (event.kind) {
    case "cash":
      return (
        <li className="flex flex-col gap-0.5 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-ink-4 tabular w-10 shrink-0">{event.year}</span>
            <span className="flex-1 text-[13px] text-ink">
              ${formatMoney(event.amount)} gift to trust
            </span>
            <span className="text-[11px] text-ink-4 capitalize">{event.grantor}</span>
            {event.useCrummeyPowers && (
              <span className="text-[11px] text-accent font-medium">Crummey powers ✓</span>
            )}
            <RowActions item={event} onEdit={onEdit} onDelete={onDelete} />
          </div>
        </li>
      );

    case "asset": {
      const pct = pctLabel(event.percent);
      return (
        <li className="rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-ink-4 tabular w-10 shrink-0">{event.year}</span>
            <span className="flex-1 text-[13px] text-ink">
              {event.accountName} {pct}
            </span>
            <span className="text-[12px] text-ink-2 tabular">${formatMoney(event.value)}</span>
            <span className="text-[11px] text-ink-4 capitalize">{event.grantor}</span>
            <RowActions item={event} onEdit={onEdit} onDelete={onDelete} />
          </div>
          {event.bundledLiability && (
            <div className="ml-10 text-[12px] text-ink-4 italic">
              {event.bundledLiability.name} on {event.accountName} (auto-bundled, {pct})
            </div>
          )}
        </li>
      );
    }

    case "liability_only":
      return (
        <li className="flex items-center gap-2 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
          <span className="text-[12px] text-ink-4 tabular w-10 shrink-0">{event.year}</span>
          <span className="flex-1 text-[13px] text-ink">
            {event.liabilityName} {pctLabel(event.percent)}
          </span>
          <span className="text-[12px] text-ink-2 tabular">${formatMoney(event.value)}</span>
          <span className="text-[11px] text-ink-4 capitalize">{event.grantor}</span>
          <RowActions item={event} onEdit={onEdit} onDelete={onDelete} />
        </li>
      );

    default: {
      // Exhaustive check — future kinds break compile here
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _exhaust: never = event;
      return null;
    }
  }
}

function SeriesRow({
  series,
  onEdit,
  onDelete,
}: {
  series: TransferSeries;
  onEdit: (s: TransferSeries) => void;
  onDelete: (s: TransferSeries) => void;
}) {
  return (
    <li className="flex flex-col gap-0.5 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-[12px] text-ink-4 tabular shrink-0">
          {series.startYear} – {series.endYear}
        </span>
        <span className="flex-1 text-[13px] text-ink">
          ${formatMoney(series.annualAmount)}/yr
          {series.inflationAdjust && (
            <span className="ml-1 text-[11px] text-ink-4">(inflation-adj.)</span>
          )}
        </span>
        <span className="text-[11px] text-ink-4 capitalize">{series.grantor}</span>
        {series.useCrummeyPowers && (
          <span className="text-[11px] text-accent font-medium">Crummey powers ✓</span>
        )}
        <button
          type="button"
          aria-label="Edit series"
          onClick={() => onEdit(series)}
          className="text-[12px] text-ink-4 hover:text-ink"
        >
          Edit
        </button>
        <button
          type="button"
          aria-label="Delete series"
          onClick={() => onDelete(series)}
          className="text-[12px] text-ink-4 hover:text-crit"
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function RowActions<T extends TransferEvent | TransferSeries>({
  item,
  onEdit,
  onDelete,
}: {
  item: T;
  onEdit: (item: T) => void;
  onDelete: (item: T) => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Edit"
        onClick={() => onEdit(item)}
        className="text-[12px] text-ink-4 hover:text-ink"
      >
        Edit
      </button>
      <button
        type="button"
        aria-label="Delete"
        onClick={() => onDelete(item)}
        className="text-[12px] text-ink-4 hover:text-crit"
      >
        Delete
      </button>
    </>
  );
}

function TransfersList({
  events,
  series,
  onEdit,
  onDelete,
}: {
  events: TransferEvent[];
  series: TransferSeries[];
  onEdit: (item: TransferEvent | TransferSeries) => void;
  onDelete: (item: TransferEvent | TransferSeries) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {events.map((e) => (
        <EventRow
          key={e.id}
          event={e}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
      {series.map((s) => (
        <SeriesRow
          key={s.id}
          series={s}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      ))}
    </ul>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TransfersTab({
  events,
  series,
  exemption,
  totalConsumedByThisTrust,
  onAdd,
  onEdit,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);

  const isEmpty = events.length === 0 && series.length === 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Lifetime exemption */}
      <ExemptionPanel exemption={exemption} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-ink-2 uppercase tracking-wider">
          Transfers in &amp; out
        </h3>
        <AddTransferMenu open={menuOpen} setOpen={setMenuOpen} onAdd={onAdd} />
      </div>

      {/* List or empty state */}
      {isEmpty ? (
        <div className="text-[13px] text-ink-4 italic py-2">
          No transfers recorded yet.
        </div>
      ) : (
        <TransfersList
          events={events}
          series={series}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}

      {/* Total consumed by this trust */}
      {!isEmpty && (
        <div className="text-[12px] text-ink-4 border-t border-hair pt-2">
          Exemption consumed by this trust:{" "}
          {formatCompact(totalConsumedByThisTrust.client)} (client)
          {totalConsumedByThisTrust.spouse > 0 &&
            ` · ${formatCompact(totalConsumedByThisTrust.spouse)} (spouse)`}
        </div>
      )}
    </div>
  );
}
