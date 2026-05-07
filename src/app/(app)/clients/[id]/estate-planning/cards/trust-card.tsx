"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import MoneyText from "@/components/money-text";
import type { TrustCardData } from "../lib/derive-card-data";
import type { RenderRow } from "../lib/render-rows";

interface Props {
  data: TrustCardData;
  defaultExpanded?: boolean;
  onRemoveSlice?: (args: { accountId: string; trustEntityId: string }) => void;
}

const SUBTYPE_PILL_CLASS: Record<string, string> = {
  ilit: "bg-[var(--color-warn)]/15 text-[var(--color-warn)]",
  slat: "bg-[var(--color-accent)]/15 text-[var(--color-accent-ink)]",
  rev: "bg-[var(--color-cat-portfolio)]/15 text-[var(--color-cat-portfolio)]",
  irrev: "bg-[var(--color-cat-life)]/15 text-[var(--color-cat-life)]",
};

export function TrustCard({ data, defaultExpanded = false, onRemoveSlice }: Props) {
  const [open, setOpen] = useState(defaultExpanded);
  const pill = SUBTYPE_PILL_CLASS[data.subType] ?? "bg-[var(--color-card-2)] text-[var(--color-ink-3)]";
  const { isOver, setNodeRef } = useDroppable({
    id: `trust:${data.entityId}`,
    data: { kind: "trust", entityId: data.entityId, name: data.name },
  });

  return (
    <div
      ref={setNodeRef}
      className={`border-b border-[var(--color-hair)] last:border-b-0${isOver ? " ring-2 ring-[var(--color-accent)] bg-[var(--color-card-hover)]" : ""}`}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 px-5 py-3 text-left hover:bg-[var(--color-card-hover)]"
      >
        <div aria-hidden className="h-2 w-2 shrink-0 bg-[var(--color-accent)]" />
        <div className="flex flex-col">
          <span className="flex items-center">
            <span className="text-[13px] font-semibold leading-tight text-[var(--color-ink)]">{data.name}</span>
            {data.breach && (
              <span
                aria-label="Plan exceeds lifetime exemption — see Gift Tax Report"
                title="Plan exceeds lifetime exemption — see Gift Tax Report"
                className="ml-1 text-amber-400"
              >
                ⚠
              </span>
            )}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5">
            <span className={`rounded-sm px-1.5 py-0.5 text-[9.5px] font-medium uppercase tracking-wider ${pill}`}>
              {data.subType}
            </span>
            {data.grantorRole && (
              <span className="text-xs text-[var(--color-ink-3)]">
                Grantor: {data.grantorRole}
              </span>
            )}
          </span>
        </div>
        <div className="ml-auto flex flex-col items-end">
          <MoneyText value={data.total} className="text-[15px] font-semibold tabular-nums" />
          <span className="text-[10.5px] text-[var(--color-ink-3)]">{data.rows.length} asset{data.rows.length === 1 ? "" : "s"}</span>
        </div>
        <span aria-hidden className={`ml-2 transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
      </button>

      {open && (
        <div className="bg-[var(--color-card-2)] px-5 py-3">
          <dl className="mb-3 text-xs text-[var(--color-ink-3)]">
            <div>
              <dt className="text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">Trustee</dt>
              <dd className="text-[var(--color-ink-2)]">{data.trusteeName ?? "—"}</dd>
            </div>
          </dl>
          <ul className="flex flex-col">
            {data.rows.map((row) => (
              <HeldAssetRow
                key={row.accountId}
                row={row}
                trustEntityId={data.entityId}
                onRemoveSlice={onRemoveSlice}
              />
            ))}
          </ul>
          {data.rows.length === 0 && (
            <div className="rounded-md border border-dashed border-[var(--color-hair-2)] px-3 py-3 text-center text-xs text-[var(--color-ink-3)]">
              Drop assets from a client to fund
            </div>
          )}
          {data.isIrrevocable && (
            <div className="mt-3 border-t border-[var(--color-hair)] pt-2 text-xs text-[var(--color-ink-3)]">
              Uses exemption ·{" "}
              <span className="text-[var(--color-warn)] tabular-nums">
                ${data.exemptionConsumed.toLocaleString("en-US")}
              </span>
              {" / "}
              <span className="tabular-nums">${data.exemptionAvailable.toLocaleString("en-US")}</span>
            </div>
          )}
          {data.splitInterest && <SplitInterestPanel splitInterest={data.splitInterest} />}
        </div>
      )}
    </div>
  );
}

function SplitInterestPanel({
  splitInterest: si,
}: {
  splitInterest: NonNullable<TrustCardData["splitInterest"]>;
}) {
  const payoutLabel =
    si.payoutPercent != null
      ? `${(si.payoutPercent * 100).toFixed(2)}% ${si.payoutType}`
      : si.payoutType;
  return (
    <section className="mt-3 border-t border-[var(--color-hair)] pt-3">
      <h4 className="mb-2 text-[9.5px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
        Split-interest details
      </h4>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <dt className="text-[var(--color-ink-3)]">Payout</dt>
        <dd className="text-[var(--color-ink-2)]">{payoutLabel}</dd>
        <dt className="text-[var(--color-ink-3)]">IRC §7520 rate (locked)</dt>
        <dd className="text-[var(--color-ink-2)]">{(si.irc7520Rate * 100).toFixed(2)}%</dd>
        <dt className="text-[var(--color-ink-3)]">Term</dt>
        <dd className="text-[var(--color-ink-2)]">{describeTerm(si)}</dd>
        <dt className="text-[var(--color-ink-3)]">Charity</dt>
        <dd className="text-[var(--color-ink-2)]">{si.charityName ?? "—"}</dd>
        <dt className="text-[var(--color-ink-3)]">Income interest (deduction)</dt>
        <dd className="font-mono tabular-nums text-[var(--color-ink-2)]">
          ${Math.round(si.originalIncomeInterest).toLocaleString("en-US")}
        </dd>
        <dt className="text-[var(--color-ink-3)]">Remainder interest (gift)</dt>
        <dd className="font-mono tabular-nums text-[var(--color-ink-2)]">
          ${Math.round(si.originalRemainderInterest).toLocaleString("en-US")}
        </dd>
      </dl>
    </section>
  );
}

function describeTerm(si: NonNullable<TrustCardData["splitInterest"]>): string {
  switch (si.termType) {
    case "years":
      return `${si.termYears ?? "?"} years (ends ${si.inceptionYear + (si.termYears ?? 0) - 1})`;
    case "single_life":
      return "Single life";
    case "joint_life":
      return "Joint life (longer of)";
    case "shorter_of_years_or_life":
      return `Shorter of ${si.termYears ?? "?"} years or life`;
    default:
      return "—";
  }
}

function HeldAssetRow({
  row,
  trustEntityId,
  onRemoveSlice,
}: {
  row: RenderRow;
  trustEntityId: string;
  onRemoveSlice?: (args: { accountId: string; trustEntityId: string }) => void;
}) {
  return (
    <li className="flex items-center gap-2 py-1.5 text-[12px]">
      <span className="h-1.5 w-1.5 shrink-0 bg-[var(--color-cat-portfolio)]" aria-hidden />
      <span className="truncate text-[var(--color-ink-2)]">{row.accountName}</span>
      {row.taxTag && (
        <span className="rounded-sm bg-[var(--color-card)] px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-[var(--color-ink-3)]">
          {row.taxTag}
        </span>
      )}
      <MoneyText value={row.sliceValue} className="ml-auto tabular-nums text-[var(--color-ink)]" />
      {onRemoveSlice && (
        <button
          type="button"
          aria-label={`Remove slice of ${row.accountName}`}
          onClick={(e) => {
            e.stopPropagation();
            onRemoveSlice({ accountId: row.accountId, trustEntityId });
          }}
          className="ml-1 rounded p-0.5 text-[var(--color-ink-3)] hover:bg-[var(--color-card-hover)] hover:text-[var(--color-warn)]"
        >
          ×
        </button>
      )}
    </li>
  );
}
