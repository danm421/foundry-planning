"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useScenarioPreservingHref } from "@/hooks/use-scenario-preserving-href";
import { useToast } from "@/components/toast";

type Mode = "detailed" | "map";

const LANDING: Record<Mode, string> = { map: "map", detailed: "net-worth" };

export default function DetailsViewModeToggle({
  clientId,
  mode,
}: {
  clientId: string;
  mode: Mode;
}) {
  const router = useRouter();
  const withScenario = useScenarioPreservingHref();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  // Optimistic: the segmented control should move the instant it's clicked.
  const [shown, setShown] = useState<Mode>(mode);

  async function pick(next: Mode) {
    if (next === shown || pending) return;
    const previous = shown;
    setShown(next);
    try {
      const res = await fetch(`/api/clients/${clientId}/view-mode`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
      if (!res.ok) throw new Error(await res.text());
      startTransition(() => {
        router.push(withScenario(`/clients/${clientId}/details/${LANDING[next]}`));
        router.refresh();
      });
    } catch {
      setShown(previous);
      showToast({ message: "Couldn't switch view" });
    }
  }

  return (
    <div
      role="group"
      aria-label="Details view mode"
      className="inline-flex rounded-md border border-hair bg-card-2 p-0.5"
    >
      {(["map", "detailed"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={shown === m}
          onClick={() => pick(m)}
          disabled={pending}
          className={`rounded px-3 py-1 text-xs font-medium transition-colors ${
            shown === m ? "bg-card text-accent" : "text-ink-3 hover:text-ink-2"
          }`}
        >
          {m === "map" ? "Map" : "Detailed"}
        </button>
      ))}
    </div>
  );
}
