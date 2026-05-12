"use client";

import MoneyText from "@/components/money-text";
import type { BeneficiaryDetail, DeathSlice } from "./lib/derive-beneficiary-detail";

const DRAIN_LABEL: Record<keyof DeathSlice["drains"], string> = {
  federal_estate_tax: "Federal estate tax share",
  state_estate_tax: "State estate tax share",
  admin_expenses: "Admin expense share",
  debts_paid: "Debt share",
  ird_tax: "IRD tax share",
};

interface Props {
  name: string;
  relationship?: string | null;
  detail: BeneficiaryDetail;
  /** True if THIS card is the open one in the strip's single-open invariant. */
  expanded: boolean;
  onToggle: () => void;
  isTrustRemainder?: boolean;
}

export function BeneficiaryCard({
  name,
  relationship,
  detail,
  expanded,
  onToggle,
  isTrustRemainder = false,
}: Props) {
  return (
    <div className={`min-w-0 rounded border border-hair ${expanded ? "col-span-4" : ""}`}>
      <button
        type="button"
        aria-expanded={expanded}
        onClick={onToggle}
        className="flex w-full flex-col items-start gap-1 p-2 text-left hover:bg-card-hover"
      >
        <div className="min-w-0 w-full">
          <div
            className={`truncate text-[13px] font-semibold ${
              isTrustRemainder ? "text-ink-2" : "text-ink"
            }`}
            title={isTrustRemainder ? `+ ${name}` : name}
          >
            {isTrustRemainder ? `+ ${name}` : name}
          </div>
          {relationship && (
            <div className="truncate text-[11px] text-ink-3">{relationship}</div>
          )}
        </div>
        <MoneyText
          value={detail.total}
          className={`whitespace-nowrap text-[15px] tabular-nums ${
            isTrustRemainder ? "text-ink-2" : "text-accent-ink"
          }`}
        />
      </button>
      {expanded && (
        <div className="border-t border-hair px-3 py-3 space-y-4 text-[12px]">
          {detail.fromFirstDeath.gross > 0 && (
            <DeathSection label="From first death" slice={detail.fromFirstDeath} />
          )}
          {detail.fromSecondDeath.gross > 0 && (
            <DeathSection label="From second death" slice={detail.fromSecondDeath} />
          )}
          {detail.inTrust.length > 0 && <TrustSection inTrust={detail.inTrust} />}
          <div className="flex items-center justify-between border-t border-hair pt-2 text-[13px] font-semibold">
            <span className="uppercase tracking-wider text-[11px]">Total</span>
            <MoneyText value={detail.total} className="tabular-nums text-ink" />
          </div>
        </div>
      )}
    </div>
  );
}

function DeathSection({ label, slice }: { label: string; slice: DeathSlice }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-ink-3 border-b border-hair pb-0.5">
        <span>{label}</span>
        <MoneyText value={slice.net} className="tabular-nums" />
      </div>
      <ul className="mt-1 space-y-0.5">
        {slice.transfers.map((t, i) => (
          <li key={i} className="flex items-center justify-between pl-3">
            <span className="flex items-center gap-2 truncate">
              <span className="truncate text-ink-2">
                {t.sourceAccountName ?? t.sourceLiabilityName ?? "—"}
              </span>
              <span className="rounded-sm bg-card px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-ink-3">
                via {t.via.replace(/_/g, " ")}
              </span>
            </span>
            <MoneyText value={t.amount} className="tabular-nums text-ink" />
          </li>
        ))}
      </ul>
      {(["federal_estate_tax", "state_estate_tax", "admin_expenses", "debts_paid"] as const).map(
        (kind) => {
          const v = slice.drains[kind];
          if (v <= 0.5) return null;
          return (
            <div key={kind} className="flex items-center justify-between pl-3 text-ink-3">
              <span>{DRAIN_LABEL[kind]}</span>
              <span className="tabular-nums">
                ({Math.round(v).toLocaleString()})
              </span>
            </div>
          );
        },
      )}
      {slice.inheritanceTax > 0.5 && (
        <div className="flex items-center justify-between pl-3 text-ink-3">
          <span>State inheritance tax share</span>
          <span className="tabular-nums">
            ({Math.round(slice.inheritanceTax).toLocaleString()})
          </span>
        </div>
      )}
      <div className="flex items-center justify-between pl-3 border-t border-hair mt-1 pt-0.5 font-semibold text-ink-2">
        <span>— Net from {label.toLowerCase()}</span>
        <MoneyText value={slice.net} className="tabular-nums" />
      </div>
    </div>
  );
}

function TrustSection({ inTrust }: { inTrust: BeneficiaryDetail["inTrust"] }) {
  return (
    <div>
      <div
        className="flex items-center justify-between text-[11px] uppercase tracking-wider text-ink-3 border-b border-hair pb-0.5"
        title="Estimated based on primary beneficiary percentages — actual distributions depend on trustee discretion."
      >
        <span>In trust (pro-rata estimate)</span>
        <MoneyText
          value={inTrust.reduce((s, t) => s + t.amount, 0)}
          className="tabular-nums"
        />
      </div>
      <ul className="mt-1 space-y-0.5">
        {inTrust.map((p) => (
          <li key={p.trustId} className="flex items-center justify-between pl-3">
            <span className="text-ink-2">
              {p.trustName} ({p.primaryPercentage}% beneficiary)
            </span>
            <MoneyText value={p.amount} className="tabular-nums text-ink" />
          </li>
        ))}
      </ul>
    </div>
  );
}
