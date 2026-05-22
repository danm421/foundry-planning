"use client";

import { useEffect } from "react";
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
  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("overflow-hidden");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("overflow-hidden");
    };
  }, [selected, onClose]);

  if (!selected) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        className="fixed right-0 top-0 z-50 flex h-screen w-full max-w-md flex-col border-l border-gray-800 bg-gray-950 shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-100">
            {panelTitle(selected)}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-gray-400 hover:bg-gray-800"
            aria-label="Close panel"
          >
            ✕
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">
          <PanelBody selected={selected} />
        </div>
      </aside>
    </>
  );
}

function panelTitle(s: SelectedPanel): string {
  switch (s.kind) {
    case "spouseNetWorth":
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
    case "spouseNetWorth":
      return (
        <Stat label={selected.payload.ownerLabel} amount={selected.payload.amount} />
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
    case "transfersToHeirs":
      return (
        <LineList
          lines={(selected.payload.box.lines as import("@/lib/estate/transfer-report").AssetTransferLine[]).map((l) => ({
            label: l.label,
            amount: l.amount,
          }))}
        />
      );
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
