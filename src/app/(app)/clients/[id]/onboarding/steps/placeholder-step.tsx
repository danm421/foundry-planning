import Link from "next/link";
import type { StepSlug } from "@/lib/onboarding/types";
import { STEPS } from "@/lib/onboarding/steps";
import { ExternalLinkIcon, SparkleIcon } from "@/components/icons";

interface PlaceholderStepProps {
  clientId: string;
  slug: StepSlug;
  tabHref: string;
}

export default function PlaceholderStep({ slug, tabHref }: PlaceholderStepProps) {
  const def = STEPS.find((s) => s.slug === slug)!;
  return (
    <div className="flex flex-col items-start gap-5 rounded-[var(--radius-sm)] border border-dashed border-hair-2 bg-card-2/40 px-5 py-6 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="flex items-start gap-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-sm)] border border-hair bg-paper text-ink-3"
          aria-hidden="true"
        >
          <SparkleIcon width={16} height={16} />
        </span>
        <div className="space-y-1">
          <p className="text-[14px] font-medium text-ink">
            {def.label} editing isn&apos;t in the walkthrough yet
          </p>
          <p className="max-w-prose text-[13px] leading-relaxed text-ink-3">
            Open the standard {def.label.toLowerCase()} editor to enter this data. When you come
            back, this step&apos;s status updates automatically.
          </p>
        </div>
      </div>
      <Link
        href={tabHref}
        className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-3 text-[13px] font-medium text-ink-2 transition-colors hover:border-hair-2 hover:bg-card-hover hover:text-ink"
      >
        Open {def.label} editor
        <ExternalLinkIcon width={14} height={14} aria-hidden="true" />
      </Link>
    </div>
  );
}
