import Link from "next/link";
import type { StepSlug } from "@/lib/onboarding/types";
import { STEPS } from "@/lib/onboarding/steps";

interface PlaceholderStepProps {
  slug: StepSlug;
  tabHref: string;
}

export default function PlaceholderStep({ slug, tabHref }: PlaceholderStepProps) {
  const def = STEPS.find((s) => s.slug === slug)!;
  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-300">
        The {def.label} step isn&apos;t available in the guided walkthrough yet. Open the standard
        editor to enter this data — when you come back, this step&apos;s status will update
        automatically.
      </p>
      <Link
        href={tabHref}
        className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-100 hover:bg-gray-800"
      >
        Open {def.label} editor →
      </Link>
    </div>
  );
}
