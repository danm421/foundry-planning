"use client";

import { birthYearFromDob } from "@/lib/age-year";
import { EDUCATION_GOAL_YEARS, educationGoalYears } from "@/lib/goals";
import {
  DEFAULT_GOAL_TYPE,
  GOAL_TOPIC_OPTIONS,
  GOAL_TYPE_OPTIONS,
  goalSpanLabel,
  goalTypeLabel,
} from "@/lib/intake/goal-rows";
import type { IntakeDraft, IntakeGoalTopic } from "@/lib/intake/schema";
import {
  CardList,
  IntegerInput,
  MoneyInput,
  YearInput,
  inputCls,
  labelCls,
  money,
  selectCls,
} from "./card-list";

// ─── Types ───────────────────────────────────────────────────────────────────

export type GoalsSlice = IntakeDraft["goals"];
type GoalsValue = NonNullable<GoalsSlice>;
type GoalItem = NonNullable<GoalsValue["expenseGoals"]>[number];

/** A household member a goal can be *for*. The REF is what reaches the payload. */
export interface GoalBeneficiary {
  /** Structural reference — "client" | "spouse" | "child:<i>". Survives a rename. */
  ref: string;
  name: string;
  /** ISO date; used to date an education goal from the student's birthday. */
  dateOfBirth?: string;
}

export interface GoalsStepProps {
  value: GoalsSlice;
  onChange: (next: GoalsSlice) => void;
  /**
   * Everyone the household has named so far — client, spouse, children — in the
   * order they should appear in the "who is this for" picker. Empty means the
   * picker is hidden entirely rather than shown with nothing in it.
   */
  beneficiaries?: GoalBeneficiary[];
}

// ─── Blank template ──────────────────────────────────────────────────────────
//
// "other" + 1 year is what `isBlankIntakeExpenseGoalRow` treats as untouched, so
// a card added and abandoned is pruned on submit instead of failing validation.

function blankGoal(): GoalItem {
  return { name: "", type: DEFAULT_GOAL_TYPE, amount: 0, years: 1 };
}

// ─── Education defaults ──────────────────────────────────────────────────────
//
// Education is the one goal type the app already has an opinion about: a
// four-year programme starting the year the student turns 18 (`lib/goals.ts`,
// shared with the advisor-side expense dialog and the Household Map drawer). The
// same rule runs here so a goal a client enters lands on the years an advisor
// entering it by hand would get.
//
// Both defaults only ever fill a blank. A year the client typed is never
// rewritten, and the length is only stretched while it still sits at the
// template's 1 — so re-picking a beneficiary can't undo an edit.

/** Apply `patch` to a goal, filling education's blanks. Returns the whole row. */
function nextGoal(
  item: GoalItem,
  patch: Partial<GoalItem>,
  beneficiaries: GoalBeneficiary[],
  currentYear: number,
): GoalItem {
  const next = { ...item, ...patch };
  if (next.type !== "education") return next;

  if ((next.years ?? 1) <= 1) next.years = EDUCATION_GOAL_YEARS;
  if (next.startYear == null) {
    const student = beneficiaries.find((b) => b.ref === next.forWhom);
    const birthYear = birthYearFromDob(student?.dateOfBirth);
    if (birthYear !== null) {
      next.startYear = educationGoalYears(birthYear, currentYear).startYear;
    }
  }
  return next;
}

// ─── GoalsStep ────────────────────────────────────────────────────────────────
//
// Three stacked sections, narrowing from most concrete to least:
//   1. Retirement — the two ages and the spend that anchor every projection.
//   2. Upcoming goals — anything with a number and a date on it. Each one
//      becomes a goal-flagged expense row on apply.
//   3. On your radar — checkboxes for goals with neither. These are an agenda
//      for the first meeting, not plan data; apply files them as a CRM note.

