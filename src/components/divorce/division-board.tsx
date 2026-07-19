"use client";

import { memo, useMemo, useState, type ReactNode } from "react";
import {
  allocationKey,
  countDecisionsRemaining,
  type DivisibleObject,
  type DivorceDisposition,
  type DivorceTargetKind,
  type ResolvedAllocation,
} from "@/lib/divorce/allocation-rules";
import type { SideTotals } from "@/lib/divorce/side-totals";
import type { OnAllocate } from "./divorce-workbench";
import { DivisibleCard } from "./divisible-card";
import { SplitDialog } from "./split-dialog";

const compactCurrency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

// Pool section order + headings. Only non-empty sections render — family_member
// and note_receivable appear only if one lands undecided in the pool.
const POOL_SECTIONS: Array<{ kind: DivorceTargetKind; label: string }> = [
  { kind: "account", label: "Accounts" },
  { kind: "income", label: "Incomes" },
  { kind: "expense", label: "Expenses" },
  { kind: "liability", label: "Liabilities" },
  { kind: "note_receivable", label: "Notes receivable" },
  { kind: "entity", label: "Entities & trusts" },
  { kind: "family_member", label: "Family" },
];

/** One placed card, with everything the DivisibleCard needs to render it in a
 *  specific column (a split/duplicate object is placed in both side columns). */
interface Placed {
  obj: DivisibleObject;
  disposition: DivorceDisposition;
  splitPercentToSpouse: number | null;
  side: "primary" | "spouse" | "pool";
  interactive: boolean;
  ghost?: boolean;
  needsDecision?: boolean;
  childObjects?: DivisibleObject[];
}

export interface AllocationBoardProps {
  objects: DivisibleObject[];
  resolved: Map<string, ResolvedAllocation>;
  totals: { primary: SideTotals; spouse: SideTotals };
  people: { primaryName: string; spouseName: string };
  onAllocate: OnAllocate;
}

