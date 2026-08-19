"use client";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { CurrencyInput } from "@/components/portal/currency-input";
import { portalTabColors } from "@/components/portal/portal-tab-strip";
import { DebtPaydownChart } from "@/components/portal/debt-paydown-chart";
import { DebtPaydownSchedule } from "@/components/portal/debt-paydown-schedule";
import {
  DebtPaydownDebts,
  toPercent,
  type PaydownRow,
  type ManualRawInputs,
} from "@/components/portal/debt-paydown-debts";
import { fmtUsd } from "@/lib/portal/format";
import {
  comparePaydown,
  monthLabel,
  monthsUntil,
  solveExtraForTarget,
  MAX_PAYDOWN_MONTHS,
  type PaydownDebt,
  type PaydownStrategy,
} from "@/lib/calculators/debt-paydown";
import {
  validateDebtPaydownState,
  MAX_NAME_LENGTH,
  type DebtPaydownState,
  type ManualDebt,
} from "@/lib/calculators/debt-paydown-state";
import { DEBT_PAYDOWN_KEY, type DebtPaydownDTO } from "@/lib/portal/load-debt-paydown";

const STRATEGIES: { key: PaydownStrategy; label: string; help: string }[] = [
  {
    key: "avalanche",
    label: "Avalanche",
    help: "Puts every spare dollar on the debt with the highest interest rate first. Costs you the least interest overall.",
  },
  {
    key: "snowball",
    label: "Snowball",
    help: "Puts every spare dollar on the smallest balance first. Costs a little more, but you clear whole debts sooner.",
  },
  {
    key: "equally",
    label: "Equally",
    help: "Splits every spare dollar evenly across the debts you still owe.",
  },
];

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "YYYY-MM" → "Jan 2028". Null (the plan never clears) reads plainly rather
 * than crashing on a `.split` of null — it sits right beside the warn line
 * that already names a debt as stalled, so it needs to say the same thing in
 * its own word. */
