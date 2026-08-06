"use client";

import { isBlankIntakeExpenseGoalRow, type IntakeDraft } from "@/lib/intake/schema";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ReviewStepProps {
  value: IntakeDraft;
  /** Called with the section name so the wizard can jump back. */
  onEdit: (section: "family" | "accounts" | "income" | "property" | "goals") => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const labelCls =
  "block text-[11px] font-medium uppercase tracking-[0.08em] text-ink-3";

const rowCls = "flex items-center justify-between gap-4 py-1";

function SectionCard({
  title,
  section,
  onEdit,
  children,
}: {
  title: string;
  section: ReviewStepProps["onEdit"] extends (s: infer S) => void ? S : never;
  onEdit: ReviewStepProps["onEdit"];
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className={labelCls}>{title}</h3>
        <button
          type="button"
          onClick={() => onEdit(section)}
          className="rounded-[var(--radius-sm)] border border-hair px-3 py-1 text-[12px] text-ink-2 transition-colors hover:border-accent hover:text-accent"
          aria-label={`Edit ${title}`}
        >
          Edit
        </button>
      </div>
      <div className="space-y-1 text-[14px] text-ink-2">{children}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string | number | undefined }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className={rowCls}>
      <span className="text-ink-3">{label}</span>
      <span className="tabular text-ink">{value}</span>
    </div>
  );
}

function formatMoney(n: number | undefined): string | undefined {
  if (n === undefined) return undefined;
  return `$${n.toLocaleString()}`;
}

// ─── ReviewStep ───────────────────────────────────────────────────────────────
//
// Submit affordance strategy: WizardChrome's Next button (labelled "Submit")
// is the SOLE submit control. ReviewStep renders only the accordion summary +
// Edit jump-back affordances — no in-body Submit button.

export function ReviewStep({ value, onEdit }: ReviewStepProps) {
  const { family, accounts, income, property, goals } = value;

  const primary = family?.primary;
  const spouse = family?.spouse;
  const children = family?.children ?? [];
  // Abandoned cards are filtered out, not just left to render: a blank goal
  // carries `amount: 0`, which formats as "$0" and would list a row here that
  // submit then prunes away. Same predicate submit uses, so the two agree.
  const expenseGoals = (goals?.expenseGoals ?? []).filter(
    (g) => !isBlankIntakeExpenseGoalRow(g),
  );
  const topics = goals?.topics ?? [];

  return (
    <div className="space-y-6">
      {/* ── Intro ──────────────────────────────────────────────────── */}
      <p className="text-[14px] text-ink-3">
        Review what you&apos;ve shared. Use Edit to go back and correct anything.
      </p>

      {/* ── Family ────────────────────────────────────────────────── */}
      <SectionCard title="Family" section="family" onEdit={onEdit}>
        {primary?.firstName || primary?.lastName ? (
          <Row
            label="Client"
            value={[primary.firstName, primary.lastName].filter(Boolean).join(" ")}
          />
        ) : (
          <p className="text-[13px] text-ink-4">No family information entered.</p>
        )}
        {spouse && (
          <Row
            label="Spouse"
            value={[spouse.firstName, spouse.lastName].filter(Boolean).join(" ")}
          />
        )}
        {family?.stateOfResidence && (
          <Row label="State" value={family.stateOfResidence} />
        )}
        {children.length > 0 && (
          <Row label="Children" value={children.length} />
        )}
      </SectionCard>

      {/* ── Accounts ──────────────────────────────────────────────── */}
      <SectionCard title="Accounts" section="accounts" onEdit={onEdit}>
        {(accounts?.length ?? 0) === 0 ? (
          <p className="text-[13px] text-ink-4">No accounts added.</p>
        ) : (
          accounts!.map((a, i) => (
            <Row
              key={i}
              label={a.name ?? `Account ${i + 1}`}
              value={formatMoney(a.value)}
            />
          ))
        )}
      </SectionCard>

      {/* ── Income ────────────────────────────────────────────────── */}
      <SectionCard title="Income" section="income" onEdit={onEdit}>
        {(income?.length ?? 0) === 0 ? (
          <p className="text-[13px] text-ink-4">No income sources added.</p>
        ) : (
          income!.map((inc, i) => (
            <Row
              key={i}
              label={inc.name ?? `Income ${i + 1}`}
              value={formatMoney(inc.annualAmount)}
            />
          ))
        )}
      </SectionCard>

      {/* ── Property ──────────────────────────────────────────────── */}
      <SectionCard title="Property" section="property" onEdit={onEdit}>
        {(property?.length ?? 0) === 0 ? (
          <p className="text-[13px] text-ink-4">No property added.</p>
        ) : (
          property!.map((p, i) => (
            <Row
              key={i}
              label={p.name ?? `Property ${i + 1}`}
              value={formatMoney(p.value)}
            />
          ))
        )}
      </SectionCard>

      {/* ── Goals ─────────────────────────────────────────────────── */}
      <SectionCard title="Goals" section="goals" onEdit={onEdit}>
        {isGoalsEmpty(goals, expenseGoals.length, topics.length) ? (
          <p className="text-[13px] text-ink-4">No goals entered.</p>
        ) : (
          <>
            <Row label="Client retirement age" value={goals?.clientRetirementAge} />
            <Row label="Spouse retirement age" value={goals?.spouseRetirementAge} />
            <Row label="Annual retirement expenses" value={formatMoney(goals?.annualRetirementExpenses)} />
            {expenseGoals.map((g, i) => (
              <Row
                key={i}
                label={g.name?.trim() || `Goal ${i + 1}`}
                value={formatMoney(g.amount)}
              />
            ))}
            {topics.length > 0 && (
              <Row label="On your radar" value={`${topics.length} to discuss`} />
            )}
          </>
        )}
      </SectionCard>

    </div>
  );
}

/**
 * True only when the client left the whole step alone. Every field counts —
 * including a lone checked "On your radar" box, which is the one thing on this
 * step a client can answer without typing a single number.
 *
 * The two counts are passed in already filtered, so "one abandoned goal card"
 * reads as empty here exactly as it does on submit.
 */
function isGoalsEmpty(
  goals: IntakeDraft["goals"],
  goalCount: number,
  topicCount: number,
): boolean {
  return (
    !goals?.clientRetirementAge &&
    !goals?.spouseRetirementAge &&
    !goals?.annualRetirementExpenses &&
    goalCount === 0 &&
    topicCount === 0 &&
    !goals?.topicsNote?.trim()
  );
}
