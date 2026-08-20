"use client";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { CurrencyInput } from "@/components/portal/currency-input";
import { portalTabColors } from "@/components/portal/portal-tab-strip";
import { SavingsGoalChart } from "@/components/portal/savings-goal-chart";
import { fmtUsd, fmtMonthLabel } from "@/lib/portal/format";
import { monthLabel } from "@/lib/calculators/debt-paydown";
import {
  monthsToJanuary,
  projectSavings,
  solveMonthlyForGoal,
  MAX_SAVINGS_MONTHS,
} from "@/lib/calculators/savings-goal";
import {
  validateSavingsGoalState,
  MAX_NAME_LENGTH,
  type SavingsGoalState,
} from "@/lib/calculators/savings-goal-state";
import { SAVINGS_GOAL_KEY, type SavingsGoalDTO } from "@/lib/portal/load-savings-goal";

/** One click seeds a name AND a horizon — the whole "minimize clicking" answer. */
const PRESETS: { label: string; years: number }[] = [
  { label: "Home down payment", years: 5 },
  { label: "College", years: 10 },
  { label: "Car", years: 3 },
  { label: "Wedding", years: 2 },
  { label: "Travel", years: 2 },
];

/** Printed on the chip, so the assumption is never hidden behind a word. */
const RETURNS: { label: string; rate: number; help: string }[] = [
  {
    label: "Conservative",
    rate: 0.04,
    help: "Mostly bonds and cash. Steadier, and it grows more slowly.",
  },
  {
    label: "Moderate",
    rate: 0.06,
    help: "A mix of shares and bonds — the middle of the road.",
  },
  {
    label: "Growth",
    rate: 0.08,
    help: "Mostly shares. More growth over long stretches, and a bumpier ride.",
  },
];

const SAVE_FAILED_NOTE =
  "We couldn’t save your setup just now — the numbers above still work.";

/** Blank or unparseable → 0, matching how a cleared field means "no figure
 * yet" rather than a validation error while the client is mid-edit. */
function parseAmount(raw: string): number {
  const n = Number(raw);
  return raw.trim() === "" || !Number.isFinite(n) ? 0 : n;
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="card p-5">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{label}</div>
      <div className="tabular mt-1.5 text-[22px] font-semibold text-ink">{value}</div>
    </div>
  );
}

/**
 * The savings goal calculator.
 *
 * The answer sits at the top and the inputs below it, and everything
 * recomputes in this component — the projector is pure and finishes in well
 * under a millisecond, so there is no round trip between changing a number and
 * seeing the result. The only network call is a debounced save of the client's
 * setup; a failed save shows a quiet note and never stops the maths.
 */
