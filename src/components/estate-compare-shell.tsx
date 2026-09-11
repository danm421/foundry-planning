"use client";

// Side-by-side scenario compare for the three estate reports (Estate Tax,
// State Death Tax, Transfer Detail). The shell owns the URL contract, the
// scenario pickers, ONE shared As-of / death-order control row, and the column
// layout. Each column's report view arrives as a render prop.
//
// The shared as-of is stored SEMANTICALLY (`CompareAsOf`), never as a bare
// year. Both controls hand back the year they happen to display, and that year
// is always the LEFT column's: storing it would pin both columns to the left
// column's death year, so a scenario that moves a death year would print the
// wrong year on the right. Every number a control reports is therefore mapped
// back to the milestone it came from before it is stored, and each column
// resolves that milestone against its OWN projection years.

import { useCallback, useState, type ReactElement, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  BASE_REF,
  readCompareSelection,
  refLabel,
  resolveCompareAsOf,
  type ColumnYears,
  type CompareAsOf,
} from "@/lib/estate/compare-ref";
import {
  ScenarioPickerDropdown,
  type ScenarioOption,
} from "./scenario/scenario-picker-dropdown";
import { AsOfDropdown, type AsOfValue } from "./report-controls/as-of-dropdown";
import { TimePeriodButtons } from "./report-controls/time-period-buttons";
import { DeathOrderToggle } from "./report-controls/death-order-toggle";
import type { OwnerDobs } from "./report-controls/age-helpers";

type Ordering = "primaryFirst" | "spouseFirst";

export interface EstateColumnMeta {
  years: number[];
  todayYear: number;
  firstDeathYear: number | null;
  secondDeathYear: number | null;
}

export interface EstateColumnReady<TData> {
  meta: EstateColumnMeta;
  data: TData | null;
}

export interface EstateCompareColumnArgs<TData> {
  side: "left" | "right";
  scenarioRef: string;
  /** Already resolved against THIS column's own projection years. */
  asOf: AsOfValue;
  ordering: Ordering;
  onReady: (ready: EstateColumnReady<TData>) => void;
  /** The left column's data. Always null on the left; null on the right until the left loads. */
  baseline: TData | null;
}

const TODAY: CompareAsOf = { kind: "today" };

const SNAPSHOT_NOTICE = "Snapshots can't be compared on this report yet.";
const DELETED_NOTICE = "That scenario no longer exists.";

/** Matches `AsOfDropdown`'s own control styling so the bar reads as one row. */
const PICKER_CLASS =
  "rounded border border-hair bg-paper px-3 py-1.5 text-sm text-ink focus:border-accent focus:outline-none";
const BAR_BUTTON_CLASS =
  "ml-auto rounded border border-hair-2 px-2.5 py-1 text-xs font-medium text-ink-2 transition-colors hover:border-accent hover:text-accent";

function columnYears(meta: EstateColumnMeta, retirementYear: number): ColumnYears {
  return {
    todayYear: meta.todayYear,
    retirementYear,
    firstDeathYear: meta.firstDeathYear,
    secondDeathYear: meta.secondDeathYear,
  };
}

/**
 * Map a control's reported value back to the advisor's semantic choice. A bare
 * year that matches one of the left column's milestone years IS that milestone
 * — both the dropdown's milestone options and the pill row's Retirement /
 * First Death / Last Death buttons carry the year as their value. Degenerate
 * ties (a retirement year that is also a death year) take the first match.
 */
function toCompareAsOf(value: AsOfValue, years: ColumnYears | null): CompareAsOf {
  if (value === "today") return TODAY;
  if (value === "split") return { kind: "split" };
  if (years) {
    if (value === years.retirementYear) {
      return { kind: "milestone", milestone: "retirement" };
    }
    if (value === years.firstDeathYear) {
      return { kind: "milestone", milestone: "firstDeath" };
    }
    if (value === years.secondDeathYear) {
      return { kind: "milestone", milestone: "lastDeath" };
    }
  }
  return { kind: "year", year: value };
}

/**
 * A column re-reports whenever it re-renders. Storing a fresh object identity
 * for an unchanged reading would re-render the column, which would report
 * again — so compare by content and keep the old object when nothing moved.
 */
