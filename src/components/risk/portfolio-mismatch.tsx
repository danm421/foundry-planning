"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RISK_LEVEL_LABELS } from "@/lib/risk-levels";
import type { MismatchState } from "@/lib/risk/portfolio-mismatch";

interface PortfolioMismatchProps {
  clientId: string;
  state: MismatchState;
}

/**
 * Household-level statement about whether the base scenario's model portfolio
 * matches this profile's composite risk level. Manual apply only -- see the
 * "Why manual" note on the apply-portfolio route for why this never triggers
 * itself.
 */
export function PortfolioMismatch({ clientId, state }: PortfolioMismatchProps) {
  const router = useRouter();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.kind === "no_profile") return null;

  async function handleApply() {
    setApplying(true);
    setError(null);
    try {
      const res = await fetch(`/api/clients/${clientId}/risk/apply-portfolio`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Failed to apply.");
        return;
      }
      router.refresh();
    } finally {
      setApplying(false);
    }
  }

  if (state.kind === "aligned") {
    return (
      <div className="rounded-lg border border-hair bg-card-2 p-4">
        <p className="text-sm text-ink-3">Portfolio matches this profile.</p>
      </div>
    );
  }

  if (state.kind === "untagged") {
    return (
      <div className="rounded-lg border border-hair bg-card-2 p-4">
        <p className="text-sm text-ink-2">
          No model portfolio is tagged {RISK_LEVEL_LABELS[state.level]}.{" "}
          <a href="/cma" className="text-accent underline">
            Tag one in CMA
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-hair bg-card-2 p-4">
      <p className="text-sm text-ink-2">
        This household&apos;s profile is {RISK_LEVEL_LABELS[state.level]}, but the base scenario
        uses a different model portfolio.
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={handleApply}
          disabled={applying}
          className="btn-primary h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {applying ? "Applying…" : `Apply ${RISK_LEVEL_LABELS[state.level]} portfolio`}
        </button>
        {error && (
          <p role="alert" className="text-xs text-crit">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