export function SavingsGoalWorkspace({
  dto,
  readOnly = false,
}: {
  dto: SavingsGoalDTO;
  /** The advisor preview: the numbers still run, but nothing is persisted —
   * `requireClientPortalAccess` 403s any session carrying an org, so an
   * advisor previewing would otherwise see every keystroke paint a failed
   * save. */
  readOnly?: boolean;
}): ReactElement {
  const [state, setState] = useState<SavingsGoalState>(dto.state);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const firstRender = useRef(true);

  // The RAW strings behind the three amount fields, kept separate from the
  // parsed numbers in `state`. A controlled input whose `value` is re-derived
  // from a parsed number loses whatever the number can't spell while it's
  // being typed: type "5", then ".", and the "." vanishes on the next render
  // so the next digit appends onto the integer. These strings ARE what the
  // inputs display; `state` is what the maths and the save use, and both are
  // written on the same keystroke so they never disagree about the VALUE.
  const [costRaw, setCostRaw] = useState(() => String(dto.state.targetToday));
  const [savedRaw, setSavedRaw] = useState(() => String(dto.state.currentSavings));
  const [pmtRaw, setPmtRaw] = useState(() => String(dto.state.monthlyContribution));

  const now = useMemo(() => new Date(), []);
  const startYear = now.getFullYear();
  const startMonth = now.getMonth() + 1;

  // Years the projector can actually answer for. The list reaches BACK to the
  // saved year so a goal set on an earlier visit still shows its own date
  // instead of reading blank while the stale year sits underneath it.
  const firstYear = Math.min(state.targetYear, startYear);
  const years = useMemo(
    () =>
      Array.from(
        { length: startYear - firstYear + Math.floor(MAX_SAVINGS_MONTHS / 12) + 1 },
        (_, i) => firstYear + i,
      ),
    [firstYear, startYear],
  );

  function patch(next: Partial<SavingsGoalState>): void {
    setState((s) => ({ ...s, ...next }));
  }

  // Pure function of `state` — computed during render, not stored via an
  // effect, so a keystroke that makes the state invalid shows the validator's
  // own message the instant it happens.
  const validation = useMemo(() => validateSavingsGoalState(state), [state]);

  // Debounced save. Skips the first render so simply opening the page does not
  // write a row, and skips entirely while the state fails the SAME validation
  // the route judges the PUT by.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (readOnly || !validation.ok) return;

    const t = setTimeout(() => {
      void fetch(`/api/portal/calculators/${SAVINGS_GOAL_KEY}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: validation.state }),
      })
        .then((r) => setSaveNote(r.ok ? null : SAVE_FAILED_NOTE))
        .catch(() => setSaveNote(SAVE_FAILED_NOTE));
    }, 700);
    return () => clearTimeout(t);
  }, [readOnly, validation]);

  const displayNote = !validation.ok ? validation.error : saveNote;

  const months = monthsToJanuary(startYear, startMonth, state.targetYear);
  // Memoized as one object rather than spread into each hook's dep list: the
  // literal is a new reference every render, so listing its members while
  // closing over the object is exactly what react-hooks/exhaustive-deps
  // flags. Its five members are primitives, so this identity is stable.
  const shared = useMemo(
    () => ({
      targetToday: state.targetToday,
      months,
      currentSavings: state.currentSavings,
      annualReturn: state.annualReturn,
      inflationRate: dto.inflationRate,
    }),
    [state.targetToday, months, state.currentSavings, state.annualReturn, dto.inflationRate],
  );

  const required = useMemo(() => solveMonthlyForGoal(shared), [shared]);

  // In `solve` mode the chart and the stats show the plan that WORKS — the
  // contribution we just solved for. In `contribute` mode they show the
  // client's own figure. One run drives everything either way.
  const run = useMemo(
    () =>
      projectSavings({
        ...shared,
        monthlyContribution:
          state.mode === "solve" ? required : state.monthlyContribution,
      }),
    [shared, state.mode, state.monthlyContribution, required],
  );

  const goalLabel = fmtMonthLabel(monthLabel(startYear, startMonth, Math.max(1, months + 1)));
  const nothingEntered = state.targetToday <= 0;
  const dueNow = months <= 0;
  const alreadyThere = !nothingEntered && !dueNow && required === 0;

  function setPreset(label: string, yearsOut: number): void {
    patch({ name: label, targetYear: startYear + yearsOut });
  }

  return (
    <div className="space-y-5 p-6 lg:p-10">
      <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-ink">
        Savings goal<span className="dot">.</span>
      </h1>

      <section className="card p-5">
        {nothingEntered ? (
          <p className="max-w-prose text-[14px] leading-relaxed text-ink-2">
            Tell us what it costs and when you want it, and we&rsquo;ll work out the
            monthly number.
          </p>
        ) : dueNow ? (
          <p className="max-w-prose text-[14px] leading-relaxed text-ink-2">
            That&rsquo;s less than a year away, so this is a lump sum rather than a
            monthly saving: you&rsquo;re{" "}
            <span className="tabular font-medium text-ink">{fmtUsd(run.shortfall)}</span>{" "}
            short of the{" "}
            <span className="tabular">{fmtUsd(run.targetAtGoal)}</span> you need.
          </p>
        ) : alreadyThere ? (
          <p className="max-w-prose text-[14px] leading-relaxed text-ink-2">
            You&rsquo;re already there — what you have set aside grows to{" "}
            <span className="tabular font-medium text-ink">{fmtUsd(run.projected)}</span>{" "}
            by {goalLabel}, past the{" "}
            <span className="tabular">{fmtUsd(run.targetAtGoal)}</span> this will cost by
            then.
          </p>
        ) : (
          <>
            <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
              Save each month
            </div>
            <div
              data-testid="savings-goal-answer"
              className="tabular mt-1 text-[40px] font-semibold leading-none text-ink"
            >
              {fmtUsd(required)}
            </div>
            <p className="mt-2 max-w-prose text-[14px] leading-relaxed text-ink-2">
              to have <span className="tabular">{fmtUsd(run.targetAtGoal)}</span> by{" "}
              {goalLabel}.
            </p>
          </>
        )}
      </section>

      {!nothingEntered && !dueNow && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="You'd put in" value={fmtUsd(run.totalContributed)} />
            <Stat label="Growth adds" value={fmtUsd(run.growth)} />
            <Stat label="Already saved" value={fmtUsd(state.currentSavings)} />
          </div>

          <section className="card p-5">
            <SavingsGoalChart run={run} startYear={startYear} startMonth={startMonth} />
          </section>
        </>
      )}

      <section className="card p-5">
        <h2 className="mb-3 text-[15px] font-medium text-ink">What are you saving for?</h2>

        <div className="flex flex-wrap gap-1">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={state.name === p.label}
              onClick={() => setPreset(p.label, p.years)}
              className={`inline-flex min-h-[34px] items-center rounded-full border px-3.5 text-[13px] transition-colors ${portalTabColors(
                state.name === p.label,
              )}`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <label className="block text-[13px] text-ink-2">
            Goal name
            <input
              type="text"
              aria-label="Goal name"
              value={state.name}
              onChange={(e) => patch({ name: e.target.value.slice(0, MAX_NAME_LENGTH) })}
              className="mt-1 block w-full max-w-sm rounded-md border border-hair bg-surface px-3 py-2 text-[14px] text-ink"
            />
          </label>

          <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
            It&rsquo;ll cost
            <CurrencyInput
              aria-label="Goal cost"
              value={costRaw}
              onValueChange={(v) => {
                setCostRaw(v);
                patch({ targetToday: parseAmount(v) });
              }}
              className="tabular w-32 rounded-md border border-hair bg-surface px-3 py-2 text-[14px] text-ink"
            />
            in
            <select
              aria-label="Target year"
              value={state.targetYear}
              onChange={(e) => patch({ targetYear: Number(e.target.value) })}
              className="tabular rounded-md border border-hair bg-surface px-3 py-2 text-[14px] text-ink"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          {!nothingEntered && !dueNow && (
            <p className="text-[12px] leading-relaxed text-ink-3">
              About <span className="tabular">{fmtUsd(run.targetAtGoal)}</span> by then,
              at your plan&rsquo;s{" "}
              <span className="tabular">{(dto.inflationRate * 100).toFixed(1)}%</span>{" "}
              inflation.
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
            I&rsquo;ve already got
            <CurrencyInput
              aria-label="Already saved"
              value={savedRaw}
              onValueChange={(v) => {
                setSavedRaw(v);
                patch({ currentSavings: parseAmount(v) });
              }}
              className="tabular w-32 rounded-md border border-hair bg-surface px-3 py-2 text-[14px] text-ink"
            />
            set aside
          </div>

          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-2 text-[13px] text-ink-2">Invested</span>
            {RETURNS.map((r) => (
              <span key={r.label} className="inline-flex items-center gap-1">
                <button
                  type="button"
                  aria-pressed={state.annualReturn === r.rate}
                  onClick={() => patch({ annualReturn: r.rate })}
                  className={`inline-flex min-h-[34px] items-center rounded-full border px-3.5 text-[13px] transition-colors ${portalTabColors(
                    state.annualReturn === r.rate,
                  )}`}
                >
                  {r.label} <span className="tabular ml-1">{r.rate * 100}%</span>
                </button>
                <FieldTooltip text={r.help} />
              </span>
            ))}
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-3 text-[15px] font-medium text-ink">
          How do you want to work it out?
        </h2>

        <div className="space-y-3">
          <label className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
            <input
              type="radio"
              name="savings-goal-mode"
              checked={state.mode === "solve"}
              onChange={() => patch({ mode: "solve" })}
              className="accent-[var(--color-accent)]"
            />
            Tell me what I need to save each month
          </label>

          <label className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
            <input
              type="radio"
              name="savings-goal-mode"
              checked={state.mode === "contribute"}
              onChange={() => patch({ mode: "contribute" })}
              className="accent-[var(--color-accent)]"
            />
            I can save
            <CurrencyInput
              aria-label="Monthly saving"
              value={pmtRaw}
              onValueChange={(v) => {
                setPmtRaw(v);
                patch({ monthlyContribution: parseAmount(v), mode: "contribute" });
              }}
              className="tabular w-28 rounded-md border border-hair bg-surface px-3 py-2 text-[14px] text-ink"
            />
            a month
          </label>

          {state.mode === "contribute" && !nothingEntered && !dueNow && (
            <p className="max-w-prose text-[13px] leading-relaxed text-ink-2">
              <span className="tabular font-medium text-ink">
                {Math.round(run.percentFunded * 100)}%
              </span>{" "}
              funded
              {run.shortfall > 0 ? (
                <>
                  , short <span className="tabular">{fmtUsd(run.shortfall)}</span> —{" "}
                  {run.monthsToGoal === null
                    ? "at this pace you wouldn’t get there within fifty years."
                    : `you'd get there ${fmtMonthLabel(
                        monthLabel(startYear, startMonth, run.monthsToGoal + 1),
                      )}.`}
                </>
              ) : (
                <>
                  , with <span className="tabular">{fmtUsd(run.surplus)}</span> to spare.
                </>
              )}
            </p>
          )}
        </div>
      </section>

      {displayNote && <p className="text-[13px] leading-relaxed text-ink-3">{displayNote}</p>}
    </div>
  );
}