// Memoized: `objects`/`resolved`/`totals`/`people`/`onAllocate` are all
// reference-stable across a settings-only update (the debounced settings
// PATCH reconciles only `plan`), so this skips re-rendering the whole board
// — potentially many cards — on every keystroke in the settings rail.
export const AllocationBoard = memo(function AllocationBoard({
  objects,
  resolved,
  totals,
  people,
  onAllocate,
}: AllocationBoardProps) {
  const [splitFor, setSplitFor] = useState<DivisibleObject | null>(null);

  const { primary, spouse, poolByKind, decisionsRemaining } = useMemo(() => {
    const objectById = new Map(objects.map((o) => [o.id, o]));
    const primaryCards: Placed[] = [];
    const spouseCards: Placed[] = [];
    const pool = new Map<DivorceTargetKind, Placed[]>();

    const addPool = (p: Placed) => {
      const list = pool.get(p.obj.kind) ?? [];
      list.push(p);
      pool.set(p.obj.kind, list);
    };

    for (const obj of objects) {
      if (obj.entityOwnedById) continue; // follows its entity — rendered nested
      const alloc = resolved.get(allocationKey(obj.kind, obj.id));
      if (!alloc) continue;

      const childObjects =
        obj.kind === "entity"
          ? obj.childIds
              .map((id) => objectById.get(id))
              .filter((c): c is DivisibleObject => c != null)
          : undefined;

      if (alloc.needsDecision) {
        addPool({
          obj,
          disposition: alloc.disposition,
          splitPercentToSpouse: alloc.splitPercentToSpouse,
          side: "pool",
          interactive: true,
          needsDecision: true,
          childObjects,
        });
        continue;
      }

      const pct = alloc.splitPercentToSpouse;
      switch (alloc.disposition) {
        case "primary":
          primaryCards.push({
            obj,
            disposition: "primary",
            splitPercentToSpouse: null,
            side: "primary",
            interactive: true,
            childObjects,
          });
          break;
        case "spouse":
          spouseCards.push({
            obj,
            disposition: "spouse",
            splitPercentToSpouse: null,
            side: "spouse",
            interactive: true,
            childObjects,
          });
          break;
        case "split":
          primaryCards.push({
            obj,
            disposition: "split",
            splitPercentToSpouse: pct,
            side: "primary",
            interactive: true,
            childObjects,
          });
          spouseCards.push({
            obj,
            disposition: "split",
            splitPercentToSpouse: pct,
            side: "spouse",
            interactive: false,
            childObjects,
          });
          break;
        case "duplicate":
          primaryCards.push({
            obj,
            disposition: "duplicate",
            splitPercentToSpouse: null,
            side: "primary",
            interactive: true,
            childObjects,
          });
          spouseCards.push({
            obj,
            disposition: "duplicate",
            splitPercentToSpouse: null,
            side: "spouse",
            interactive: false,
            ghost: true,
            childObjects,
          });
          break;
      }
    }

    return {
      primary: primaryCards,
      spouse: spouseCards,
      poolByKind: pool,
      decisionsRemaining: countDecisionsRemaining(resolved),
    };
  }, [objects, resolved]);

  const onOpenSplit = (obj: DivisibleObject) => setSplitFor(obj);
  const splitSeed = splitFor
    ? (resolved.get(allocationKey(splitFor.kind, splitFor.id))?.splitPercentToSpouse ?? 50)
    : 50;

  const renderCard = (p: Placed) => (
    <DivisibleCard
      key={allocationKey(p.obj.kind, p.obj.id)}
      obj={p.obj}
      disposition={p.disposition}
      splitPercentToSpouse={p.splitPercentToSpouse}
      side={p.side}
      interactive={p.interactive}
      ghost={p.ghost}
      needsDecision={p.needsDecision}
      childObjects={p.childObjects}
      people={people}
      onAllocate={onAllocate}
      onOpenSplit={onOpenSplit}
    />
  );

  return (
    <div className="mt-6 grid min-h-0 grid-cols-1 gap-4 lg:grid-cols-3 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]">
      {/* Primary side */}
      <SideColumn name={people.primaryName || "Primary"} totals={totals.primary}>
        {primary.length === 0 ? (
          <EmptyHint text="Nothing assigned here yet." />
        ) : (
          primary.map(renderCard)
        )}
      </SideColumn>

      {/* Pool — objects still needing a decision, grouped by kind */}
      <section
        aria-label="To divide"
        className="flex min-h-0 flex-col rounded-[var(--radius)] border border-hair bg-card-2 lg:overflow-hidden"
      >
        <header className="sticky top-0 z-20 shrink-0 rounded-t-[var(--radius)] border-b border-hair bg-card-2 px-4 py-3">
          <div className="text-[14px] font-semibold text-ink">To divide</div>
          <p className="mt-1 text-[12px] text-ink-3">
            {decisionsRemaining === 0 ? (
              "All decisions made"
            ) : (
              <>
                <span className="tabular text-warn">{decisionsRemaining}</span>{" "}
                {decisionsRemaining === 1 ? "decision" : "decisions"} remaining
              </>
            )}
          </p>
        </header>
        <div className="flex flex-col gap-4 p-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          {decisionsRemaining === 0 ? (
            <EmptyHint text="Every object is assigned. Review each side, then commit." />
          ) : (
            POOL_SECTIONS.map((sec) => {
              const cards = poolByKind.get(sec.kind);
              if (!cards || cards.length === 0) return null;
              return (
                <div key={sec.kind}>
                  <h3 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-4">
                    {sec.label}
                  </h3>
                  <div className="flex flex-col gap-3">{cards.map(renderCard)}</div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Spouse side */}
      <SideColumn name={people.spouseName || "Spouse"} totals={totals.spouse}>
        {spouse.length === 0 ? (
          <EmptyHint text="Nothing assigned here yet." />
        ) : (
          spouse.map(renderCard)
        )}
      </SideColumn>

      <SplitDialog
        key={splitFor?.id ?? "closed"}
        open={splitFor != null}
        obj={splitFor}
        initialPercentToSpouse={splitSeed}
        people={people}
        onOpenChange={(o) => {
          if (!o) setSplitFor(null);
        }}
        onConfirm={(pct) => {
          if (splitFor) onAllocate(splitFor.kind, splitFor.id, "split", pct);
          setSplitFor(null);
        }}
      />
    </div>
  );
});

/** A person column: sticky header (name + live per-side totals) over its cards. */
function SideColumn({
  name,
  totals,
  children,
}: {
  name: string;
  totals: SideTotals;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={name}
      className="flex min-h-0 flex-col rounded-[var(--radius)] border border-hair bg-card-2 lg:overflow-hidden"
    >
      <header className="sticky top-0 z-20 shrink-0 rounded-t-[var(--radius)] border-b border-hair bg-card-2 px-4 py-3">
        <div className="truncate text-[14px] font-semibold text-ink">{name}</div>
        <dl className="mt-2 grid grid-cols-3 gap-2">
          <TotalStat label="Net worth" value={totals.netWorth} />
          <TotalStat label="Income" value={totals.annualIncome} />
          <TotalStat label="Expenses" value={totals.annualExpenses} />
        </dl>
      </header>
      <div className="flex flex-col gap-3 p-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
        {children}
      </div>
    </section>
  );
}

function TotalStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-[10px] uppercase tracking-wide text-ink-4">{label}</dt>
      <dd className="tabular text-[13px] text-ink-2">{compactCurrency.format(value)}</dd>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <p className="rounded-[var(--radius-sm)] border border-dashed border-hair px-3 py-6 text-center text-[12px] text-ink-4">
      {text}
    </p>
  );
}
