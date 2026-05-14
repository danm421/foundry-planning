"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { STEPS } from "@/lib/onboarding/steps";
import type { StepIconKey } from "@/lib/onboarding/steps";
import type { StepStatus } from "@/lib/onboarding/types";
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BuildingIcon,
  CheckCircleIcon,
  CheckIcon,
  CircleIcon,
  CreditCardIcon,
  FlowIcon,
  HomeIcon,
  MinusIcon,
  ScrollIcon,
  ShieldIcon,
  SlidersIcon,
  UsersIcon,
  WalletIcon,
} from "@/components/icons";

interface ReviewStepProps {
  clientId: string;
  statuses: StepStatus[];
  alreadyFinished: boolean;
}

type IconComponent = (props: { width?: number; height?: number; className?: string }) => React.ReactElement;

const STEP_ICONS: Record<StepIconKey, IconComponent> = {
  household: HomeIcon,
  family: UsersIcon,
  entities: BuildingIcon,
  accounts: WalletIcon,
  liabilities: CreditCardIcon,
  "cash-flow": FlowIcon,
  insurance: ShieldIcon,
  estate: ScrollIcon,
  assumptions: SlidersIcon,
  review: CheckCircleIcon,
};

export default function ReviewStep({ clientId, statuses, alreadyFinished }: ReviewStepProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reviewable = STEPS.filter((s) => s.slug !== "review");
  const blockers = statuses.filter(
    (s) => s.slug !== "review" && s.kind !== "complete" && s.kind !== "skipped",
  );
  const completeCount = statuses.filter((s) => s.slug !== "review" && s.kind === "complete").length;
  const skippedCount = statuses.filter((s) => s.slug !== "review" && s.kind === "skipped").length;
  const remainingCount = blockers.length;

  async function onFinish() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/onboarding/finish`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `Finish failed (${res.status})`);
      }
      router.push(`/clients/${clientId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Finish failed");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        <SummaryTile
          label="Complete"
          value={completeCount}
          tone="accent"
          total={reviewable.length}
        />
        <SummaryTile label="Skipped" value={skippedCount} tone="muted" />
        <SummaryTile label="Remaining" value={remainingCount} tone={remainingCount > 0 ? "warn" : "muted"} />
      </div>

      {/* Step checklist */}
      <ul className="divide-y divide-hair overflow-hidden rounded-[var(--radius-sm)] border border-hair bg-card-2/40">
        {reviewable.map((def) => {
          const st = statuses.find((s) => s.slug === def.slug)!;
          const Icon = STEP_ICONS[def.icon];
          return (
            <li key={def.slug}>
              <Link
                href={`/clients/${clientId}/onboarding/${def.slug}`}
                className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-card-hover"
              >
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-hair bg-paper text-ink-3 transition-colors group-hover:text-ink-2"
                  aria-hidden="true"
                >
                  <Icon width={15} height={15} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-ink">{def.label}</div>
                  {st.gaps.length > 0 && (
                    <div className="mt-0.5 truncate text-[12px] text-ink-3">
                      {st.gaps.slice(0, 3).join(" · ")}
                      {st.gaps.length > 3 && <span className="text-ink-4"> +{st.gaps.length - 3}</span>}
                    </div>
                  )}
                </div>
                <RowStatus status={st} />
              </Link>
            </li>
          );
        })}
      </ul>

      {/* Banners */}
      {alreadyFinished && (
        <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-accent/30 bg-accent/10 px-3 py-2.5 text-[13px] text-accent-ink">
          <CheckCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>Onboarding is already finished. You can revisit any step or re-finish below.</span>
        </div>
      )}
      {blockers.length > 0 && !alreadyFinished && (
        <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-warn/30 bg-warn/10 px-3 py-2.5 text-[13px] text-warn">
          <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            Resolve {blockers.length} remaining step{blockers.length === 1 ? "" : "s"} before finishing
            — or mark them skipped if they don&apos;t apply.
          </span>
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-crit/30 bg-crit/10 px-3 py-2.5 text-[13px] text-crit"
        >
          <AlertCircleIcon width={16} height={16} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* Finish CTA */}
      <div className="flex items-center justify-end gap-3 pt-1">
        <Link href={`/clients/${clientId}`} className="text-[13px] text-ink-3 transition-colors hover:text-ink-2">
          Save &amp; exit
        </Link>
        <button
          type="button"
          onClick={onFinish}
          disabled={submitting || blockers.length > 0}
          title={
            blockers.length > 0
              ? `Resolve ${blockers.length} remaining step${blockers.length === 1 ? "" : "s"} first`
              : undefined
          }
          className="inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-5 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-deep disabled:opacity-60"
        >
          {submitting ? "Finishing…" : alreadyFinished ? "Re-finish onboarding" : "Finish onboarding"}
          <ArrowRightIcon width={14} height={14} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Summary tile                                                               */
/* -------------------------------------------------------------------------- */

function SummaryTile({
  label,
  value,
  total,
  tone,
}: {
  label: string;
  value: number;
  total?: number;
  tone: "accent" | "warn" | "muted";
}) {
  const toneCls =
    tone === "accent"
      ? "text-accent-ink"
      : tone === "warn"
      ? "text-warn"
      : "text-ink-2";
  return (
    <div className="rounded-[var(--radius-sm)] border border-hair bg-card-2/40 px-4 py-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-4">{label}</div>
      <div className={`mt-1 text-[22px] font-semibold tabular leading-none ${toneCls}`}>
        {value}
        {typeof total === "number" && <span className="text-[14px] text-ink-4"> / {total}</span>}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Per-row status badge                                                       */
/* -------------------------------------------------------------------------- */

function RowStatus({ status }: { status: StepStatus }) {
  if (status.kind === "complete") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-accent-ink">
        <CheckIcon width={14} height={14} aria-hidden="true" />
        Complete
      </span>
    );
  }
  if (status.kind === "skipped") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-ink-4">
        <MinusIcon width={14} height={14} aria-hidden="true" />
        Skipped
      </span>
    );
  }
  if (status.kind === "in_progress") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-warn">
        <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" />
        In progress
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-ink-4">
      <CircleIcon width={14} height={14} aria-hidden="true" />
      Not started
    </span>
  );
}
