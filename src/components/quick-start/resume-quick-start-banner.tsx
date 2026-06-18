"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ReactElement } from "react";
import { useClientAccess } from "@/components/client-access-provider";
import { SparkleIcon } from "@/components/icons";
import { qsStepLabel } from "@/lib/quick-start/state";
import type { QsStepSlug } from "@/lib/quick-start/steps";

interface Props {
  clientId: string;
  step: QsStepSlug;
}

export default function ResumeQuickStartBanner({ clientId, step }: Props): ReactElement | null {
  const { permission } = useClientAccess();
  const canEdit = permission === "edit";
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  if (hidden) return null;

  async function dismiss() {
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${clientId}/quick-start`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dismissed: true }),
      });
      if (!res.ok) throw new Error(`Dismiss failed: ${res.status}`);
      setHidden(true);
      router.refresh();
    } catch {
      setBusy(false);
    }
  }

  return (
    <section className="flex items-center gap-4 rounded border border-accent/30 bg-accent/8 px-[var(--pad-card)] py-4">
      <span className="text-accent">
        <SparkleIcon width={22} height={22} />
      </span>
      <div className="flex flex-1 flex-col gap-0.5">
        <p className="text-[14px] font-semibold text-ink">Quick Start in progress</p>
        <p className="text-[12.5px] text-ink-3">
          Pick up where you left off — {qsStepLabel(step)}.
        </p>
      </div>
      {canEdit && (
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="text-[12px] font-medium text-ink-3 hover:text-ink disabled:opacity-50"
        >
          Dismiss
        </button>
      )}
      <Link
        href={`/clients/${clientId}/quick-start?step=${step}`}
        className="rounded-sm bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-on hover:bg-accent-ink"
      >
        Resume Quick Start
      </Link>
    </section>
  );
}
