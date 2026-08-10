"use client";

import { InlineAmount } from "@/components/forms/inline-amount";
import { PlusIcon } from "@/components/icons";
import { ageForYear } from "@/lib/age-year";
// The same whole-dollar formatter `buildMapGoals` writes its `detail` strings
// with, so the editable line and the static one it replaces cannot render the
// same figure two ways.
import { formatCurrency } from "@/lib/cell-drill/format";
import { claimAgeModeHint } from "@/lib/household-map/goals";
import type {
  GoalKind,
  GoalLifeExpectancy,
  GoalSocialSecurity,
  MapGoal,
} from "@/lib/household-map/goals";
import type { BoardCallbacks, GoalsBoardProps } from "@/lib/household-map/types";

/** Which side of the spine a card sits on. "left"/"right" mirror the accent
 *  border + text alignment; "joint" centres both. */
type GoalCardSide = "left" | "right" | "joint";

/** The read-mode trigger styling both inline editors on this board share — a
 *  dotted underline at the card's 10px detail size, not the `InlineAmount`
 *  default sized for a table's amount column. */
const EDITOR_CLASS =
  "rounded-sm px-1 tabular text-[10px] text-ink-2 underline decoration-dotted underline-offset-2 hover:bg-card-hover hover:text-ink";

/** Border accent colour + section label per goal kind. Colours are raw CSS
 *  custom properties (not Tailwind class names) because they're applied via
 *  inline `style` on the card's accent border, not a static class. */
const KIND_STYLE: Record<GoalKind, { border: string; label: string }> = {
  education: { border: "var(--color-cat-portfolio)", label: "Education" },
  purchase: { border: "var(--color-crit)", label: "Purchase" },
  household: { border: "var(--color-cat-transactions)", label: "Household" },
  retirement: { border: "var(--color-cat-income)", label: "Retirement" },
  // NOT "Plan end". There are now two of these cards — one per person — and only
  // the later of the two is the plan's end. Labelling both "Plan end" is what
  // made the single-card version read as correct for so long.
  life_expectancy: { border: "var(--color-cat-life)", label: "Life expectancy" },
  // `cat-tax`, the one category hue this board had not spent. Not `cat-income`,
  // which retirement already owns — the two milestones sit near each other on
  // the spine and sharing a colour makes them read as one kind of event.
  social_security: { border: "var(--color-cat-tax)", label: "Social Security" },
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
  /**
   * Replaces the static `detail` line with interactive content (the
   * life-expectancy age editor).
   *
   * Only ever set on a card that has NO `onClick`, and that is a hard constraint
   * rather than a convention: a card-level `<button>` may not contain the
   * editor's own `<button>`. Life-expectancy milestones carry `expenseId: null`,
   * so `clickHandlerFor` returns undefined for them and the two can never both
   * be set.
   */
  detailSlot?: React.ReactNode;
}

/**
 * One goal card. Editable goals (expenseId set) render as a button that opens
 * the quick-edit drawer for the underlying expense; life milestones
 * (expenseId null) render as a plain div — with, for the two life-expectancy
 * cards, an inline age editor inside it.
 */
