"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { STEPS, nextStep, prevStep, stepIndex } from "@/lib/onboarding/steps";
import type { StepIconKey } from "@/lib/onboarding/steps";
import type { StepSlug, StepStatus, StepStatusKind } from "@/lib/onboarding/types";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckIcon,
  ClipboardCheckIcon,
  BuildingIcon,
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

interface OnboardingShellProps {
  clientId: string;
  activeStep: StepSlug;
  statuses: StepStatus[];
  children: React.ReactNode;
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
  review: ClipboardCheckIcon,
};

export default function OnboardingShell({ clientId, activeStep, statuses, children }: OnboardingShellProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const def = STEPS.find((s) => s.slug === activeStep)!;
  const activeStatus = statuses.find((s) => s.slug === activeStep)!;
  const prev = prevStep(activeStep);
  const next = nextStep(activeStep);
  const activeIdx = stepIndex(activeStep);

  // Completion progress: steps fully done (complete or explicitly skipped).
  const totalCountable = STEPS.length - 1; // exclude review
  const doneCount = statuses.filter(
    (s) => s.slug !== "review" && (s.kind === "complete" || s.kind === "skipped"),
  ).length;
  const progressPct = Math.round((doneCount / totalCountable) * 100);

  const Icon = STEP_ICONS[def.icon];

  async function patchLastVisited(slug: StepSlug) {
    try {
      await fetch(`/api/clients/${clientId}/onboarding`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lastStepVisited: slug }),
      });
    } catch {
      // Non-blocking — wizard is still usable without this.
    }
  }

  async function onSkip() {
    if (!def.skippable) return;
    setBusy(true);
    try {
      const existing = statuses.filter((s) => s.kind === "skipped").map((s) => s.slug);
      const skipped = Array.from(new Set([...existing, activeStep]));
      await fetch(`/api/clients/${clientId}/onboarding`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skippedSteps: skipped }),
      });
      if (next) router.push(`/clients/${clientId}/onboarding/${next}`);
    } finally {
      setBusy(false);
    }
  }

  function navTo(slug: StepSlug) {
    patchLastVisited(slug);
    router.push(`/clients/${clientId}/onboarding/${slug}`);
  }

  return (
    <div className="space-y-6">
      {/* Top bar — eyebrow + progress */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-[12px] uppercase tracking-[0.12em] text-ink-3">
          <span className="text-accent-ink">Guided setup</span>
          <span className="text-ink-4">·</span>
          <span className="tabular">Step {activeIdx + 1} of {STEPS.length}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden h-1.5 w-40 overflow-hidden rounded-full bg-card-2 sm:block">
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <span className="tabular text-[12px] font-medium text-ink-2">{progressPct}%</span>
        </div>
      </div>

      {/* Stepper */}
      <Stepper activeStep={activeStep} statuses={statuses} onClick={navTo} />

      {/* Step card */}
      <section className="overflow-hidden rounded-[10px] border border-hair bg-card">
        {/* Header */}
        <header className="flex items-start gap-4 border-b border-hair px-6 py-5">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] border border-accent/30 bg-accent/10 text-accent-ink"
            aria-hidden="true"
          >
            <Icon width={20} height={20} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-semibold leading-tight text-ink">{def.label}</h1>
            <p className="mt-0.5 text-[13px] leading-snug text-ink-3">{def.description}</p>
          </div>
          <StatusPill status={activeStatus} />
        </header>

        {/* Gaps strip — only when there are remaining items */}
        {activeStatus.gaps.length > 0 && activeStep !== "review" && (
          <div className="border-b border-hair bg-card-2/40 px-6 py-2.5 text-[12px] text-ink-3">
            <span className="font-medium text-ink-2">
              {activeStatus.gaps.length} item{activeStatus.gaps.length === 1 ? "" : "s"} remaining
            </span>
            <span className="text-ink-4">  ·  </span>
            <span>{activeStatus.gaps.slice(0, 3).join(" · ")}</span>
            {activeStatus.gaps.length > 3 && <span className="text-ink-4"> +{activeStatus.gaps.length - 3} more</span>}
          </div>
        )}

        {/* Step body */}
        <div className="px-6 py-6">{children}</div>
      </section>

      {/* Footer */}
      <footer className="flex flex-col-reverse items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link
          href={`/clients/${clientId}`}
          className="text-[13px] text-ink-3 transition-colors hover:text-ink-2 sm:py-2"
        >
          Save &amp; exit
        </Link>
        <div className="flex items-center justify-end gap-2">
          {prev && (
            <button
              type="button"
              onClick={() => navTo(prev)}
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:bg-card-hover hover:text-ink"
            >
              <ArrowLeftIcon width={14} height={14} aria-hidden="true" />
              Back
            </button>
          )}
          {def.skippable && activeStatus.kind !== "complete" && activeStep !== "review" && (
            <button
              type="button"
              onClick={onSkip}
              disabled={busy}
              className="h-9 rounded-[var(--radius-sm)] px-3 text-[13px] font-medium text-ink-3 transition-colors hover:bg-card-2 hover:text-ink-2 disabled:opacity-60"
            >
              Skip this step
            </button>
          )}
          {next && (
            <button
              type="button"
              onClick={() => navTo(next)}
              className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors hover:bg-accent-deep"
            >
              Next
              <ArrowRightIcon width={14} height={14} aria-hidden="true" />
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Stepper                                                                    */
/* -------------------------------------------------------------------------- */

interface StepperProps {
  activeStep: StepSlug;
  statuses: StepStatus[];
  onClick: (slug: StepSlug) => void;
}

function Stepper({ activeStep, statuses, onClick }: StepperProps) {
  return (
    <nav aria-label="Onboarding steps" className="relative">
      <ol
        className="relative grid gap-x-1 gap-y-3"
        style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}
      >
        {/* Connector line — runs behind the circles, full width minus first/last half */}
        <li
          aria-hidden="true"
          className="pointer-events-none absolute left-0 right-0 top-[15px] h-px bg-hair"
          style={{ marginLeft: `calc(${100 / STEPS.length / 2}% )`, marginRight: `calc(${100 / STEPS.length / 2}% )` }}
        />
        {STEPS.map((def, idx) => {
          const status = statuses.find((s) => s.slug === def.slug)!;
          const isActive = def.slug === activeStep;
          return (
            <li key={def.slug} className="relative flex flex-col items-center text-center">
              <button
                type="button"
                onClick={() => onClick(def.slug)}
                aria-current={isActive ? "step" : undefined}
                aria-label={`Step ${idx + 1}: ${def.label}`}
                className="group flex flex-col items-center gap-2 outline-none focus-visible:[&>span:first-child]:ring-2 focus-visible:[&>span:first-child]:ring-accent/50 focus-visible:[&>span:first-child]:ring-offset-2 focus-visible:[&>span:first-child]:ring-offset-paper"
              >
                <StepCircle index={idx} kind={status.kind} isActive={isActive} />
                <span
                  className={`text-[11px] font-medium leading-tight transition-colors ${
                    isActive
                      ? "text-ink"
                      : status.kind === "complete"
                      ? "text-ink-2"
                      : status.kind === "skipped"
                      ? "text-ink-4"
                      : "text-ink-3 group-hover:text-ink-2"
                  }`}
                >
                  {def.label}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

function StepCircle({
  index,
  kind,
  isActive,
}: {
  index: number;
  kind: StepStatusKind;
  isActive: boolean;
}) {
  // Visual treatment per state — kept in one place so the matrix is readable.
  const isComplete = kind === "complete";
  const isSkipped = kind === "skipped";
  const isInProgress = kind === "in_progress";

  const base =
    "relative z-10 flex h-[30px] w-[30px] items-center justify-center rounded-full text-[11px] font-semibold tabular transition-all";

  let cls: string;
  if (isActive) {
    cls = "bg-accent text-accent-on shadow-[0_0_0_4px_rgba(245,158,11,0.18)]";
  } else if (isComplete) {
    cls = "bg-accent/15 text-accent-ink border border-accent/40";
  } else if (isInProgress) {
    cls = "border border-accent/50 bg-card-2 text-accent-ink";
  } else if (isSkipped) {
    cls = "border border-dashed border-hair-2 bg-paper text-ink-4";
  } else {
    cls = "border border-hair bg-card-2 text-ink-3";
  }

  return (
    <span className={`${base} ${cls}`} aria-hidden="true">
      {isComplete ? (
        <CheckIcon width={14} height={14} />
      ) : isSkipped ? (
        <MinusIcon width={14} height={14} />
      ) : (
        <span>{index + 1}</span>
      )}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Status pill                                                                */
/* -------------------------------------------------------------------------- */

function StatusPill({ status }: { status: StepStatus }) {
  if (status.kind === "complete") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/30 bg-accent/10 px-2.5 py-1 text-[11px] font-medium text-accent-ink">
        <CheckIcon width={12} height={12} aria-hidden="true" />
        Complete
      </span>
    );
  }
  if (status.kind === "skipped") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-dashed border-hair-2 px-2.5 py-1 text-[11px] font-medium text-ink-4">
        <MinusIcon width={12} height={12} aria-hidden="true" />
        Skipped
      </span>
    );
  }
  if (status.kind === "in_progress") {
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-accent/40 px-2.5 py-1 text-[11px] font-medium text-accent-ink">
        <span className="h-1.5 w-1.5 rounded-full bg-accent-ink" aria-hidden="true" />
        In progress
      </span>
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-hair px-2.5 py-1 text-[11px] font-medium text-ink-3">
      Not started
    </span>
  );
}
