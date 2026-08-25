"use client";

import { isBlankIntakeExpenseGoalRow, type IntakeDraft } from "@/lib/intake/schema";
import {
  FIDUCIARY_SLOTS,
  childDistributionLabel,
  estateHousehold,
  fiduciarySlotLabel,
  findFiduciary,
  formatEstateAddress,
  inheritanceSummaryLine,
  isEstateEmpty,
  predeceasedLabel,
  legalResidenceLabel,
} from "@/lib/intake/estate";
import type { IntakeSectionKey } from "@/lib/intake/sections";

// ─── Types ───────────────────────────────────────────────────────────────────

/** The sections this screen can summarize. Documents is reviewed on its own
 *  step, and Risk has no summary yet. */
const REVIEWABLE_SECTIONS = [
  "family",
  "accounts",
  "income",
  "property",
  "goals",
  "estate",
] as const;

type ReviewableSection = (typeof REVIEWABLE_SECTIONS)[number];

export interface ReviewStepProps {
  value: IntakeDraft;
  /**
   * What this form collects. Required, with no default: a caller that forgets it
   * should not silently summarize sections the client was never shown.
   */
  sections: readonly IntakeSectionKey[];
  /** Called with the section name so the wizard can jump back. */
  onEdit: (section: ReviewableSection) => void;
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
  section: ReviewableSection;
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
      {/* min-w-0 + break-words: a flex item will not shrink below the width of
          its longest unbreakable token, so without these one long value blows
          the card open and scrolls the whole page sideways on a phone. */}
      <span className="tabular min-w-0 break-words text-right text-ink">{value}</span>
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

export function ReviewStep({ value, sections, onEdit }: ReviewStepProps) {
  const { family, accounts, income, property, goals, estate } = value;

  const collects = (s: ReviewableSection) => sections.includes(s);
  const anyReviewable = REVIEWABLE_SECTIONS.some(collects);

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
        {anyReviewable
          ? "Review what you've shared. Use Edit to go back and correct anything."
          : "You're all set — submit when you're ready."}
      </p>

      {/* ── Family ────────────────────────────────────────────────── */}
      {collects("family") && (
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
      )}

      {/* ── Accounts ──────────────────────────────────────────────── */}
      {collects("accounts") && (
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
      )}

      {/* ── Income ────────────────────────────────────────────────── */}
      {collects("income") && (
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
      )}

      {/* ── Property ──────────────────────────────────────────────── */}
      {collects("property") && (
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
      )}

      {/* ── Goals ─────────────────────────────────────────────────── */}
      {collects("goals") && (
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
      )}

      {/* ── Estate ────────────────────────────────────────────────── */}
      {collects("estate") && (
        <SectionCard title="Estate" section="estate" onEdit={onEdit}>
          {isEstateEmpty(estate) ? (
            <p className="text-[13px] text-ink-4">No estate details entered.</p>
          ) : (
            <>
              <Row label="Address" value={formatEstateAddress(estate?.residence) ?? undefined} />
              <Row
                label="Legal residence"
                value={legalResidenceLabel(estate?.residence) ?? undefined}
              />
              {FIDUCIARY_SLOTS.map((slot) => {
                const name = findFiduciary(estate?.fiduciaries, slot)?.name?.trim();
                return name ? (
                  <Row
                    key={`${slot.role}-${slot.priority}`}
                    label={fiduciarySlotLabel(slot)}
                    value={name}
                  />
                ) : null;
              })}
              <Row
                label="Who inherits"
                value={inheritanceSummaryLine(estate?.inheritance, family) ?? undefined}
              />
              <Row
                label="If one dies first"
                value={predeceasedLabel(estate?.inheritance?.ifPredeceased) ?? undefined}
              />
              {estateHousehold(family).hasChildren && (
                <Row
                  label="Children’s inheritance"
                  value={childDistributionLabel(estate?.childrenDistribution) ?? undefined}
                />
              )}
            </>
          )}
        </SectionCard>
      )}
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
