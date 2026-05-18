import type { CSSProperties, ReactNode } from "react";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string | number;
  className?: string;
}

export function Skeleton({ width, height = "1rem", radius, className = "" }: SkeletonProps) {
  const style: CSSProperties = { width, height };
  if (radius !== undefined) style.borderRadius = radius;
  return <div className={`skeleton-block ${className}`.trim()} style={style} aria-hidden="true" />;
}

export function SkeletonText({ lines = 3, className = "" }: { lines?: number; className?: string }) {
  return (
    <div className={`flex flex-col gap-2 ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height="0.75rem" width={i === lines - 1 ? "60%" : "100%"} />
      ))}
    </div>
  );
}

export function LoadingLabel({ children = "Loading…" }: { children?: ReactNode }) {
  return (
    <span className="sr-only" role="status" aria-live="polite">
      {children}
    </span>
  );
}
