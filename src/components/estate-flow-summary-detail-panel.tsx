"use client";

import { useEffect, useRef } from "react";
import type { SelectedPanel } from "./estate-flow-summary";
import { EstateTransferReductionsCard } from "./estate-transfer-reductions-card";
import { EstateTransferRecipientCard } from "./estate-transfer-recipient-card";
import { EstateFlowSummaryTrustInterests } from "./estate-flow-summary-trust-interests";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

interface Props {
  selected: SelectedPanel | null;
  onClose: () => void;
}

export function EstateFlowSummaryDetailPanel({ selected, onClose }: Props) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (panelRef.current?.contains(target)) return;
      // Clicks on flow boxes re-target the panel — let their handlers run.
      if (target.closest("button")) return;
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, [selected, onClose]);

  if (!selected) return null;

  return (
    <aside
      ref={panelRef}
      role="dialog"
      aria-modal="false"
      aria-label={panelTitle(selected)}
      className="flex max-h-[60vh] w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-slate-900 to-slate-950 shadow-xl shadow-black/40 ring-1 ring-inset ring-white/5"
    >
      <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
        <h2 className="truncate text-xs font-semibold uppercase tracking-wider text-gray-100">
          {panelTitle(selected)}
        </h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-100"
          aria-label="Close panel"
        >
          ✕
        </button>
      </header>
      <div className="scrollbar-subtle flex-1 overflow-y-auto px-4 py-3">
        <PanelBody selected={selected} />
      </div>
    </aside>
  );
}

function panelTitle(s: SelectedPanel): string {
  switch (s.kind) {
    case "survivorNetWorth":
      return `${s.payload.ownerLabel}'s Net Worth`;
    case "estateValue":
      return `${s.payload.stage.decedentLabel} — Estate Value`;
    case "taxesAndExpenses":
      return "Taxes & Expenses";
    case "bequestsToTrusts":
      return "Bequests to Trusts";
    case "transfersToSpouse":
      return "Transfers to Spouse";
    case "transfersToHeirs":
      return "Transfers to Heirs";
    case "ooeGroup":
      return s.payload.groupLabel;
    case "heirDistribution":
      return `${s.payload.heir.recipientLabel}'s Inheritance`;
    case "allHeirs":
      return "Total to Heirs";
  }
}

function PanelBody({ selected }: { selected: SelectedPanel }) {
  switch (selected.kind) {
    case "taxesAndExpenses": {
      const boxes = Array.isArray(selected.payload.box)
        ? selected.payload.box
        : [selected.payload.box];
      const lines = boxes.flatMap((b) =>
        Array.isArray(b.lines) ? (b.lines as import("@/lib/estate/transfer-report").ReductionsLine[]) : [],
      );
      return <EstateTransferReductionsCard reductions={lines} />;
    }
    case "survivorNetWorth":
      return (
        <div className="space-y-3">
          <LineList lines={selected.payload.lines} />
          <div className="border-t border-white/10 pt-3">
            <Stat
              label={`${selected.payload.ownerLabel}'s Total`}
              amount={selected.payload.amount}
              bold
            />
          </div>
        </div>
      );
    case "estateValue":
      return (
        <LineList
          lines={selected.payload.stage.estateLines.map((l) => ({
            label: l.label,
            amount: l.amount,
          }))}
        />
      );
    case "bequestsToTrusts":
    case "transfersToSpouse":
    case "transfersToHeirs": {
      // Sub-box totals are gross asset values; liabilities passing with the
      // asset (a mortgage assumed by the spouse with the home, e.g.) are
      // excluded from the parent so the chart reconciles. Surface them here as
      // a separate "Debts Assumed" section so the advisor still sees what the
      // recipient is taking on, even though it isn't part of the headline.
      const allLines = selected.payload.box
        .lines as import("@/lib/estate/transfer-report").AssetTransferLine[];
      const assetLines = allLines.filter(
        (l) => l.sourceLiabilityId == null && l.amount > 0,
      );
      const debtLines = allLines.filter((l) => l.sourceLiabilityId != null);
      const grossAssets = assetLines.reduce((s, l) => s + l.amount, 0);
      const totalDebt = debtLines.reduce((s, l) => s + l.amount, 0);
      return (
        <div className="space-y-3">
          <LineList
            lines={assetLines.map((l) => ({ label: l.label, amount: l.amount }))}
          />
          <div className="border-t border-white/10 pt-3">
            <Stat label="Gross assets received" amount={grossAssets} bold />
          </div>
          {debtLines.length > 0 && (
            <>
              <div className="pt-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                Debts Assumed
              </div>
              <LineList
                lines={debtLines.map((l) => ({
                  label: l.label,
                  amount: l.amount,
                }))}
              />
              <div className="border-t border-white/10 pt-2">
                <Stat
                  label="Net equity received"
                  amount={grossAssets + totalDebt}
                  bold
                />
              </div>
            </>
          )}
        </div>
      );
    }
    case "ooeGroup":
      return (
        <div className="space-y-4">
          {selected.payload.entities.map((e) => (
            <section key={e.entityId} className="rounded-lg border border-gray-800 px-3 py-2">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-sm font-semibold text-gray-100">{e.entityLabel}</h3>
                <span className="text-sm tabular-nums text-gray-200">{fmt.format(e.amount)}</span>
              </div>
              <LineList lines={e.assets} />
            </section>
          ))}
        </div>
      );
    case "heirDistribution": {
      const heir = selected.payload.heir;
      return (
        <div className="space-y-4">
          {heir.recipientGroups.firstDeath && (
            <EstateTransferRecipientCard group={heir.recipientGroups.firstDeath} />
          )}
          {heir.recipientGroups.secondDeath && (
            <EstateTransferRecipientCard group={heir.recipientGroups.secondDeath} />
          )}
          <EstateFlowSummaryTrustInterests trustInterests={heir.trustInterests} />
          <div className="border-t border-gray-800 pt-2">
            <Stat label="Outright" amount={heir.outright} />
            <Stat label="In Trust" amount={heir.inTrust} />
            <Stat label="Total" amount={heir.total} bold />
          </div>
        </div>
      );
    }
    case "allHeirs":
      return (
        <div className="space-y-2">
          {selected.payload.heirs.map((h) => (
            <Stat key={h.recipientKey} label={h.recipientLabel} amount={h.total} />
          ))}
          <div className="border-t border-gray-800 pt-2">
            <Stat label="Total" amount={selected.payload.total} bold />
          </div>
        </div>
      );
  }
}

function LineList({ lines }: { lines: { label: string; amount: number }[] }) {
  if (lines.length === 0) {
    return <div className="text-sm text-gray-500">No items.</div>;
  }
  return (
    <div className="space-y-1">
      {lines.map((l, i) => (
        <div
          key={`${l.label}-${i}`}
          className="flex items-baseline justify-between gap-4 py-0.5 text-sm text-gray-300"
        >
          <span className="truncate">{l.label}</span>
          <span className="tabular-nums">{fmt.format(l.amount)}</span>
        </div>
      ))}
    </div>
  );
}

function Stat({
  label,
  amount,
  bold,
}: {
  label: string;
  amount: number;
  bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className={bold ? "font-semibold text-gray-100" : "text-gray-300"}>
        {label}
      </span>
      <span
        className={`tabular-nums ${bold ? "font-semibold text-gray-100" : "text-gray-300"}`}
      >
        {fmt.format(amount)}
      </span>
    </div>
  );
}
