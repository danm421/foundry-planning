"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useWalkthrough } from "@/components/forge/walkthrough-context";
import { CheckCircleIcon } from "@/components/icons";
import type { FirstRunCard as FirstRunCardState } from "@/lib/onboarding/advisor-first-run";

async function patchFirstRun(action: "start" | "dismiss") {
  await fetch("/api/onboarding/first-run", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action }),
  });
}

export function FirstRunCard({ card }: { card: FirstRunCardState }) {
  const router = useRouter();
  const { start } = useWalkthrough();
  const [dismissed, setDismissed] = useState(false);
  const [, startTransition] = useTransition();

  if (card.kind === "hidden" || dismissed) return null;

  // Optimistic: the card is gone before the PATCH resolves. A failed write
  // only means it returns on the next load, which is recoverable and better
  // than blocking the click.
  function dismiss() {
    setDismissed(true);
    void patchFirstRun("dismiss").then(() => startTransition(() => router.refresh()));
  }

  function beginSetup() {
    void patchFirstRun("start");
    start("first-run-setup");
  }

  return (
    <section
      aria-labelledby="first-run-heading"
      className="rounded-[var(--radius)] border border-hair bg-card px-[var(--pad-card)] py-4"
    >
      {card.kind === "done" ? (
        <>
          <div className="flex items-start gap-2.5">
            <CheckCircleIcon
              width={18}
              height={18}
              className="mt-0.5 shrink-0 text-good"
              aria-hidden="true"
            />
            <div>
              <h2 id="first-run-heading" className="text-[15px] font-semibold text-ink">
                Your first plan is live
              </h2>
              <p className="mt-0.5 text-[13px] text-ink-3">
                The projection is built and ready to explore.
              </p>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-4">
            <Link
              href={`/clients/${card.clientId}/solver`}
              className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on transition-colors hover:bg-accent-ink"
            >
              View projection
            </Link>
            <button
              type="button"
              onClick={dismiss}
              className="text-[13px] text-ink-3 transition-colors hover:text-ink-2"
            >
              Dismiss
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 id="first-run-heading" className="text-[15px] font-semibold text-ink">
            {card.kind === "no_client"
              ? "Set up your first plan"
              : `Finish setting up ${card.householdName}`}
          </h2>
          <p className="mt-1 max-w-[60ch] text-[13px] leading-relaxed text-ink-3">
            Add a household, then walk through their finances step by step. Bring
            statements and we&apos;ll read them for you — or type it all in.
          </p>

          <ol className="mt-3.5 space-y-2">
            <ChecklistItem done={card.kind === "in_progress"} label="Create your first household" />
            <ChecklistItem done={false} label="Build their plan">
              {card.kind === "in_progress" && (
                <div className="mt-1.5 flex items-center gap-2.5">
                  <div
                    role="progressbar"
                    aria-valuenow={card.completedSteps}
                    aria-valuemin={0}
                    aria-valuemax={card.totalSteps}
                    aria-label="Wizard progress"
                    className="h-1.5 w-40 overflow-hidden rounded-full bg-card-2"
                  >
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${(card.completedSteps / card.totalSteps) * 100}%` }}
                    />
                  </div>
                  <span className="text-[12px] tabular-nums text-ink-3">
                    Step {card.completedSteps} of {card.totalSteps}
                  </span>
                </div>
              )}
            </ChecklistItem>
          </ol>

          <div className="mt-4 flex items-center gap-4">
            {card.kind === "no_client" ? (
              <button
                type="button"
                onClick={beginSetup}
                className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on transition-colors hover:bg-accent-ink"
              >
                Start guided setup
              </button>
            ) : (
              <Link
                href={`/clients/${card.clientId}/onboarding`}
                className="inline-flex h-9 items-center rounded-[var(--radius-sm)] bg-accent px-4 text-[13px] font-semibold text-accent-on transition-colors hover:bg-accent-ink"
              >
                Resume setup
              </Link>
            )}
            <button
              type="button"
              onClick={dismiss}
              className="text-[13px] text-ink-3 transition-colors hover:text-ink-2"
            >
              {card.kind === "no_client" ? "I'll explore first" : "Dismiss"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

function ChecklistItem({
  done,
  label,
  children,
}: {
  done: boolean;
  label: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="text-[13px]">
      <span className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            done ? "border-good bg-good/15 text-good" : "border-hair text-transparent"
          }`}
        >
          <svg
            viewBox="0 0 10 10"
            className="h-2.5 w-2.5"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path d="M1.5 5.5L4 8l4.5-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className={done ? "text-ink-3 line-through" : "text-ink-2"}>{label}</span>
        <span className="sr-only">{done ? " (done)" : " (not started)"}</span>
      </span>
      {children}
    </li>
  );
}
