"use client";

// Wizard step 5: name the trust, check each answer (Edit jumps back to its
// step), and see the estimated estate-tax / heirs impact before adding it. The
// wizard owns the impact hook and seeds `answers.name` when it arrives here.

import type {
  GuidedStep,
  GuidedTrustAnswers,
  GuidedTrustContext,
  PersonRef,
  PersonShare,
} from "@/lib/solver/guided-trust";
import { trustPeopleOptions } from "@/lib/solver/guided-trust";
import { fundingItemLabel } from "@/lib/solver/guided-trust-batch";
import { formatCompact } from "@/lib/format-compact";
import { kindName } from "./guided-trust-type-step";
import { StepHeader } from "./guided-trust-ui";
import type { useGuidedTrustImpact } from "./use-guided-trust-impact";

interface Props {
  answers: GuidedTrustAnswers;
  ctx: GuidedTrustContext;
  onChange: (next: GuidedTrustAnswers) => void;
  onEdit: (step: GuidedStep) => void;
  impact: ReturnType<typeof useGuidedTrustImpact>;
}

const focusRing =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60";

const refKey = (r: PersonRef) =>
  r.kind === "household" ? `h:${r.role}` : r.kind === "other_heirs" ? "o" : `${r.kind}:${r.id}`;

function peopleLine(
  shares: PersonShare[],
  group: "lifetime" | "remainder",
  answers: GuidedTrustAnswers,
  ctx: GuidedTrustContext,
): string {
  const labels = new Map(
    trustPeopleOptions(ctx.tree, answers.grantor, group).map((o) => [refKey(o.ref), o.label]),
  );
  const parts = shares.map((s) => ({
    label: labels.get(refKey(s.person)) ?? "Someone",
    pct: s.percentage,
  }));
  if (parts.length === 1) return parts[0].label;
  return parts.map((p) => `${p.label} ${p.pct}%`).join(" · ");
}

function powersLine(a: GuidedTrustAnswers): string {
  const on = [
    a.isGrantor && "Grantor trust",
    a.crummeyPowers && "Crummey",
    a.accessibleToClient && "Household can draw on it",
  ].filter(Boolean);
  return on.length ? on.join(" · ") : "None";
}

function setupLine(a: GuidedTrustAnswers, ctx: GuidedTrustContext): string {
  const s = a.splitInterest;
  if (!s) return "Not set up yet";
  const snap = s.snapshot;
  const payout =
    snap.payoutType === "unitrust"
      ? `${snap.payoutPercent ?? 0}% unitrust`
      : `$${Math.round(snap.payoutAmount ?? 0).toLocaleString("en-US")} annuity`;
  const term = {
    years: `${snap.termYears} years`,
    single_life: "Life",
    joint_life: "Joint lives",
    shorter_of_years_or_life: `Shorter of ${snap.termYears} years or life`,
  }[snap.termType];
  const charity =
    s.newCharity?.id === snap.charityId
      ? s.newCharity.name
      : ctx.tree.externalBeneficiaries?.find((x) => x.id === snap.charityId)?.name;
  return [payout, term, charity].filter(Boolean).join(" · ");
}

function accountsLine(a: GuidedTrustAnswers, ctx: GuidedTrustContext): string {
  const ids = a.revocableAccountIds;
  if (ids.length > 3) return `${ids.length} accounts`;
  return ids.map((id) => ctx.tree.accounts.find((x) => x.id === id)?.name ?? "Account").join(", ");
}

function Line({
  label,
  value,
  step,
  onEdit,
}: {
  label: string;
  value: string;
  step: GuidedStep;
  onEdit: (step: GuidedStep) => void;
}) {
  return (
    <li className="flex items-baseline gap-3 border-b border-hair py-1.5 text-[12.5px] last:border-b-0">
      <span className="w-24 shrink-0 text-ink-3">{label}</span>
      <span className="min-w-0 flex-1 truncate text-ink">{value}</span>
      <button
        type="button"
        aria-label={`Edit ${label}`}
        onClick={() => onEdit(step)}
        className={`rounded px-1 text-[12px] text-accent hover:underline ${focusRing}`}
      >
        Edit
      </button>
    </li>
  );
}