function sameMeta(a: EstateColumnMeta | null, b: EstateColumnMeta): boolean {
  return (
    a !== null &&
    a.todayYear === b.todayYear &&
    a.firstDeathYear === b.firstDeathYear &&
    a.secondDeathYear === b.secondDeathYear &&
    a.years.length === b.years.length &&
    a.years.every((year, i) => year === b.years[i])
  );
}

function columnAsOfLabel(asOf: AsOfValue, meta: EstateColumnMeta | null): string {
  if (asOf === "split") return "Split death";
  if (asOf === "today") return meta ? `Today · ${meta.todayYear}` : "Today";
  return String(asOf);
}

export function EstateCompareShell<TData>({
  scenarios,
  isMarried,
  ownerNames,
  ownerDobs,
  retirementYear,
  initialAsOf,
  children,
}: {
  /** Part of the column contract: the views fetch with it. The shell itself
   *  routes off `usePathname()`, so it never reads this. */
  clientId: string;
  scenarios: ScenarioOption[];
  isMarried: boolean;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: OwnerDobs;
  retirementYear: number;
  /** Test seam and deep-link hook; defaults to `{ kind: "today" }`. */
  initialAsOf?: CompareAsOf;
  children: (args: EstateCompareColumnArgs<TData>) => ReactNode;
}): ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [sharedAsOf, setSharedAsOf] = useState<CompareAsOf>(initialAsOf ?? TODAY);
  const [ordering, setOrdering] = useState<Ordering>("primaryFirst");
  const [leftMeta, setLeftMeta] = useState<EstateColumnMeta | null>(null);
  const [leftData, setLeftData] = useState<TData | null>(null);
  const [rightMeta, setRightMeta] = useState<EstateColumnMeta | null>(null);

  // Stable per side: each column calls `onReady` from an effect that lists it
  // as a dependency, so a fresh identity every render would never settle.
  const onLeftReady = useCallback((ready: EstateColumnReady<TData>) => {
    setLeftMeta((prev) => (sameMeta(prev, ready.meta) ? prev : ready.meta));
    setLeftData(ready.data);
  }, []);
  const onRightReady = useCallback((ready: EstateColumnReady<TData>) => {
    setRightMeta((prev) => (sameMeta(prev, ready.meta) ? prev : ready.meta));
  }, []);

  const selection = readCompareSelection(searchParams);

  // A ref shared before the scenario was deleted must never reach a column —
  // it would fetch a dead id. `refLabel`'s "Unknown scenario" is display copy,
  // not a validity check.
  const rightExists =
    selection.right !== null &&
    (selection.right === BASE_REF ||
      scenarios.some((s) => s.id === selection.right));
  const rightRef = rightExists ? selection.right : null;
  const notice = selection.unsupportedRight
    ? SNAPSHOT_NOTICE
    : selection.right !== null && !rightExists
      ? DELETED_NOTICE
      : null;

  const leftYears = leftMeta ? columnYears(leftMeta, retirementYear) : null;
  const resolvedFor = (meta: EstateColumnMeta | null): AsOfValue =>
    meta ? resolveCompareAsOf(sharedAsOf, columnYears(meta, retirementYear)) : "today";
  // Both controls compare their pills/options by year, so they need the left
  // column's resolved year to highlight the active one.
  const controlAsOf = resolvedFor(leftMeta);

  // The ONLY place a control's value becomes shared state — both controls go
  // through the same remap, so neither can smuggle in a bare year.
  const chooseAsOf = (value: AsOfValue) =>
    setSharedAsOf(toCompareAsOf(value, leftYears));

  const canSplit =
    isMarried &&
    leftMeta?.firstDeathYear != null &&
    leftMeta?.secondDeathYear != null;

  const milestones = leftMeta
    ? [
        { year: retirementYear, label: "Retirement" },
        ...(leftMeta.firstDeathYear != null
          ? [{ year: leftMeta.firstDeathYear, label: "First Death" }]
          : []),
        ...(leftMeta.secondDeathYear != null
          ? [{ year: leftMeta.secondDeathYear, label: "Last Death" }]
          : []),
      ]
    : [];

  function writeParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams?.toString() ?? "");
    if (value === null) next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  const firstCompareRef =
    [BASE_REF, ...scenarios.filter((s) => !s.isBaseCase).map((s) => s.id)].find(
      (ref) => ref !== selection.left,
    ) ?? null;

  function renderColumn(side: "left" | "right", scenarioRef: string): ReactNode {
    const meta = side === "left" ? leftMeta : rightMeta;
    const asOf = resolvedFor(meta);
    return (
      <section className="min-w-0 space-y-3">
        {rightRef !== null && (
          <header className="flex items-baseline justify-between gap-3 border-b border-hair pb-2">
            <h2 className="truncate text-[13px] font-medium text-ink">
              {refLabel(scenarioRef, scenarios)}
            </h2>
            <span className="tabular shrink-0 text-[11px] text-ink-3">
              {columnAsOfLabel(asOf, meta)}
            </span>
          </header>
        )}
        {children({
          side,
          scenarioRef,
          asOf,
          ordering,
          onReady: side === "left" ? onLeftReady : onRightReady,
          // Deltas read right − left, so the left column never gets a baseline.
          baseline: side === "left" ? null : leftData,
        })}
      </section>
    );
  }

  const left = renderColumn("left", selection.left);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded border border-hair bg-card px-3 py-2">
        {rightRef !== null ? (
          <>
            <span className="chip">Comparing</span>
            <ScenarioPickerDropdown
              value={selection.left}
              onChange={(next) => writeParam("scenario", next)}
              scenarios={scenarios}
              snapshots={[]}
              ariaLabel="Left scenario"
              className={PICKER_CLASS}
            />
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">vs</span>
            <ScenarioPickerDropdown
              value={rightRef}
              onChange={(next) => writeParam("compare", next)}
              scenarios={scenarios}
              snapshots={[]}
              ariaLabel="Right scenario"
              className={PICKER_CLASS}
            />
            <button
              type="button"
              onClick={() => writeParam("compare", null)}
              className={BAR_BUTTON_CLASS}
            >
              Stop comparing
            </button>
          </>
        ) : (
          <>
            <span className="chip">Scenario</span>
            <span className="text-[13px] text-ink">
              {refLabel(selection.left, scenarios)}
            </span>
            {firstCompareRef !== null && (
              <button
                type="button"
                onClick={() => writeParam("compare", firstCompareRef)}
                className={BAR_BUTTON_CLASS}
              >
                Compare to…
              </button>
            )}
          </>
        )}
      </div>

      {notice !== null && (
        <p className="rounded border border-hair bg-card px-3 py-2 text-[13px] text-ink-2">
          {notice}
        </p>
      )}

      {/* Reserved before the left column reports, so the page does not jump. */}
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        {leftMeta && (
          <>
            <TimePeriodButtons
              selected={controlAsOf}
              onChange={chooseAsOf}
              todayYear={leftMeta.todayYear}
              retirementYear={retirementYear}
              firstDeathYear={leftMeta.firstDeathYear ?? undefined}
              lastDeathYear={
                leftMeta.secondDeathYear ?? leftMeta.firstDeathYear ?? undefined
              }
              showSplit={canSplit}
            />
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs uppercase tracking-wide text-ink-3">
                As of
                <AsOfDropdown
                  years={leftMeta.years}
                  todayYear={leftMeta.todayYear}
                  selected={controlAsOf}
                  onChange={chooseAsOf}
                  dobs={ownerDobs}
                  milestones={milestones}
                  allowSplit={canSplit}
                  yearPrefix="Both die in"
                />
              </label>
              {isMarried && sharedAsOf.kind !== "split" && (
                <DeathOrderToggle
                  value={ordering}
                  onChange={setOrdering}
                  ownerNames={ownerNames}
                />
              )}
            </div>
          </>
        )}
      </div>

      {rightRef !== null ? (
        <div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
          <div className="min-w-0">{left}</div>
          <div className="min-w-0 md:border-l md:border-hair md:pl-8">
            {renderColumn("right", rightRef)}
          </div>
        </div>
      ) : (
        <div className="md:w-1/2">{left}</div>
      )}
    </div>
  );
}
