"use client";

import { useMemo, useState } from "react";
import type { ClientData } from "@/engine/types";
import type { ProjectionResult } from "@/engine";
import { InEstateColumn } from "./in-estate-column";
import { OutOfEstateColumn } from "./out-of-estate-column";
import { DeathSpine } from "./spine/death-spine";
import { deriveSpineData } from "./spine/lib/derive-spine-data";
import { treeAsOfYear } from "./lib/tree-as-of-year";
import { AsOfDropdown, type AsOfValue } from "@/components/report-controls/as-of-dropdown";
import { TimePeriodButtons } from "@/components/report-controls/time-period-buttons";

export function CanvasFrame({
  tree,
  withResult,
}: {
  tree: ClientData;
  withResult: ProjectionResult;
}) {
  const todayYear = new Date().getUTCFullYear();
  const planStart = tree.planSettings.planStartYear;
  const planEnd = tree.planSettings.planEndYear;

  const clientBirthYear = parseInt(tree.client.dateOfBirth.slice(0, 4), 10);
  const retirementYear = useMemo(() => {
    const c = clientBirthYear + tree.client.retirementAge;
    if (tree.client.spouseDob && tree.client.spouseRetirementAge != null) {
      const sBirth = parseInt(tree.client.spouseDob.slice(0, 4), 10);
      return Math.max(c, sBirth + tree.client.spouseRetirementAge);
    }
    return c;
  }, [
    clientBirthYear,
    tree.client.retirementAge,
    tree.client.spouseDob,
    tree.client.spouseRetirementAge,
  ]);

  const firstDeathYear = withResult.firstDeathEvent?.year;
  const secondDeathYear = withResult.secondDeathEvent?.year;
  const lastDeathYear = secondDeathYear ?? firstDeathYear;

  const [selectedAsOf, setSelectedAsOf] = useState<AsOfValue>("today");

  const dobs = {
    clientDob: tree.client.dateOfBirth,
    spouseDob: tree.client.spouseDob ?? null,
  };

  // The canvas dropdown lists every projection year so the user can pick any
  // moment in the plan window. We bound to plan start/end to avoid wandering
  // beyond what the projection knows about.
  const dropdownYears = useMemo(() => {
    const out: number[] = [];
    for (let y = planStart; y <= planEnd; y++) out.push(y);
    return out;
  }, [planStart, planEnd]);

  const milestones = [
    { year: retirementYear, label: "Retirement" },
    ...(firstDeathYear != null ? [{ year: firstDeathYear, label: "First Death" }] : []),
    ...(secondDeathYear != null ? [{ year: secondDeathYear, label: "Last Death" }] : []),
  ];

  const isSplit = selectedAsOf === "split";
  const splitAvailable =
    !!tree.client.spouseDob && firstDeathYear != null && secondDeathYear != null;

  // Resolve a single asOfYear for each column. In split mode, in-estate looks at
  // first death (what survivor still holds in their estate) and out-of-estate
  // looks at last death (final distribution). For non-split modes, both columns
  // use the same year.
  const resolvedYear = (() => {
    if (selectedAsOf === "today") return todayYear;
    if (selectedAsOf === "split") return todayYear; // unused; columns split below
    return selectedAsOf;
  })();

  const inEstateYear = isSplit ? (firstDeathYear ?? todayYear) : resolvedYear;
  const outOfEstateYear = isSplit ? (lastDeathYear ?? todayYear) : resolvedYear;

  // The spine's PairRow + TODAY tick reflect the selected as-of year so net
  // worth in the middle column matches the left/right columns. Split mode
  // keeps the spine anchored at planStartYear.
  const spinePairRowYear = isSplit ? tree.planSettings.planStartYear : resolvedYear;

  const spineData = useMemo(
    () => deriveSpineData({ tree, withResult, pairRowYear: spinePairRowYear }),
    [tree, withResult, spinePairRowYear],
  );

  const inEstateTree = useMemo(
    () => treeAsOfYear(tree, withResult, inEstateYear),
    [tree, withResult, inEstateYear],
  );
  const outOfEstateTree = useMemo(
    () => treeAsOfYear(tree, withResult, outOfEstateYear),
    [tree, withResult, outOfEstateYear],
  );

  return (
    <div className="mx-auto max-w-[1440px] px-6 py-8">
      <header className="mb-6">
        <div className="text-[10.5px] uppercase tracking-[0.14em] text-[var(--color-ink-3)]">§01 · Canvas</div>
        <h1 className="mt-1 text-[22px] font-semibold text-[var(--color-ink)]">Estate Planning</h1>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <TimePeriodButtons
          selected={selectedAsOf}
          onChange={setSelectedAsOf}
          todayYear={todayYear}
          retirementYear={retirementYear}
          firstDeathYear={firstDeathYear}
          lastDeathYear={lastDeathYear}
          showSplit={splitAvailable}
        />
        <label className="flex items-center gap-2 text-xs uppercase tracking-[0.14em] text-[var(--color-ink-3)]">
          As of
          <AsOfDropdown
            years={dropdownYears}
            todayYear={todayYear}
            selected={selectedAsOf}
            onChange={setSelectedAsOf}
            dobs={dobs}
            milestones={milestones}
            allowSplit={splitAvailable}
            yearPrefix=""
          />
        </label>
      </div>

      {isSplit && (
        <p className="mb-3 text-[11px] text-[var(--color-ink-3)]">
          Split death · In Estate at first death ({firstDeathYear}) · Out of Estate at last death ({lastDeathYear}).
        </p>
      )}

      <div className="grid grid-cols-[320px_1fr_360px] gap-0 rounded-[10px] border border-[var(--color-hair)] bg-[var(--color-card)]">
        <div className="border-r border-[var(--color-hair)]">
          <InEstateColumn tree={inEstateTree} asOfYear={inEstateYear} />
        </div>
        <div className="min-h-[480px]">
          <DeathSpine data={spineData} />
        </div>
        <div className="border-l border-[var(--color-hair)]">
          <OutOfEstateColumn tree={outOfEstateTree} asOfYear={outOfEstateYear} />
        </div>
      </div>
    </div>
  );
}
