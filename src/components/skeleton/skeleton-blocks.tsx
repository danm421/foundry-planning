import type { ReactNode } from "react";
import { Skeleton, SkeletonText } from "./skeleton";

const CARD = "rounded-lg border border-[var(--color-hair)] bg-[var(--color-card)] p-4";

export function SkeletonCard({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return (
    <div className={`${CARD} ${className}`.trim()} aria-hidden="true">
      {children ?? <SkeletonText lines={3} />}
    </div>
  );
}

export function SkeletonKpi() {
  return (
    <div className={`${CARD} flex flex-col gap-3`} aria-hidden="true">
      <Skeleton height="0.75rem" width="40%" />
      <Skeleton height="1.75rem" width="70%" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-hidden="true">
      <div className="flex gap-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} height="0.875rem" className="flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: columns }).map((_, c) => (
            <Skeleton key={c} height="1rem" className="flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkeletonChart({ className = "" }: { className?: string }) {
  return (
    <div className={`${CARD} flex flex-col gap-3 ${className}`.trim()} aria-hidden="true">
      <Skeleton height="0.875rem" width="35%" />
      <Skeleton height="200px" className="w-full" />
    </div>
  );
}

export function SkeletonForm({ fields = 4 }: { fields?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      {Array.from({ length: fields }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2">
          <Skeleton height="0.75rem" width="30%" />
          <Skeleton height="2.25rem" className="w-full" />
        </div>
      ))}
    </div>
  );
}
