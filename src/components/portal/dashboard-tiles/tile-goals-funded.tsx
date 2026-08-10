"use client";
import type { ReactElement } from "react";
import { fmtUsd } from "@/lib/portal/format";
import type { PortalDashboardDTO } from "@/lib/portal/load-dashboard";
import type { PortalGoalFunding } from "@/lib/portal/contracts";
import { TileFrame } from "./tile-frame";

/** Fully funded reads green; a real gap reads critical; anything short of
 *  fully funded but close reads as a warning rather than a failure. */
function toneOf(pct: number): { bar: string; text: string } {
  if (pct >= 0.995) return { bar: "bg-good", text: "text-good" };
  if (pct >= 0.9) return { bar: "bg-warn", text: "text-warn" };
  return { bar: "bg-crit", text: "text-crit" };
}

function yearRange(goal: PortalGoalFunding): string | null {
  if (goal.startYear == null) return null;
  if (goal.endYear == null || goal.endYear === goal.startYear) return `${goal.startYear}`;
  return `${goal.startYear}–${goal.endYear}`;
}

function GoalRow({ goal }: { goal: PortalGoalFunding }): ReactElement {
  const tone = toneOf(goal.pctFunded);
  const years = yearRange(goal);
  const gap = Math.max(0, goal.cost - goal.funded);
  return (
    <li>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-[13px] text-ink-2">
          {goal.label}
          {goal.forName && <span className="text-ink-3"> · for {goal.forName}</span>}
        </span>
        <span className={`tabular shrink-0 text-[13px] font-semibold ${tone.text}`}>
          {Math.round(goal.pctFunded * 100)}%
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-card-2">
        <div className={`h-full ${tone.bar}`} style={{ width: `${goal.pctFunded * 100}%` }} />
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-3 text-[11px] text-ink-3">
        <span className="tabular">{years ?? ""}</span>
        <span className="tabular">
          {gap > 0
            ? `${fmtUsd(gap)} short of ${fmtUsd(goal.cost)}`
            : `${fmtUsd(goal.cost)} funded`}
        </span>
      </div>
    </li>
  );
}

/**
 * Percent funded per goal, straight off the cash-flow projection. Retirement
 * leads; education and any expense the advisor flagged as a goal follow in the
 * order the plan funds them.
 */
export function TileGoalsFunded({
  goals,
  projected,
}: {
  goals: PortalDashboardDTO["goals"];
  projected: boolean;
}): ReactElement {
  return (
    <TileFrame title="Goals funded" href="/organizer/goals" linkLabel="Goals">
      {!projected ? (
        <p className="text-[13px] text-ink-3">
          Your plan hasn&apos;t been projected yet — funding shows up here once your advisor
          builds it out.
        </p>
      ) : goals.length === 0 ? (
        <p className="text-[13px] text-ink-3">
          No goals on your plan yet. Your advisor adds them as you set them.
        </p>
      ) : (
        <>
          <ul className="space-y-4">
            {goals.map((g) => (
              <GoalRow key={g.id} goal={g} />
            ))}
          </ul>
          {/* Names the metric. The advisor side carries a different "funding"
              number (the solver's liquidity-boundary funding score), so this
              one has to say out loud which question it answers. */}
          <p className="mt-4 border-t border-hair pt-3 text-[11px] text-ink-3">
            The share of each goal&apos;s planned cost your projected cash flow covers.
          </p>
        </>
      )}
    </TileFrame>
  );
}
