"use client";

import { useState } from "react";
import type {
  EstateFlowSummary,
  DeathStage,
  DeathSubBox,
  HeirBox,
  OoeEntity,
} from "@/lib/estate/estate-flow-summary";
import { EstateFlowSummaryDetailPanel } from "./estate-flow-summary-detail-panel";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

export type SelectedPanel =
  | {
      kind: "survivorNetWorth";
      payload: {
        ownerLabel: string;
        amount: number;
        lines: { label: string; amount: number }[];
      };
    }
  | { kind: "estateValue"; payload: { which: "first" | "second"; stage: DeathStage } }
  | { kind: "taxesAndExpenses"; payload: { which: "first" | "second" | "both"; box: DeathSubBox | DeathSubBox[] } }
  | { kind: "bequestsToTrusts"; payload: { which: "first" | "second"; box: DeathSubBox } }
  | { kind: "transfersToSpouse"; payload: { box: DeathSubBox } }
  | { kind: "transfersToHeirs"; payload: { which: "first" | "second"; box: DeathSubBox } }
  | { kind: "ooeGroup"; payload: { groupLabel: string; entities: OoeEntity[] } }
  | { kind: "heirDistribution"; payload: { heir: HeirBox } }
  | { kind: "allHeirs"; payload: { heirs: HeirBox[]; total: number } };

type Role = "client" | "spouse";

interface Props {
  summary: EstateFlowSummary | null;
  emptyMessage?: string;
  clientName?: string;
}

