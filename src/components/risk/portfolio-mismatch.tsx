"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { RISK_LEVEL_LABELS } from "@/lib/risk-levels";
import type { BucketReadout, MismatchState } from "@/lib/risk/portfolio-mismatch";

interface PortfolioMismatchProps {
  clientId: string;
  state: MismatchState;
}

const LINK_CLS = "text-xs font-medium text-accent underline underline-offset-2";

/** Mismatch borrows the warn treatment already used by the two advisory cards
 *  on this page, so the page carries one "needs attention" signal. */
function Card({ tone, children }: { tone?: "warn"; children: ReactNode }) {
  const cls =
    tone === "warn" ? "border-warn/40 bg-warn/10" : "border-hair bg-card-2";
  return <div className={`rounded-lg border p-4 ${cls}`}>{children}</div>;
}

function BucketRows({ buckets }: { buckets: BucketReadout[] }) {
  if (buckets.length === 0) return null;
  return (
    <dl className="mt-3 space-y-1">
      {buckets.map((b) => (
        <div key={b.label} className="flex items-baseline gap-3 text-sm">
          <dt className="w-24 shrink-0 text-ink-3">{b.label}</dt>
          <dd className="text-ink-2">{b.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function EditLink({ href }: { href: string }) {
  return (
    <div className="mt-3">
      <a href={href} className={LINK_CLS}>
        Edit in Assumptions
      </a>
    </div>
  );
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

  const editHref = `/clients/${clientId}/details/assumptions?tab=growth-inflation`;

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
      <Card>
        <p className="text-sm text-ink-3">Portfolio matches this profile.</p>
        <BucketRows buckets={state.buckets} />
        <EditLink href={editHref} />
      </Card>
    );
  }

  if (state.kind === "untagged") {
    return (
      <Card>
        <p className="text-sm text-ink-2">
          No model portfolio is tagged {RISK_LEVEL_LABELS[state.level]}.{" "}
          <a href="/cma" className="text-accent underline">
            Tag one in CMA
          </a>
        </p>
        <BucketRows buckets={state.buckets} />
        <EditLink href={editHref} />
      </Card>
    );
  }

  return (
    <Card tone="warn">
      <p className="text-sm text-ink-2">
        Profile calls for {state.targetName}. The base scenario isn&apos;t using it.
      </p>
      <BucketRows buckets={state.buckets} />
      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={handleApply}
          disabled={applying}
          className="btn-primary h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
        >
          {applying ? "Applying…" : `Apply ${state.targetName} portfolio`}
        </button>
        <a href={editHref} className={LINK_CLS}>
          Edit in Assumptions
        </a>
        {error && (
          <p role="alert" className="text-xs text-crit">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
