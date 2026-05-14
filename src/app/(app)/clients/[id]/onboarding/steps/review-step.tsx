"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { STEPS } from "@/lib/onboarding/steps";
import type { StepStatus } from "@/lib/onboarding/types";

interface ReviewStepProps {
  clientId: string;
  statuses: StepStatus[];
  alreadyFinished: boolean;
}

export default function ReviewStep({ clientId, statuses, alreadyFinished }: ReviewStepProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const blockers = statuses
    .filter((s) => s.slug !== "review" && s.kind !== "complete" && s.kind !== "skipped");

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
    <div className="space-y-4">
      <ul className="divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/30">
        {STEPS.filter((s) => s.slug !== "review").map((def) => {
          const st = statuses.find((s) => s.slug === def.slug)!;
          const badge =
            st.kind === "complete"
              ? { text: "Complete", tone: "text-emerald-300" }
              : st.kind === "skipped"
              ? { text: "Skipped", tone: "text-gray-400" }
              : st.kind === "in_progress"
              ? { text: "In progress", tone: "text-amber-300" }
              : { text: "Not started", tone: "text-gray-500" };
          return (
            <li key={def.slug} className="flex items-center justify-between px-4 py-3">
              <div>
                <Link
                  href={`/clients/${clientId}/onboarding/${def.slug}`}
                  className="text-sm font-medium text-gray-100 hover:underline"
                >
                  {def.label}
                </Link>
                {st.gaps.length > 0 && (
                  <p className="text-xs text-gray-500">{st.gaps.slice(0, 2).join(" · ")}</p>
                )}
              </div>
              <span className={`text-xs font-medium ${badge.tone}`}>{badge.text}</span>
            </li>
          );
        })}
      </ul>

      {alreadyFinished && (
        <p className="text-xs text-emerald-300">Onboarding already finished. You can revisit any step or re-finish.</p>
      )}

      {error && <p className="text-sm text-red-400">{error}</p>}

      <div className="flex items-center justify-end gap-3">
        <Link href={`/clients/${clientId}`} className="text-sm text-gray-400 hover:text-gray-200">
          Save &amp; exit
        </Link>
        <button
          type="button"
          onClick={onFinish}
          disabled={submitting || blockers.length > 0}
          title={blockers.length > 0 ? `Resolve ${blockers.length} remaining step${blockers.length === 1 ? "" : "s"} first` : undefined}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-on hover:bg-accent-deep disabled:opacity-60"
        >
          {submitting ? "Finishing…" : "Finish onboarding"}
        </button>
      </div>
    </div>
  );
}