function monthName(label: string | null): string {
  if (label === null) return "Never, at this pace";
  const [y, m] = label.split("-");
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

function yearsAndMonths(n: number): string {
  if (n <= 0) return "none";
  const y = Math.floor(n / 12);
  const m = n % 12;
  return [y > 0 ? `${y} yr` : "", m > 0 ? `${m} mo` : ""].filter(Boolean).join(" ");
}

const SAVE_FAILED_NOTE =
  "We couldn’t save your setup just now — the numbers above still work.";

/**
 * Guarantees a fresh manual-debt id is unique even when two "Add a debt"
 * clicks land in the same millisecond of `Date.now()` — the validator (shared
 * with the route handler) rejects duplicate ids inside `manualDebts`, so a
 * collision would silently fail the very next save. Module-level: a reload
 * takes far more than a millisecond, so ids stored from an earlier visit can
 * never collide with ones minted fresh.
 */
let manualIdCounter = 0;

/** Blank or unparseable → 0, matching how a cleared field means "no figure
 * yet" rather than a validation error while the client is mid-edit. */
function parseAmount(raw: string): number {
  const n = Number(raw);
  return raw.trim() === "" || !Number.isFinite(n) ? 0 : n;
}

function rawInputsFor(d: { balance: number; annualRate: number; minimumPayment: number }): {
  balance: string;
  annualRate: string;
  minimumPayment: string;
} {
  return {
    balance: String(d.balance),
    annualRate: String(toPercent(d.annualRate)),
    minimumPayment: String(d.minimumPayment),
  };
}

/**
 * The debt paydown calculator.
 *
 * The answer sits at the top and the inputs below it, and everything recomputes
 * in this component — the simulator is pure and finishes in under a millisecond,
 * so there is no round trip between moving a number and seeing the result. The
 * only network call is a debounced save of the client's setup; a failed save
 * shows a quiet note and never stops the maths.
 */
export function DebtPaydownWorkspace({
  dto,
  readOnly = false,
}: {
  dto: DebtPaydownDTO;
  /** The advisor preview: the numbers still run, but nothing is persisted —
   * `requireClientPortalAccess` 403s any session carrying an org, so an
   * advisor previewing would otherwise see every keystroke paint a failed
   * save. */
  readOnly?: boolean;
}): ReactElement {
  const [state, setState] = useState<DebtPaydownState>(dto.state);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const firstRender = useRef(true);

  // The RAW strings behind the extra-payment field and every manual debt's
  // amount fields — kept separate from the parsed numbers in `state` because
  // a controlled input whose `value` is re-derived from a parsed number loses
  // whatever the number can't represent while it's typed, most visibly a
  // trailing decimal point: type "5", then ".", and a `String(rate * 100)`
  // round-trip renders "5" again, so the next digit appends onto the integer
  // instead of continuing the decimal. These strings ARE what the input
  // displays; `state` is what the maths and the save use. Both are updated
  // together on every keystroke — see `setManualField` and the extra-payment
  // field below — so the two never actually disagree about the VALUE, only
  // about how it's spelled mid-edit.
  const [extraRaw, setExtraRaw] = useState(() => String(dto.state.extraMonthly));
  const [manualRaw, setManualRaw] = useState<ManualRawInputs>(() =>
    Object.fromEntries(dto.state.manualDebts.map((d) => [d.id, rawInputsFor(d)])),
  );

  const now = useMemo(() => new Date(), []);
  const startYear = now.getFullYear();
  const startMonth = now.getMonth() + 1;

  function patch(next: Partial<DebtPaydownState>): void {
    setState((s) => ({ ...s, ...next }));
  }

  // Pure function of `state` — computed during render, not stored via an
  // effect, so a keystroke that makes the state locally invalid (e.g. a
  // manual debt's name typed down to empty) shows the validator's own
  // message the instant it happens rather than waiting on an effect.
  const validation = useMemo(() => validateDebtPaydownState(state), [state]);

  // Debounced save. Skips the first render so simply opening the page does
  // not write a row, and skips entirely while the state fails the SAME
  // validation the route handler judges the PUT by — the debounce would
  // otherwise fire a doomed 400 mid-keystroke and paint a scary failure
  // banner; `validation` above already carries the honest reason instead.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (readOnly || !validation.ok) return;

    const t = setTimeout(() => {
      void fetch(`/api/portal/calculators/${DEBT_PAYDOWN_KEY}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: validation.state }),
      })
        .then((r) => setSaveNote(r.ok ? null : SAVE_FAILED_NOTE))
        .catch(() => setSaveNote(SAVE_FAILED_NOTE));
    }, 700);
    return () => clearTimeout(t);
  }, [state, readOnly, validation]);

  // The locally invalid reason wins over a stale async result — it is the
  // live, honest state of "why this can't save right now".
  const displayNote = !validation.ok ? validation.error : saveNote;

  // Real debts with the client's own numbers laid over them, then the ones
  // they added by hand.
  const rows: Omit<PaydownRow, "payoffLabel">[] = useMemo(() => {
    const excluded = new Set(state.excludedDebtIds);
    const real = dto.debts.map((d) => {
      const o = state.overrides[d.id] ?? {};
      return {
        id: d.id,
        name: d.name,
        balance: d.balance,
        annualRate: o.annualRate ?? d.annualRate,
        minimumPayment: o.minimumPayment ?? d.minimumPayment,
        manual: false,
        included: !excluded.has(d.id),
      };
    });
    const manual = state.manualDebts.map((d) => ({
      id: d.id,
      name: d.name,
      balance: d.balance,
      annualRate: d.annualRate,
      minimumPayment: d.minimumPayment,
      manual: true,
      included: !excluded.has(d.id),
    }));
    return [...real, ...manual];
  }, [dto.debts, state.overrides, state.manualDebts, state.excludedDebtIds]);

  const selected: PaydownDebt[] = useMemo(
    () =>
      rows
        .filter((r) => r.included && r.annualRate !== null && r.minimumPayment !== null)
        .map((r) => ({
          id: r.id,
          name: r.name,
          balance: r.balance,
          annualRate: r.annualRate as number,
          minimumPayment: r.minimumPayment as number,
        })),
    [rows],
  );

  // Beyond the simulator's own horizon a goal-seek would silently answer a
  // different question than the one asked, so the target is clamped to the
  // same ceiling `simulatePaydown` already enforces.
  const targetMonths = state.targetMonth
    ? Math.min(monthsUntil(startYear, startMonth, state.targetMonth), MAX_PAYDOWN_MONTHS)
    : null;

  const goal = useMemo(
    () =>
      state.mode === "target" && targetMonths !== null && targetMonths > 0 && selected.length > 0
        ? solveExtraForTarget(selected, state.strategy, targetMonths, startYear, startMonth)
        : null,
    [state.mode, state.strategy, targetMonths, selected, startYear, startMonth],
  );

  const extra = goal ? goal.extraMonthly : state.extraMonthly;

  const comparison = useMemo(
    () =>
      comparePaydown(selected, {
        strategy: state.strategy,
        extraMonthly: extra,
        startYear,
        startMonth,
      }),
    [selected, state.strategy, extra, startYear, startMonth],
  );

  const payoffById = new Map(
    comparison.plan.perDebt.map((d) => [
      d.id,
      d.payoffMonth === null ? null : monthName(monthLabel(startYear, startMonth, d.payoffMonth)),
    ]),
  );
  const listRows: PaydownRow[] = rows.map((r) => ({
    ...r,
    payoffLabel: payoffById.get(r.id) ?? null,
  }));

  const stalled = comparison.plan.stalledDebtIds
    .map((id) => selected.find((d) => d.id === id))
    .filter((d): d is PaydownDebt => d != null);

  function toggle(id: string, included: boolean): void {
    const set = new Set(state.excludedDebtIds);
    if (included) set.delete(id);
    else set.add(id);
    patch({ excludedDebtIds: [...set] });
  }

  function setOverride(id: string, field: "annualRate" | "minimumPayment", raw: string): void {
    const n = Number(raw);
    const value = raw.trim() === "" || !Number.isFinite(n) ? undefined : n;
    const next = { ...state.overrides };
    const entry = { ...(next[id] ?? {}) };
    if (value === undefined) delete entry[field];
    // The rate field is typed as a percent and stored as a fraction.
    else entry[field] = field === "annualRate" ? value / 100 : value;
    next[id] = entry;
    patch({ overrides: next });
  }

  /** A hand-added debt has no server-known figures to fall back on, so unlike
   * `setOverride` above, every field writes straight into the manual debt
   * itself — this IS its data, not a patch over something else.
   *
   * Updates TWO pieces of state on every keystroke: the parsed number in
   * `state.manualDebts` (what the maths and the save use) and the raw typed
   * string in `manualRaw` (what the field displays). Never derive one from
   * the other after the fact — that round trip is the decimal-point bug this
   * split exists to avoid. */
  function setManualField(
    id: string,
    field: "name" | "balance" | "annualRate" | "minimumPayment",
    raw: string,
  ): void {
    const manualDebts = state.manualDebts.map((d): ManualDebt => {
      if (d.id !== id) return d;
      if (field === "name") return { ...d, name: raw.slice(0, MAX_NAME_LENGTH) };
      const value = parseAmount(raw);
      // Typed as a percent, stored as a fraction — same convention as overrides.
      return field === "annualRate" ? { ...d, annualRate: value / 100 } : { ...d, [field]: value };
    });
    patch({ manualDebts });

    if (field !== "name") {
      setManualRaw((m) => ({
        ...m,
        [id]: { ...(m[id] ?? rawInputsFor({ balance: 0, annualRate: 0, minimumPayment: 0 })), [field]: raw },
      }));
    }
  }

  function isManual(id: string): boolean {
    return state.manualDebts.some((d) => d.id === id);
  }

  function addManual(): void {
    manualIdCounter += 1;
    const id = `m${Date.now()}-${manualIdCounter}`;
    const fresh = { balance: 0, annualRate: 0, minimumPayment: 0 };
    patch({
      manualDebts: [...state.manualDebts, { id, name: "New debt", ...fresh }],
    });
    setManualRaw((m) => ({ ...m, [id]: rawInputsFor(fresh) }));
  }

  function removeManual(id: string): void {
    patch({ manualDebts: state.manualDebts.filter((d) => d.id !== id) });
    setManualRaw((m) => {
      if (!(id in m)) return m;
      const next = { ...m };
      delete next[id];
      return next;
    });
  }

  if (dto.debts.length === 0 && state.manualDebts.length === 0) {
    return (
      <div className="p-6 lg:p-10">
        <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-ink">
          Debt paydown<span className="dot">.</span>
        </h1>
        <section className="card mt-6 p-5">
          <p className="max-w-prose text-[14px] leading-relaxed text-ink-2">
            You have no debts on file. Add one below, or add it under Organizer → Accounts
            and it will show up here automatically.
          </p>
          <button
            type="button"
            onClick={addManual}
            className="mt-4 rounded-md bg-accent px-3.5 py-2 text-[13px] font-medium text-accent-on hover:bg-accent-ink"
          >
            Add a debt
          </button>
        </section>
      </div>
    );
  }

  const nothingUsable = selected.length === 0;
  const chartEmpty =
    Math.max(comparison.baseline.balanceSeries.length, comparison.plan.balanceSeries.length) < 2;

  return (
    <div className="space-y-5 p-6 lg:p-10">
      <h1 className="text-[32px] font-semibold leading-tight tracking-[-0.025em] text-ink">
        Debt paydown<span className="dot">.</span>
      </h1>

      {nothingUsable ? (
        <section className="card p-5">
          <p className="max-w-prose text-[14px] text-ink-2">
            Fill in a rate and a monthly payment below to see when you would be debt free.
          </p>
        </section>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat label="Debt-free by" value={monthName(comparison.debtFreeMonth)} />
            <Stat label="Interest saved" value={fmtUsd(comparison.interestSaved)} />
            <Stat label="Time saved" value={yearsAndMonths(comparison.monthsSaved)} />
          </div>

          <section className="card p-5">
            {chartEmpty ? (
              <p className="text-[13px] text-ink-3">
                Nothing left to pay down here, so there is nothing to chart yet.
              </p>
            ) : (
              <DebtPaydownChart
                comparison={comparison}
                startYear={startYear}
                startMonth={startMonth}
              />
            )}
          </section>
        </>
      )}

      {stalled.length > 0 && (
        <p className="text-[13px] leading-relaxed text-warn">
          {`A payment of ${fmtUsd(stalled[0].minimumPayment)} doesn't cover ${stalled[0].name}'s monthly interest of about ${fmtUsd((stalled[0].balance * stalled[0].annualRate) / 12)}, so the balance would never be paid off. Check the rate and payment.`}
        </p>
      )}

      <section className="card p-5">
        <h2 className="mb-3 text-[15px] font-medium text-ink">
          How fast do you want to be done?
        </h2>

        <div className="flex flex-wrap gap-1">
          {STRATEGIES.map((s) => (
            <span key={s.key} className="inline-flex items-center gap-1">
              <button
                type="button"
                aria-pressed={state.strategy === s.key}
                onClick={() => patch({ strategy: s.key })}
                className={`inline-flex min-h-[34px] items-center rounded-full border px-3.5 text-[13px] transition-colors ${portalTabColors(
                  state.strategy === s.key,
                )}`}
              >
                {s.label}
              </button>
              <FieldTooltip text={s.help} />
            </span>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <label className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
            <input
              type="radio"
              name="paydown-mode"
              checked={state.mode === "extra"}
              onChange={() => patch({ mode: "extra" })}
              className="accent-[var(--color-accent)]"
            />
            I can pay
            <CurrencyInput
              value={extraRaw}
              onValueChange={(v) => {
                setExtraRaw(v);
                patch({ extraMonthly: parseAmount(v), mode: "extra" });
              }}
              aria-label="Extra payment each month"
              className="w-28 rounded-md border border-hair bg-card-2 px-2 py-1 text-right tabular text-[13px] text-ink"
            />
            extra a month
          </label>

          <label className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
            <input
              type="radio"
              name="paydown-mode"
              checked={state.mode === "target"}
              onChange={() => patch({ mode: "target" })}
              className="accent-[var(--color-accent)]"
            />
            I want to be done by
            <input
              type="month"
              value={state.targetMonth ?? ""}
              onChange={(e) => patch({ targetMonth: e.target.value || null, mode: "target" })}
              aria-label="Debt free by"
              className="rounded-md border border-hair bg-card-2 px-2 py-1 tabular text-[13px] text-ink"
            />
            {goal &&
              (goal.unreachable ? (
                <span className="text-[13px] text-warn">
                  Not even paying the whole balance every month gets you there by then.
                </span>
              ) : goal.alreadyOnTrack ? (
                <span className="text-[13px] text-ink-3">
                  You&rsquo;re on track to be done by then already.
                </span>
              ) : (
                <span className="text-[13px] text-ink">
                  you&rsquo;d need{" "}
                  <span className="tabular font-medium">{fmtUsd(goal.extraMonthly)}</span> a month
                </span>
              ))}
          </label>
        </div>
      </section>

      <DebtPaydownDebts
        rows={listRows}
        manualCount={state.manualDebts.length}
        manualRaw={manualRaw}
        edits={{
          onToggle: toggle,
          onRate: (id, v) =>
            isManual(id) ? setManualField(id, "annualRate", v) : setOverride(id, "annualRate", v),
          onPayment: (id, v) =>
            isManual(id)
              ? setManualField(id, "minimumPayment", v)
              : setOverride(id, "minimumPayment", v),
          onName: (id, v) => setManualField(id, "name", v),
          onBalance: (id, v) => setManualField(id, "balance", v),
          onRemove: removeManual,
          onAdd: addManual,
        }}
      />

      {!nothingUsable && (
        <details className="card p-5">
          <summary className="cursor-pointer text-[14px] text-ink-2">Year by year</summary>
          <div className="mt-4">
            <DebtPaydownSchedule rows={comparison.plan.yearly} />
          </div>
        </details>
      )}

      {displayNote && <p className="text-[12px] text-ink-3">{displayNote}</p>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="card p-5">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{label}</div>
      <div className="tabular mt-1.5 text-[32px] font-semibold leading-none text-ink">{value}</div>
    </div>
  );
}
