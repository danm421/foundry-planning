"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { STEPS, nextStep, prevStep } from "@/lib/onboarding/steps";
import type { StepSlug, StepStatus } from "@/lib/onboarding/types";

interface OnboardingShellProps {
  clientId: string;
  activeStep: StepSlug;
  statuses: StepStatus[];
  children: React.ReactNode;
}

export default function OnboardingShell({ clientId, activeStep, statuses, children }: OnboardingShellProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const def = STEPS.find((s) => s.slug === activeStep)!;
  const activeStatus = statuses.find((s) => s.slug === activeStep)!;
  const prev = prevStep(activeStep);
  const next = nextStep(activeStep);

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
      <Stepper activeStep={activeStep} statuses={statuses} onClick={navTo} />

      <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-6">
        <h1 className="mb-1 text-xl font-semibold text-gray-100">{def.label}</h1>
        {activeStatus.gaps.length > 0 && activeStep !== "review" && (
          <p className="mb-4 text-xs text-gray-400">
            {activeStatus.gaps.length} item{activeStatus.gaps.length === 1 ? "" : "s"} remaining
          </p>
        )}
        <div className="mt-4">{children}</div>
      </div>

      <footer className="flex items-center justify-between">
        <Link
          href={`/clients/${clientId}`}
          className="text-sm text-gray-400 hover:text-gray-200"
        >
          Save &amp; exit
        </Link>
        <div className="flex items-center gap-2">
          {prev && (
            <button
              type="button"
              onClick={() => navTo(prev)}
              className="rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-200 hover:bg-gray-800"
            >
              Back
            </button>
          )}
          {def.skippable && activeStatus.kind !== "complete" && activeStep !== "review" && (
            <button
              type="button"
              onClick={onSkip}
              disabled={busy}
              className="rounded-md border border-gray-700 px-4 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-60"
            >
              Skip
            </button>
          )}
          {next && (
            <button
              type="button"
              onClick={() => navTo(next)}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-deep"
            >
              Next
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

interface StepperProps {
  activeStep: StepSlug;
  statuses: StepStatus[];
  onClick: (slug: StepSlug) => void;
}

function Stepper({ activeStep, statuses, onClick }: StepperProps) {
  return (
    <ol className="flex flex-wrap gap-2">
      {STEPS.map((def, idx) => {
        const status = statuses.find((s) => s.slug === def.slug)!;
        const isActive = def.slug === activeStep;
        const tone =
          status.kind === "complete"
            ? "border-emerald-700 bg-emerald-900/30 text-emerald-200"
            : status.kind === "skipped"
            ? "border-gray-700 bg-gray-900 text-gray-500"
            : status.kind === "in_progress"
            ? "border-amber-700 bg-amber-900/20 text-amber-200"
            : "border-gray-700 bg-gray-900 text-gray-400";
        const ring = isActive ? "ring-2 ring-accent" : "";
        return (
          <li key={def.slug}>
            <button
              type="button"
              onClick={() => onClick(def.slug)}
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium ${tone} ${ring}`}
              aria-current={isActive ? "step" : undefined}
            >
              <span className="font-mono text-[10px] text-gray-500">{idx + 1}</span>
              {def.label}
              {status.kind === "complete" && <span aria-hidden="true">✓</span>}
              {status.kind === "skipped" && <span aria-hidden="true">–</span>}
            </button>
          </li>
        );
      })}
    </ol>
  );
}