export function EstateFlowSummaryView({
  summary,
  emptyMessage = "No estate flow to show for this selection.",
  clientName,
}: Props) {
  const [selected, setSelected] = useState<SelectedPanel | null>(null);

  if (!summary) {
    return (
      <div className="py-16 text-center text-sm text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  const { survivorNetWorth, firstDeath, secondDeath, outOfEstate, heirBoxes, totals } = summary;

  const roleFor = (label: string): Role => {
    if (!clientName) return "client";
    return label.startsWith(clientName) ? "client" : "spouse";
  };

  const showTotals = Boolean(firstDeath || secondDeath);
  const hasOoe =
    outOfEstate.heirs.entities.length > 0 ||
    outOfEstate.irrevTrusts.entities.length > 0;

  // Three-column grid with a shared header row above the data row so the
  // "Net Worth" box and the first-death "Estate" box anchor at the same y —
  // putting the section headers inside the data columns made each column
  // start at a different vertical offset depending on whether it had a label.
  // The grid stays three columns whether or not there are out-of-estate
  // assets, so the in-estate flow keeps its position instead of sliding to
  // the right when the out-of-estate column is empty.
  const gridCols =
    "lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)_minmax(0,1fr)]";

  return (
    <div className="flex flex-col gap-6">
      <div className={`grid grid-cols-1 gap-x-6 gap-y-3 ${gridCols}`}>
        {/* Header row — In Estate spans the net-worth + death-chain columns */}
        <div className="hidden lg:col-span-2 lg:flex lg:justify-center">
          <SectionHeader tone="estate" label="In Estate" />
        </div>
        <div className="hidden lg:flex lg:justify-start">
          <SectionHeader tone="neutral" label="Out of Estate" />
        </div>

        {/* LEFT: Survivor Net Worth + detail panel */}
        <div className="flex flex-col items-start gap-3 lg:items-end">
          <div className="lg:hidden">
            <SectionHeader tone="estate" label="In Estate" />
          </div>
          {survivorNetWorth && (
            <div className="w-full max-w-[280px]">
              <BoxButton
                tone={
                  roleFor(survivorNetWorth.ownerLabel) === "client"
                    ? "clientSolid"
                    : "spouseSolid"
                }
                title={`${survivorNetWorth.ownerLabel}'s Net Worth`}
                value={survivorNetWorth.amount}
                onClick={() =>
                  setSelected({ kind: "survivorNetWorth", payload: survivorNetWorth })
                }
              />
            </div>
          )}
          {selected && selected.kind !== "heirDistribution" && (
            <div className="w-full max-w-[320px]">
              <EstateFlowSummaryDetailPanel
                selected={selected}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </div>

        {/* CENTER: Death chain + totals */}
        <div className="flex flex-col gap-2">
          {firstDeath && (
            <DeathColumn
              stage={firstDeath}
              which="first"
              onSelect={setSelected}
            />
          )}
          {firstDeath && secondDeath && <FlowArrow />}
          {secondDeath && (
            <DeathColumn
              stage={secondDeath}
              which="second"
              onSelect={setSelected}
            />
          )}
          {showTotals && (
            <>
              <FlowArrow />
              <div className="flex flex-col gap-2">
                <BoxButton
                  tone="tax"
                  title="Total Taxes & Expenses"
                  value={totals.totalTaxesAndExpenses}
                  onClick={() => {
                    const boxes: DeathSubBox[] = [];
                    const firstTax = firstDeath?.subBoxes.find((b) => b.kind === "taxes");
                    const secondTax = secondDeath?.subBoxes.find((b) => b.kind === "taxes");
                    if (firstTax) boxes.push(firstTax);
                    if (secondTax) boxes.push(secondTax);
                    setSelected({
                      kind: "taxesAndExpenses",
                      payload: { which: "both", box: boxes },
                    });
                  }}
                />
                <BoxButton
                  tone="heirs"
                  title="Total to Heirs"
                  value={totals.totalToHeirs}
                  onClick={() =>
                    setSelected({
                      kind: "allHeirs",
                      payload: { heirs: heirBoxes, total: totals.totalToHeirs },
                    })
                  }
                />
              </div>
            </>
          )}
        </div>

        {/* RIGHT: Out of Estate — column always rendered so the in-estate
            flow keeps its position; shows a placeholder when empty. */}
        <div className="flex flex-col items-start gap-3">
          <div className="lg:hidden">
            <SectionHeader tone="neutral" label="Out of Estate" />
          </div>
          <div className="flex w-full max-w-[280px] flex-col gap-3">
            {hasOoe ? (
              <>
                {outOfEstate.heirs.entities.length > 0 && (
                  <OoeEntityGroup
                    label="Heirs"
                    entities={outOfEstate.heirs.entities}
                    onSelect={(entity) =>
                      setSelected({
                        kind: "ooeGroup",
                        payload: {
                          groupLabel: entity.entityLabel,
                          entities: [entity],
                        },
                      })
                    }
                  />
                )}
                {outOfEstate.irrevTrusts.entities.length > 0 && (
                  <OoeEntityGroup
                    label="Irrev Trusts"
                    entities={outOfEstate.irrevTrusts.entities}
                    onSelect={(entity) =>
                      setSelected({
                        kind: "ooeGroup",
                        payload: {
                          groupLabel: entity.entityLabel,
                          entities: [entity],
                        },
                      })
                    }
                  />
                )}
              </>
            ) : (
              <OoeEmptyState />
            )}
          </div>
        </div>
      </div>

      {heirBoxes.length > 0 && (
        <div className="flex flex-col items-center gap-4">
          {chunkInto(heirBoxes, 5).map((row, rowIdx) => (
            <div
              key={rowIdx}
              className="flex flex-wrap justify-center gap-4"
            >
              {row.map((h) => {
                const isActive =
                  selected?.kind === "heirDistribution" &&
                  selected.payload.heir.recipientKey === h.recipientKey;
                return (
                  <HeirBoxButton
                    key={h.recipientKey}
                    heir={h}
                    isActive={isActive}
                    onClick={() =>
                      setSelected(
                        isActive
                          ? null
                          : { kind: "heirDistribution", payload: { heir: h } },
                      )
                    }
                  />
                );
              })}
            </div>
          ))}
          {selected?.kind === "heirDistribution" && (
            <div className="w-full max-w-xl">
              <EstateFlowSummaryDetailPanel
                selected={selected}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DeathColumn({
  stage,
  which,
  onSelect,
}: {
  stage: DeathStage;
  which: "first" | "second";
  onSelect: (s: SelectedPanel) => void;
}) {
  return (
    <div className="flex flex-col items-stretch gap-0">
      <BoxButton
        tone="clientSolid"
        title={stage.decedentLabel}
        value={stage.estateValue}
        onClick={() =>
          onSelect({ kind: "estateValue", payload: { which, stage } })
        }
      />
      {stage.subBoxes.length > 0 && (
        <>
          <FlowArrow compact />
          <div className="flex flex-col gap-1.5 rounded-xl border border-white/5 bg-slate-950/40 p-2 shadow-inner shadow-black/30">
            {stage.subBoxes.map((b) => (
              <SubBoxButton
                key={b.kind}
                box={b}
                onClick={() => onSelect(mapSubBoxToPanel(which, b))}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function OoeEntityGroup({
  label,
  entities,
  onSelect,
}: {
  label: string;
  entities: OoeEntity[];
  onSelect: (entity: OoeEntity) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
        {label}
      </div>
      {entities.map((entity) => (
        <BoxButton
          key={entity.entityId}
          tone="neutral"
          title={entity.entityLabel}
          value={entity.amount}
          onClick={() => onSelect(entity)}
        />
      ))}
    </div>
  );
}

function OoeEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-600/50 bg-slate-950/30 px-5 py-6 text-center">
      <span className="text-xs font-medium text-slate-400">
        Nothing outside the estate
      </span>
      <span className="text-[11px] leading-snug text-slate-500">
        All assets are included in the taxable estate.
      </span>
    </div>
  );
}

function SectionHeader({
  tone,
  label,
}: {
  tone: "estate" | "neutral";
  label: string;
}) {
  const dotClass =
    tone === "estate"
      ? "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.5)]"
      : "bg-slate-400 shadow-[0_0_10px_rgba(148,163,184,0.5)]";
  return (
    <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} aria-hidden />
      {label}
    </div>
  );
}

function FlowArrow({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`flex justify-center text-slate-500 ${compact ? "py-1" : "py-2"}`}
      aria-hidden
    >
      <svg
        width={compact ? 14 : 18}
        height={compact ? 22 : 28}
        viewBox="0 0 14 22"
        fill="none"
        className="drop-shadow-[0_0_6px_rgba(148,163,184,0.25)]"
      >
        <path
          d="M7 0 L7 18 M1 14 L7 20 L13 14"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function chunkInto<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
}

function mapSubBoxToPanel(
  which: "first" | "second",
  box: DeathSubBox,
): SelectedPanel {
  switch (box.kind) {
    case "taxes":
      return { kind: "taxesAndExpenses", payload: { which, box } };
    case "trusts":
      return { kind: "bequestsToTrusts", payload: { which, box } };
    case "inheritance_spouse":
      return { kind: "transfersToSpouse", payload: { box } };
    case "heirs_outright":
      return { kind: "transfersToHeirs", payload: { which, box } };
  }
}

const TONE_CLASSES = {
  client:
    "border-amber-400/50 bg-gradient-to-br from-amber-400/30 via-amber-500/20 to-yellow-600/25 text-amber-50 shadow-lg shadow-amber-500/15 ring-1 ring-inset ring-amber-300/20",
  clientSolid:
    "border-amber-700/80 bg-accent/80 text-white backdrop-blur-sm shadow-lg shadow-amber-500/25 ring-1 ring-inset ring-amber-300/40",
  spouse:
    "border-slate-200/40 bg-gradient-to-br from-slate-100/15 via-slate-200/10 to-slate-300/20 text-white shadow-lg shadow-slate-200/10 ring-1 ring-inset ring-white/20",
  spouseSolid:
    "border-white/70 bg-white/75 text-slate-950 backdrop-blur-sm shadow-lg shadow-slate-300/25 ring-1 ring-inset ring-white/60",
  tax:
    "border-red-700/80 bg-red-600/75 text-white backdrop-blur-sm shadow-lg shadow-red-500/25 ring-1 ring-inset ring-red-300/40",
  inheritanceSpouse:
    "border-sky-700/80 bg-sky-500/75 text-white backdrop-blur-sm shadow-lg shadow-sky-500/25 ring-1 ring-inset ring-sky-200/40",
  heirs:
    "border-emerald-700/80 bg-emerald-600/75 text-white backdrop-blur-sm shadow-lg shadow-emerald-600/25 ring-1 ring-inset ring-emerald-400/40",
  neutral:
    "border-slate-500/80 bg-slate-400/70 text-white backdrop-blur-sm shadow-lg shadow-slate-500/25 ring-1 ring-inset ring-slate-200/40",
} as const;

const INTERACTIVE =
  "transition-all duration-200 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950";

function BoxButton({
  tone,
  title,
  value,
  onClick,
}: {
  tone: keyof typeof TONE_CLASSES;
  title: string;
  value: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${title}: ${fmt.format(value)}`}
      className={`flex w-full flex-col items-center justify-center gap-1 rounded-xl border px-5 py-4 text-center backdrop-blur-sm ${INTERACTIVE} ${TONE_CLASSES[tone]}`}
    >
      <span className="text-xs font-medium uppercase tracking-wider opacity-80">
        {title}
      </span>
      <span className="text-xl font-semibold tabular-nums">
        {fmt.format(value)}
      </span>
    </button>
  );
}

function SubBoxButton({
  box,
  onClick,
}: {
  box: DeathSubBox;
  onClick: () => void;
}) {
  const tone: keyof typeof TONE_CLASSES =
    box.kind === "taxes"
      ? "tax"
      : box.kind === "inheritance_spouse"
        ? "inheritanceSpouse"
        : "heirs";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${box.label}: ${fmt.format(box.total)}`}
      className={`flex items-baseline justify-between rounded-lg border px-3.5 py-2.5 text-sm font-medium ${INTERACTIVE} ${TONE_CLASSES[tone]}`}
    >
      <span>{box.label}</span>
      <span className="text-base font-semibold tabular-nums">
        {fmt.format(box.total)}
      </span>
    </button>
  );
}

function HeirBoxButton({
  heir,
  isActive = false,
  onClick,
}: {
  heir: HeirBox;
  isActive?: boolean;
  onClick: () => void;
}) {
  const activeClass = isActive
    ? "border-emerald-300 ring-emerald-200/70 shadow-emerald-400/40 -translate-y-0.5 brightness-110"
    : "";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      aria-label={`${heir.recipientLabel}: ${fmt.format(heir.total)}`}
      className={`flex w-[220px] flex-col rounded-xl border border-emerald-700/80 bg-emerald-600/75 px-5 py-4 text-white backdrop-blur-sm shadow-lg shadow-emerald-600/25 ring-1 ring-inset ring-emerald-400/40 ${INTERACTIVE} ${activeClass}`}
    >
      <span className="mb-2 text-sm font-semibold tracking-wide">
        {heir.recipientLabel}
      </span>
      <Row label="Outright" amount={heir.outright} />
      <Row label="In Trust" amount={heir.inTrust} />
      <div className="my-2 border-t border-emerald-900/30" />
      <Row label="Total" amount={heir.total} bold />
    </button>
  );
}

function Row({
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
      <span className={bold ? "font-semibold" : ""}>{label}</span>
      <span className={`tabular-nums ${bold ? "font-semibold" : ""}`}>
        {fmt.format(amount)}
      </span>
    </div>
  );
}
