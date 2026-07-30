"use client";

import {
  ArrowRightIcon,
  ClipboardCheckIcon,
  FlowIcon,
  SparkleIcon,
} from "@/components/icons";

/**
 * The four ways an advisor can start a planning client. Shared by the
 * `/clients/new` step-2 picker and the post-create prompt on `/crm/new`, so
 * the two pickers can't drift apart.
 */
export type StartPath = "quick" | "detailed" | "import" | "empty";

export interface StartPathDef {
  id: StartPath;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}

export const START_PATHS: StartPathDef[] = [
  {
    id: "quick",
    title: "Quick Start",
    subtitle: "Fast retirement intake",
    icon: <FlowIcon width={18} height={18} />,
  },
  {
    id: "detailed",
    title: "Detailed setup",
    subtitle: "Full guided wizard",
    icon: <ClipboardCheckIcon width={18} height={18} />,
  },
  {
    id: "import",
    title: "AI import",
    subtitle: "Extract from documents",
    icon: <SparkleIcon width={18} height={18} />,
  },
  {
    id: "empty",
    title: "Empty client",
    subtitle: "Skip the wizard, start blank",
    icon: <ArrowRightIcon width={18} height={18} />,
  },
];

/** Narrows an untrusted value (e.g. a `?path=` query param) to a StartPath. */
export function isStartPath(value: string | null | undefined): value is StartPath {
  return START_PATHS.some((p) => p.id === value);
}

export function PathCard({
  icon,
  title,
  subtitle,
  selected,
  onSelect,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  /** Omit for cards that navigate rather than toggle (e.g. the post-create
   * prompt) — undefined drops `aria-pressed` so they don't announce as toggle
   * buttons. */
  selected?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex items-start gap-3 rounded-[var(--radius-sm)] border px-3.5 py-3 text-left transition-colors ${
        selected
          ? "border-accent bg-accent/10"
          : "border-hair bg-card-2 hover:border-ink-4"
      }`}
    >
      <span
        className={`mt-0.5 shrink-0 ${selected ? "text-accent-ink" : "text-ink-3"}`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-ink">{title}</span>
        <span className="block text-[12px] text-ink-3">{subtitle}</span>
      </span>
    </button>
  );
}
