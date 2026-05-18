import { LoadingLabel, Skeleton, SkeletonForm } from "@/components/skeleton";
import { STEPS } from "@/lib/onboarding/steps";

export default function OnboardingStepSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <LoadingLabel>Loading Onboarding…</LoadingLabel>

      {/* Top bar: eyebrow + progress */}
      <div className="flex items-center justify-between gap-4">
        <Skeleton height="0.75rem" width="12rem" />
        <div className="flex items-center gap-3">
          <Skeleton height="0.375rem" width="10rem" radius="9999px" />
          <Skeleton height="0.75rem" width="2.5rem" />
        </div>
      </div>

      {/* Stepper */}
      <nav aria-hidden="true">
        <ol
          className="relative grid gap-x-1 gap-y-3"
          style={{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }}
        >
          {STEPS.map((def) => (
            <li key={def.slug} className="flex flex-col items-center gap-2">
              <Skeleton height="1.875rem" width="1.875rem" radius="9999px" />
              <Skeleton height="0.6875rem" width="90%" />
            </li>
          ))}
        </ol>
      </nav>

      {/* Step card */}
      <div className="overflow-hidden rounded-[10px] border border-hair bg-card">
        {/* Header */}
        <div className="flex items-start gap-4 border-b border-hair px-6 py-5">
          <Skeleton height="2.75rem" width="2.75rem" radius="0.625rem" />
          <div className="flex flex-1 flex-col gap-1.5">
            <Skeleton height="1.25rem" width="40%" />
            <Skeleton height="0.8125rem" width="65%" />
          </div>
          <Skeleton height="1.5rem" width="5rem" radius="9999px" />
        </div>

        {/* Step body */}
        <div className="px-6 py-6">
          <SkeletonForm fields={5} />
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <Skeleton height="0.8125rem" width="6rem" />
        <div className="flex items-center gap-2">
          <Skeleton height="2.25rem" width="5rem" radius="0.375rem" />
          <Skeleton height="2.25rem" width="5.5rem" radius="0.375rem" />
        </div>
      </div>
    </div>
  );
}
