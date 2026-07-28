import { ageForYear } from "@/lib/age-year";
import type { GoalKind, MapGoal } from "@/lib/household-map/goals";
import type { BoardCallbacks, HouseholdMapProps } from "@/lib/household-map/types";

/** Which side of the spine a card sits on. "left"/"right" mirror the accent
 *  border + text alignment; "joint" centres both. */
type GoalCardSide = "left" | "right" | "joint";

/** Border accent colour + section label per goal kind. Colours are raw CSS
 *  custom properties (not Tailwind class names) because they're applied via
 *  inline `style` on the card's accent border, not a static class. */
const KIND_STYLE: Record<GoalKind, { border: string; label: string }> = {
  education: { border: "var(--color-cat-portfolio)", label: "Education" },
  purchase: { border: "var(--color-crit)", label: "Purchase" },
  household: { border: "var(--color-cat-transactions)", label: "Household" },
  retirement: { border: "var(--color-cat-income)", label: "Retirement" },
  plan_end: { border: "var(--color-cat-life)", label: "Plan end" },
};

/** Accent-border side + text alignment per card side. Each value is a
 *  complete static class-string literal (required for Tailwind's JIT scanner
 *  to see it — interpolating pieces of these would produce no CSS). */
const SIDE_LAYOUT: Record<GoalCardSide, string> = {
  left: "border-r-2 pr-3 text-right",
  right: "border-l-2 pl-3 text-left",
  joint: "border-2 px-3 text-center",
};

interface GoalCardProps {
  goal: MapGoal;
  side: GoalCardSide;
  /** Set only when the card is editable — a life milestone (expenseId null)
   *  or a read-only viewer never gets one. */
  onClick?: () => void;
}

/**
 * One goal card. Editable goals (expenseId set) render as a button that opens
 * the quick-edit drawer for the underlying expense; life milestones
 * (expenseId null) render as a plain, non-interactive div — there is nothing
 * to edit.
 */
function GoalCard({ goal, side, onClick }: GoalCardProps) {
  const style = KIND_STYLE[goal.kind];
  const className = `rounded-lg bg-card-2 py-2 ${SIDE_LAYOUT[side]}`;
  const body = (
    <>
      <div className="text-[9px] font-bold uppercase tracking-wider text-ink-4">{style.label}</div>
      <div className="text-xs font-medium text-ink">{goal.title}</div>
      {goal.detail ? <div className="mt-0.5 text-[10px] text-ink-3">{goal.detail}</div> : null}
    </>
  );

  if (!onClick) {
    return (
      <div data-testid={`goal-card-${side}-${goal.id}`} style={{ borderColor: style.border }} className={className}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-testid={`goal-card-${side}-${goal.id}`}
      style={{ borderColor: style.border }}
      onClick={onClick}
      className={`${className} w-full hover:bg-card-hover`}
    >
      {body}
    </button>
  );
}

/** The year + ages-at-that-year label centred under/beside a goal's card.
 *  Identical for every row shape (client/spouse grid row or joint straddling
 *  row), so it's rendered from one place rather than copy-pasted twice. */
function GoalYearLabel({ year, ages }: { year: number; ages: string }) {
  return (
    <div className="text-center">
      <b className="block text-xs font-bold text-ink">{year}</b>
      <i className="text-[9px] not-italic text-ink-4">{ages}</i>
    </div>
  );
}

/**
 * The Goals board: a dashed vertical year "spine" with one row per goal.
 * `side === "client"` places the card left of the spine, `"spouse"` right,
 * and `"joint"` renders its own full-width row with the card centred so it
 * visibly straddles the spine (a joint goal has no side to hang off of and
 * must not be silently dropped).
 */
export default function GoalsBoard({
  people,
  goals,
  canEdit,
  onEditGoalExpense,
}: HouseholdMapProps & BoardCallbacks) {
  /** Ages at a given year, derived from each person's `birthYear` — never
   *  from `new Date()` inside this component, which would drift a Jan-1 DOB
   *  by a year across timezones. */
  function agesAt(year: number): string {
    const clientAge = ageForYear(people.client.birthYear, year);
    if (!people.spouse) {
      return clientAge != null ? `${clientAge}` : "";
    }
    const spouseAge = ageForYear(people.spouse.birthYear, year);
    return `${clientAge ?? "—"} / ${spouseAge ?? "—"}`;
  }

  /** A life milestone (expenseId null) is never editable regardless of
   *  `canEdit` — there is no expense behind it to open. */
  function clickHandlerFor(g: MapGoal): (() => void) | undefined {
    if (!canEdit || g.expenseId === null) return undefined;
    return () => onEditGoalExpense?.(g.expenseId!, g.side);
  }

  return (
    <div className="relative py-1">
      <div className="absolute inset-y-0 left-1/2 border-l border-dashed border-hair" />
      {goals.map((g) => {
        if (g.side === "joint") {
          return (
            <div
              key={g.id}
              data-testid={`goal-row-${g.id}`}
              className="mb-1.5 flex flex-col items-center gap-0.5"
            >
              <GoalYearLabel year={g.year} ages={agesAt(g.year)} />
              <div className="w-full max-w-[60%]">
                <GoalCard goal={g} side="joint" onClick={clickHandlerFor(g)} />
              </div>
            </div>
          );
        }
        return (
          <div
            key={g.id}
            data-testid={`goal-row-${g.id}`}
            className="mb-1.5 grid grid-cols-[1fr_88px_1fr] items-center"
          >
            {g.side === "client" ? (
              <GoalCard goal={g} side="left" onClick={clickHandlerFor(g)} />
            ) : (
              <div />
            )}
            <GoalYearLabel year={g.year} ages={agesAt(g.year)} />
            {g.side === "spouse" ? (
              <GoalCard goal={g} side="right" onClick={clickHandlerFor(g)} />
            ) : (
              <div />
            )}
          </div>
        );
      })}
      {goals.length <= 3 && (
        <p className="mt-4 text-center text-xs text-ink-4">
          Tick “Show as a goal” on any expense to add it here.
        </p>
      )}
    </div>
  );
}