function GoalCard({ goal, side, onClick, detailSlot }: GoalCardProps) {
  const style = KIND_STYLE[goal.kind];
  const className = `rounded-lg bg-card-2 py-2 ${SIDE_LAYOUT[side]}`;
  const body = (
    <>
      <div className="text-[9px] font-bold uppercase tracking-wider text-ink-4">{style.label}</div>
      <div className="text-xs font-medium text-ink">{goal.title}</div>
      {/* Beneficiary. Without it two children's "College" goals render as
          near-identical cards differing only by year, and `sideOf()` attributes
          both to a parent — the data was already on MapGoal, just unrendered. */}
      {goal.forFamilyMemberName ? (
        <div className="mt-0.5 text-[10px] text-ink-3">for {goal.forFamilyMemberName}</div>
      ) : null}
      {detailSlot ??
        (goal.detail ? <div className="mt-0.5 text-[10px] text-ink-3">{goal.detail}</div> : null)}
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
  expenseRows,
  onEditGoalExpense,
  onSaveLifeExpectancy,
  onSaveSocialSecurity,
  onSaveSocialSecurityClaimAge,
  onAddGoal,
}: GoalsBoardProps & BoardCallbacks) {
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

  /**
   * A life milestone (expenseId null) is never editable regardless of
   * `canEdit` — there is no expense behind it to open. Neither is a goal whose
   * expense has no hydration row: that is the same writability test the Cash
   * Flow board applies via `isItemEditable`, and it's the reason a synthesized
   * `source: "policy"` row renders inert instead of as a button whose Save
   * could never land. `handleEditGoalExpense` already refuses to open the
   * drawer for those, so without this check the card would look clickable and
   * silently do nothing. Read straight off `expenseRows` — `isItemEditable`
   * takes a `MapItem` and this board only has `MapGoal`s.
   */
  function clickHandlerFor(g: MapGoal): (() => void) | undefined {
    if (!canEdit || g.expenseId === null) return undefined;
    if (!(g.expenseId in expenseRows)) return undefined;
    return () => onEditGoalExpense?.(g.expenseId!, g.side);
  }

  /** The first name behind a card's owner, for the editors' accessible names. */
  function firstNameFor(owner: "client" | "spouse"): string | undefined {
    return owner === "client" ? people.client.firstName : people.spouse?.firstName;
  }

  /**
   * The life-expectancy card's detail line, with the age as a click-to-edit
   * field.
   *
   * Gated on the writer being present as well as on `canEdit`, matching the Cash
   * Flow board: a board rendered without `onSaveLifeExpectancy` must not show a
   * field that silently discards the edit.
   *
   * `inline-flex` rather than `flex` so the line inherits the card's own text
   * alignment (right of the spine for the client, left for the spouse) instead of
   * needing a per-side justify class.
   */
  function lifeExpectancySlot(
    le: GoalLifeExpectancy,
    onSave: NonNullable<BoardCallbacks["onSaveLifeExpectancy"]>,
    fallbackLabel: string,
  ): React.ReactNode {
    const firstName = firstNameFor(le.owner);
    return (
      <div className="mt-0.5 text-[10px] text-ink-3">
        <span className="inline-flex items-center gap-1 align-middle">
          age
          <InlineAmount
            mode="plain"
            amount={le.age}
            noun="life expectancy"
            label={firstName ?? fallbackLabel}
            onSave={(next) => onSave(le.owner, next)}
            wrapperClassName="relative w-[46px]"
            className={EDITOR_CLASS}
          />
          {/* Says out loud that nobody chose this number — the projection is
              already running to it (the engine's `spouseLifeExpectancy ?? 95`),
              which is precisely why it should not look like a decision. */}
          {le.assumed ? <span className="text-ink-4">· assumed</span> : null}
        </span>
      </div>
    );
  }

  /**
   * The Social Security card's detail line, with BOTH the claim age and the
   * benefit as click-to-edit fields.
   *
   * WHICH benefit figure is editable follows `ss.mode`, and that is the whole
   * design: a `manual_amount` row's benefit IS its `annualAmount`, while a
   * `pia_at_fra` row's is DERIVED from the monthly PIA and the claim age. An
   * annual field on a PIA row would either write a column the engine never reads
   * or silently back-solve over an SSA-statement figure — so the PIA is what the
   * field holds, and the annual it implies sits under it as an estimate.
   *
   * The AGE field holds `claimAgeYears`, not the label: it is the whole age in one
   * number (67.5 = 67y 6mo), so committing it cannot drop a stored months value,
   * while `format` keeps read mode showing the human "67y 6mo". Saving it moves
   * the card to a different year — the claim age is what fixes
   * `ssClaim.firstBenefitYear`.
   *
   * `(FRA)` / `(at retirement)` marks an age that is DERIVED and still tracking a
   * DOB or a retirement age. Editing it converts the row to an explicit age and
   * ends that tracking (see `ssClaimAgePatch`), so the card has to say which it
   * is before the click, not after.
   */
  function socialSecuritySlot(
    ss: GoalSocialSecurity,
    onSave: NonNullable<BoardCallbacks["onSaveSocialSecurity"]>,
    onSaveClaimAge: NonNullable<BoardCallbacks["onSaveSocialSecurityClaimAge"]>,
  ): React.ReactNode {
    const firstName = firstNameFor(ss.owner);
    const pia = ss.mode === "pia_at_fra";
    const modeHint = claimAgeModeHint(ss.claimAgeMode);
    return (
      <div className="mt-0.5 text-[10px] text-ink-3">
        <span className="inline-flex items-center gap-1 align-middle">
          age
          <InlineAmount
            mode="plain"
            amount={ss.claimAgeYears}
            // Read mode shows the label ("67", "67y 6mo"); the open input shows
            // the raw 67.5. Without this a part-year age would render as "67.5"
            // on the card, which is not how anyone says an age.
            format={() => ss.claimAgeLabel}
            noun="claim age"
            label={firstName ?? ss.owner}
            onSave={(next) => onSaveClaimAge(ss, next)}
            wrapperClassName="relative w-[46px]"
            className={EDITOR_CLASS}
          />
          {modeHint ? <span className="text-ink-4">({modeHint})</span> : null}
          <span>·</span>
          <InlineAmount
            amount={ss.amount}
            noun={pia ? "monthly PIA" : "annual benefit"}
            label={firstName ?? ss.owner}
            onSave={(next) => onSave(ss, next)}
            wrapperClassName="relative w-[76px]"
            className={EDITOR_CLASS}
          />
          {pia ? "/mo PIA" : "/yr"}
        </span>
        {/* Own retirement only — no spousal or survivor top-up — so it says
            "est." wherever it renders. */}
        {ss.estimatedAnnual != null ? (
          <div className="text-ink-4">est. {formatCurrency(ss.estimatedAnnual)}/yr</div>
        ) : null}
      </div>
    );
  }

  /**
   * Replaces a milestone card's static `detail` line with its editor, or
   * undefined for a card with neither payload — and for one whose viewer may not
   * write, or whose board was handed no writer for that payload. `GoalCard` then
   * falls back to `detail`, which carries the same figures as static text, so
   * losing the editor never loses the number.
   *
   * Gated per payload rather than once, matching the Cash Flow board: a board
   * given one writer and not the other must show exactly the one field it can
   * actually save. The client portal's Organizer passes neither.
   *
   * No card carries both payloads, so the order of these two is arbitrary.
   */
  function detailSlotFor(g: MapGoal): React.ReactNode | undefined {
    // BOTH SS writers required, not either. The two fields on an SS card are one
    // editable unit, and the fallback is not a degraded card — `detail` carries
    // the claim age, its mode and the benefit as static text, so a board handed
    // only one writer loses no FACT by rendering that instead. Offering the one
    // savable field would mean a second render path (and a second "PIA not set"
    // rule) for a configuration nothing in the app has: `household-map-view`
    // passes both, the portal Organizer passes neither.
    if (g.socialSecurity && canEdit && onSaveSocialSecurity && onSaveSocialSecurityClaimAge) {
      return socialSecuritySlot(
        g.socialSecurity,
        onSaveSocialSecurity,
        onSaveSocialSecurityClaimAge,
      );
    }
    if (g.lifeExpectancy && canEdit && onSaveLifeExpectancy) {
      return lifeExpectancySlot(g.lifeExpectancy, onSaveLifeExpectancy, g.title);
    }
    return undefined;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Outside the timeline wrapper below, not inside it: the spine is an
          `inset-y-0` absolute rule, so anything sharing that container gets a
          dashed line drawn straight through it. */}
      {canEdit && onAddGoal && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onAddGoal}
            className="flex items-center gap-1.5 rounded-md border border-hair-2 bg-card-2 px-3 py-1.5 text-[11px] font-medium text-accent transition-colors hover:border-accent hover:bg-accent-wash"
          >
            <PlusIcon width={12} height={12} strokeWidth={2} />
            Add goal
          </button>
        </div>
      )}
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
                  <GoalCard
                    goal={g}
                    side="joint"
                    onClick={clickHandlerFor(g)}
                    detailSlot={detailSlotFor(g)}
                  />
                </div>
              </div>
            );
          }
          // Exactly one side renders the card — `joint` returned above, so `g.side`
          // is client-or-spouse here. Built once rather than twice so the two
          // branches cannot drift, and so `clickHandlerFor`/`detailSlotFor` run
          // once per row instead of once per grid cell.
          const card = (
            <GoalCard
              goal={g}
              side={g.side === "client" ? "left" : "right"}
              onClick={clickHandlerFor(g)}
              detailSlot={detailSlotFor(g)}
            />
          );
          return (
            <div
              key={g.id}
              data-testid={`goal-row-${g.id}`}
              className="mb-1.5 grid grid-cols-[1fr_88px_1fr] items-center"
            >
              {g.side === "client" ? card : <div />}
              <GoalYearLabel year={g.year} ages={agesAt(g.year)} />
              {g.side === "spouse" ? card : <div />}
            </div>
          );
        })}
        {/* Gated on real, expense-backed goals — not on a card count. The three
            life milestones are always present (two for an unmarried household),
            so a count threshold kept telling a household that already has a goal
            how to add one. */}
        {!goals.some((g) => g.expenseId !== null) && (
          <p className="mt-4 text-center text-xs text-ink-4">
            {canEdit && onAddGoal
              ? "No goals yet — add one above, or tick “Show as a goal” on an existing expense."
              : "Tick “Show as a goal” on any expense to add it here."}
          </p>
        )}
      </div>
    </div>
  );
}
