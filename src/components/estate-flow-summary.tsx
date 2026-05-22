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
  | { kind: "spouseNetWorth"; payload: { ownerLabel: string; amount: number } }
  | { kind: "estateValue"; payload: { which: "first" | "second"; stage: DeathStage } }
  | { kind: "taxesAndExpenses"; payload: { which: "first" | "second" | "both"; box: DeathSubBox | DeathSubBox[] } }
  | { kind: "bequestsToTrusts"; payload: { which: "first" | "second"; box: DeathSubBox } }
  | { kind: "transfersToSpouse"; payload: { box: DeathSubBox } }
  | { kind: "transfersToHeirs"; payload: { which: "first" | "second"; box: DeathSubBox } }
  | { kind: "ooeGroup"; payload: { groupLabel: string; entities: OoeEntity[] } }
  | { kind: "heirDistribution"; payload: { heir: HeirBox } }
  | { kind: "allHeirs"; payload: { heirs: HeirBox[]; total: number } };

interface Props {
  summary: EstateFlowSummary | null;
  emptyMessage?: string;
}

export function EstateFlowSummaryView({
  summary,
  emptyMessage = "No estate flow to show for this selection.",
}: Props) {
  const [selected, setSelected] = useState<SelectedPanel | null>(null);

  if (!summary) {
    return (
      <div className="py-16 text-center text-sm text-gray-500">
        {emptyMessage}
      </div>
    );
  }

  const { spouseNetWorth, firstDeath, secondDeath, outOfEstate, heirBoxes, totals } = summary;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-[1fr_220px]">
        <div className="flex flex-col gap-4">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
            In Estate
          </div>
          <div className="flex flex-wrap gap-4">
            {spouseNetWorth && (
              <BoxButton
                tone="estate"
                title={`${spouseNetWorth.ownerLabel}'s Net Worth`}
                value={spouseNetWorth.amount}
                onClick={() =>
                  setSelected({ kind: "spouseNetWorth", payload: spouseNetWorth })
                }
              />
            )}
            {firstDeath && (
              <DeathColumn
                stage={firstDeath}
                which="first"
                onSelect={setSelected}
              />
            )}
          </div>
          {firstDeath && secondDeath && (
            <div className="text-center text-2xl text-gray-500" aria-hidden>↓</div>
          )}
          {secondDeath && (
            <DeathColumn
              stage={secondDeath}
              which="second"
              onSelect={setSelected}
            />
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500">
            Out of Estate
          </div>
          {outOfEstate.heirs.total > 0 && (
            <BoxButton
              tone="neutral"
              title="Heirs"
              value={outOfEstate.heirs.total}
              onClick={() =>
                setSelected({
                  kind: "ooeGroup",
                  payload: {
                    groupLabel: "Heirs (Out of Estate)",
                    entities: outOfEstate.heirs.entities,
                  },
                })
              }
            />
          )}
          {outOfEstate.irrevTrusts.total > 0 && (
            <BoxButton
              tone="neutral"
              title="Irrev Trusts"
              value={outOfEstate.irrevTrusts.total}
              onClick={() =>
                setSelected({
                  kind: "ooeGroup",
                  payload: {
                    groupLabel: "Irrevocable Trusts (Out of Estate)",
                    entities: outOfEstate.irrevTrusts.entities,
                  },
                })
              }
            />
          )}
        </div>
      </div>

      {heirBoxes.length > 0 && (
        <div className="flex flex-wrap gap-4">
          {heirBoxes.map((h) => (
            <HeirBoxButton
              key={h.recipientKey}
              heir={h}
              onClick={() =>
                setSelected({ kind: "heirDistribution", payload: { heir: h } })
              }
            />
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <BoxButton
          tone="tax"
          title="Total Taxes and Expenses"
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
          tone="recipient"
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

      <EstateFlowSummaryDetailPanel
        selected={selected}
        onClose={() => setSelected(null)}
      />
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
        tone="estate"
        title={stage.decedentLabel}
        value={stage.estateValue}
        onClick={() =>
          onSelect({ kind: "estateValue", payload: { which, stage } })
        }
      />
      <div className="text-center text-2xl text-gray-500" aria-hidden>↓</div>
      <div className="flex flex-col gap-1 rounded-lg border border-gray-800/60 p-1">
        {stage.subBoxes.map((b) => (
          <SubBoxButton
            key={b.kind}
            box={b}
            onClick={() => onSelect(mapSubBoxToPanel(which, b))}
          />
        ))}
      </div>
    </div>
  );
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
  estate: "border-sky-900/40 bg-sky-950/30 text-sky-100",
  tax: "border-rose-900/40 bg-rose-950/30 text-rose-100",
  recipient: "border-emerald-900/40 bg-emerald-950/30 text-emerald-100",
  neutral: "border-gray-800/60 bg-gray-900/50 text-gray-200",
} as const;

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
      className={`flex min-w-[200px] flex-col items-center rounded-lg border px-4 py-3 text-center transition hover:brightness-125 ${TONE_CLASSES[tone]}`}
    >
      <span className="text-sm font-medium">{title}</span>
      <span className="text-lg font-semibold tabular-nums">
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
  const tone =
    box.kind === "taxes"
      ? "tax"
      : box.kind === "inheritance_spouse"
        ? "estate"
        : "recipient";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${box.label}: ${fmt.format(box.total)}`}
      className={`flex items-baseline justify-between rounded-md border px-3 py-2 text-sm transition hover:brightness-125 ${TONE_CLASSES[tone]}`}
    >
      <span>{box.label}</span>
      <span className="tabular-nums">{fmt.format(box.total)}</span>
    </button>
  );
}

function HeirBoxButton({
  heir,
  onClick,
}: {
  heir: HeirBox;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${heir.recipientLabel}: ${fmt.format(heir.total)}`}
      className="flex min-w-[220px] flex-col rounded-lg border border-emerald-900/40 bg-emerald-950/20 px-4 py-3 text-emerald-100 transition hover:brightness-125"
    >
      <span className="text-sm font-semibold">{heir.recipientLabel}</span>
      <Row label="Outright" amount={heir.outright} />
      <Row label="In Trust" amount={heir.inTrust} />
      <div className="my-1 border-t border-emerald-900/40" />
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