function ImpactRow({ label, before, after, lowerIsBetter }: {
  label: string;
  before: number | null;
  after: number | null;
  lowerIsBetter: boolean;
}) {
  const known = before != null && after != null;
  const delta = known ? after - before : 0;
  const good = lowerIsBetter ? delta < 0 : delta > 0;
  const tone = delta === 0 ? "text-ink-3" : good ? "text-good" : "text-crit";
  return (
    <div className="flex items-baseline justify-between gap-3 py-1 text-[12.5px]">
      <span className="text-ink-2">{label}</span>
      <span className="flex items-baseline gap-2 tabular-nums">
        <span className="text-ink">
          {known ? `${formatCompact(before)} → ${formatCompact(after)}` : "—"}
        </span>
        {known ? (
          <span className={tone}>{`${delta > 0 ? "+" : ""}${formatCompact(delta)}`}</span>
        ) : null}
      </span>
    </div>
  );
}

function ImpactPanel({ impact }: { impact: Props["impact"] }) {
  return (
    <div className="mt-3 rounded-[var(--radius-sm)] border border-hair border-l-[3px] border-l-accent bg-card-2 px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-[0.12em] text-ink-4">Estimated impact</div>
      {impact.status === "ready" ? (
        <>
          <ImpactRow
            label="Estate taxes & costs (both deaths)"
            before={impact.before.taxesAndCosts}
            after={impact.after.taxesAndCosts}
            lowerIsBetter
          />
          <ImpactRow
            label={`Total to heirs${impact.after.finalDeathYear != null ? ` · ${impact.after.finalDeathYear}` : ""}`}
            before={impact.before.toHeirs}
            after={impact.after.toHeirs}
            lowerIsBetter={false}
          />
        </>
      ) : impact.status === "error" ? (
        <p className="py-1 text-[12.5px] text-ink-3">
          Couldn&apos;t estimate the impact. Add the trust and check the Total to Heirs tile.
        </p>
      ) : (
        <div data-testid="impact-skeleton" aria-busy="true" className="space-y-2 py-1.5">
          <div className="h-3 w-3/4 animate-pulse rounded bg-hair" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-hair" />
        </div>
      )}
    </div>
  );
}

export function GuidedTrustReviewStep({ answers, ctx, onChange, onEdit, impact }: Props) {
  const { kind, grantor } = answers;
  const grantorName =
    grantor === "spouse" ? (ctx.tree.client.spouseName ?? "Spouse") : ctx.tree.client.firstName;
  const split = kind === "crt" || kind === "clt";

  return (
    <div>
      <StepHeader title="Review" subtitle="Check the answers, then add the trust." />

      <div className="mb-2 flex items-center gap-3">
        <label htmlFor="guided-trust-name" className="w-24 shrink-0 text-[12.5px] text-ink-3">
          Name
        </label>
        <input
          id="guided-trust-name"
          value={answers.name}
          onChange={(e) => onChange({ ...answers, name: e.target.value })}
          className={`h-8 min-w-0 flex-1 rounded-[var(--radius-sm)] border border-hair-2 bg-card px-2 text-[13px] text-ink ${focusRing}`}
        />
      </div>

      <ul aria-label="Your answers" className="border-y border-hair">
        <Line label="Type" value={kindName(kind)} step="type" onEdit={onEdit} />
        {kind === "revocable" ? (
          <Line label="Accounts" value={accountsLine(answers, ctx)} step="accounts" onEdit={onEdit} />
        ) : (
          <>
            {ctx.isMarried ? (
              <Line label="Grantor" value={grantorName} step="type" onEdit={onEdit} />
            ) : null}
            {split ? (
              <>
                <Line label="Setup" value={setupLine(answers, ctx)} step="setup" onEdit={onEdit} />
                {kind === "clt" ? (
                  <Line
                    label="Gets what's left"
                    value={peopleLine(answers.remainder, "remainder", answers, ctx)}
                    step="setup"
                    onEdit={onEdit}
                  />
                ) : null}
              </>
            ) : (
              <>
                <Line
                  label="Benefits now"
                  value={peopleLine(answers.lifetime, "lifetime", answers, ctx)}
                  step="people"
                  onEdit={onEdit}
                />
                <Line
                  label="Gets what's left"
                  value={peopleLine(answers.remainder, "remainder", answers, ctx)}
                  step="people"
                  onEdit={onEdit}
                />
                <Line label="Powers" value={powersLine(answers)} step="powers" onEdit={onEdit} />
                <Line
                  label="Funding"
                  value={
                    answers.funding.length === 0
                      ? "Not funded yet"
                      : answers.funding.map((f) => fundingItemLabel(f, ctx.tree)).join(" · ")
                  }
                  step="funding"
                  onEdit={onEdit}
                />
              </>
            )}
          </>
        )}
      </ul>

      <ImpactPanel impact={impact} />
    </div>
  );
}