export function GoalsStep({ value, onChange, beneficiaries = [] }: GoalsStepProps) {
  const goals = value ?? {};
  const expenseGoals = goals.expenseGoals ?? [];
  const topics = goals.topics ?? [];
  const currentYear = new Date().getFullYear();

  function setField(field: "clientRetirementAge" | "spouseRetirementAge", raw: string) {
    const num = raw === "" ? undefined : Number(raw);
    onChange({ ...goals, [field]: num });
  }

  function setGoals(next: GoalItem[]) {
    onChange({ ...goals, expenseGoals: next });
  }

  function updateGoal(index: number, patch: Partial<GoalItem>) {
    setGoals(
      expenseGoals.map((item, i) =>
        i === index ? nextGoal(item, patch, beneficiaries, currentYear) : item,
      ),
    );
  }

  function toggleTopic(topic: IntakeGoalTopic, checked: boolean) {
    onChange({
      ...goals,
      topics: checked ? [...topics, topic] : topics.filter((t) => t !== topic),
    });
  }

  const totalGoalCost = expenseGoals.reduce(
    (sum, g) => sum + (g.amount ?? 0) * (g.years ?? 1),
    0,
  );

  return (
    <div className="space-y-10">
      {/* ── 1. Retirement ─────────────────────────────────────────────── */}
      <section className="space-y-6">
        <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
          Retirement goals
        </h2>

        <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {/* Client retirement age */}
            <div>
              <label htmlFor="goals-clientRetirementAge" className={labelCls}>
                Client retirement age
                <span className="ml-1 font-normal normal-case text-ink-4">(optional)</span>
              </label>
              <input
                id="goals-clientRetirementAge"
                type="number"
                min={40}
                max={100}
                className={`${inputCls} tabular`}
                value={goals.clientRetirementAge ?? ""}
                onChange={(e) => setField("clientRetirementAge", e.target.value)}
                placeholder="e.g. 65"
                aria-label="Client retirement age"
              />
            </div>

            {/* Spouse retirement age */}
            <div>
              <label htmlFor="goals-spouseRetirementAge" className={labelCls}>
                Spouse retirement age
                <span className="ml-1 font-normal normal-case text-ink-4">(optional)</span>
              </label>
              <input
                id="goals-spouseRetirementAge"
                type="number"
                min={40}
                max={100}
                className={`${inputCls} tabular`}
                value={goals.spouseRetirementAge ?? ""}
                onChange={(e) => setField("spouseRetirementAge", e.target.value)}
                placeholder="e.g. 63"
                aria-label="Spouse retirement age"
              />
            </div>

            {/* Annual retirement expenses */}
            <div className="sm:col-span-2">
              <label htmlFor="goals-annualRetirementExpenses" className={labelCls}>
                Annual retirement expenses
                <span className="ml-1 font-normal normal-case text-ink-4">(optional)</span>
              </label>
              <MoneyInput
                id="goals-annualRetirementExpenses"
                value={goals.annualRetirementExpenses}
                onChange={(num) =>
                  onChange({ ...goals, annualRetirementExpenses: num })
                }
                ariaLabel="Annual retirement expenses"
                placeholder="80,000"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Upcoming goals ─────────────────────────────────────────── */}
      <section className="space-y-6">
        <div>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
            Upcoming goals
          </h2>
          <p className="mt-1.5 text-[13px] text-ink-3">
            Big expenses you&apos;re planning for. Use today&apos;s prices —
            we&apos;ll account for inflation between now and then.
          </p>
        </div>

        <CardList
          addLabel="Add goal"
          emptyMessage="No goals added yet"
          emptyHint="College, a wedding, a second home, a once-in-a-lifetime trip."
          items={expenseGoals}
          kpis={[
            { label: "Goals", value: String(expenseGoals.length) },
            { label: "Total cost", value: money(totalGoalCost) },
          ]}
          onAdd={() => setGoals([...expenseGoals, blankGoal()])}
          onRemove={(index) => setGoals(expenseGoals.filter((_, i) => i !== index))}
          renderSummary={(item) => ({
            title: item.name?.trim() || "Untitled goal",
            subtitle: [
              goalTypeLabel(item.type),
              beneficiaries.find((b) => b.ref === item.forWhom)?.name,
              goalSpanLabel(item, currentYear),
            ]
              .filter(Boolean)
              .join(" · "),
            amount: item.amount,
          })}
          renderItem={(item, i) => {
            const idp = `goal-${i}`;
            const multiYear = (item.years ?? 1) > 1;
            return (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {/* Name */}
                <div className="sm:col-span-2">
                  <label htmlFor={`${idp}-name`} className={labelCls}>
                    Description
                  </label>
                  <input
                    id={`${idp}-name`}
                    type="text"
                    className={inputCls}
                    value={item.name ?? ""}
                    onChange={(e) => updateGoal(i, { name: e.target.value })}
                    placeholder="e.g. Emma's college"
                    aria-label="Description"
                  />
                </div>

                {/* Type */}
                <div>
                  <label htmlFor={`${idp}-type`} className={labelCls}>
                    Goal type
                  </label>
                  <select
                    id={`${idp}-type`}
                    className={selectCls}
                    value={item.type ?? DEFAULT_GOAL_TYPE}
                    onChange={(e) =>
                      updateGoal(i, { type: e.target.value as GoalItem["type"] })
                    }
                    aria-label="Goal type"
                  >
                    {GOAL_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Who it's for — hidden when the form has no one to offer */}
                {beneficiaries.length > 0 && (
                  <div>
                    <label htmlFor={`${idp}-forWhom`} className={labelCls}>
                      Who is this for?
                      <span className="ml-1 font-normal normal-case text-ink-4">
                        (optional)
                      </span>
                    </label>
                    <select
                      id={`${idp}-forWhom`}
                      className={selectCls}
                      value={item.forWhom ?? ""}
                      onChange={(e) => updateGoal(i, { forWhom: e.target.value || undefined })}
                      aria-label="Who is this for?"
                    >
                      <option value="">The household</option>
                      {beneficiaries.map((b) => (
                        <option key={b.ref} value={b.ref}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Amount */}
                <div>
                  <label htmlFor={`${idp}-amount`} className={labelCls}>
                    Estimated cost
                    <span className="ml-1 font-normal normal-case text-ink-4">
                      {multiYear ? "(per year)" : "(today's dollars)"}
                    </span>
                  </label>
                  <MoneyInput
                    id={`${idp}-amount`}
                    value={item.amount}
                    onChange={(num) => updateGoal(i, { amount: num })}
                    ariaLabel="Estimated cost"
                    placeholder="0"
                  />
                </div>

                {/* Start year */}
                <div>
                  <label htmlFor={`${idp}-startYear`} className={labelCls}>
                    Starting in
                  </label>
                  <YearInput
                    id={`${idp}-startYear`}
                    value={item.startYear}
                    onChange={(num) => updateGoal(i, { startYear: num })}
                    ariaLabel="Starting in"
                    placeholder={String(currentYear + 5)}
                  />
                </div>

                {/* Duration */}
                <div>
                  <label htmlFor={`${idp}-years`} className={labelCls}>
                    For how long?
                  </label>
                  <IntegerInput
                    id={`${idp}-years`}
                    value={item.years}
                    onChange={(num) => updateGoal(i, { years: num })}
                    ariaLabel="For how long?"
                    placeholder="1"
                    suffix="years"
                  />
                  <p className="mt-1 text-[12px] text-ink-3">
                    Leave at 1 for a one-time expense.
                  </p>
                </div>
              </div>
            );
          }}
        />
      </section>

      {/* ── 3. On your radar ──────────────────────────────────────────── */}
      <section className="space-y-6">
        <div>
          <h2 className="text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3">
            On your radar
          </h2>
          <p className="mt-1.5 text-[13px] text-ink-3">
            Anything you&apos;d like to talk through, even if there&apos;s no
            date or number yet. Check what&apos;s on your mind — we&apos;ll bring
            it up when we meet.
          </p>
        </div>

        <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
          <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
            {GOAL_TOPIC_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className="flex items-start gap-2.5 text-[14px] text-ink-2"
              >
                <input
                  type="checkbox"
                  checked={topics.includes(opt.value)}
                  onChange={(e) => toggleTopic(opt.value, e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 rounded border-hair bg-card-2 text-accent focus:ring-1 focus:ring-accent"
                />
                {opt.label}
              </label>
            ))}
          </div>

          <div className="mt-6 border-t border-hair pt-5">
            <label htmlFor="goals-topicsNote" className={labelCls}>
              Anything else on your mind?
              <span className="ml-1 font-normal normal-case text-ink-4">(optional)</span>
            </label>
            <textarea
              id="goals-topicsNote"
              rows={3}
              maxLength={2000}
              className={`${inputCls} resize-y`}
              value={goals.topicsNote ?? ""}
              onChange={(e) => onChange({ ...goals, topicsNote: e.target.value })}
              placeholder="A question you'd like answered, a change coming up, something you're unsure about…"
              aria-label="Anything else on your mind?"
            />
          </div>
        </div>
      </section>
    </div>
  );
}
