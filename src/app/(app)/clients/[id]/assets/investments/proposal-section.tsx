import { FieldTooltip } from "@/components/forms/field-tooltip";

/** Card + heading chrome shared by the comparison's sections. Lives on its own
 *  so each section file can wrap itself without importing back from
 *  `rebalance-comparison.tsx`, which composes them. */

export function SectionCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-lg border border-hair-2 bg-card p-4 ${className ?? ""}`}>
      {children}
    </div>
  );
}

export function SectionHeading({
  children,
  tooltip,
}: {
  children: React.ReactNode;
  tooltip?: string;
}) {
  return (
    <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium text-ink">
      {children}
      {tooltip && <FieldTooltip text={tooltip} />}
    </h3>
  );
}

/** A degraded state the section shows instead of hiding — the reason a figure is
 *  missing is information the advisor needs before presenting. */
export function SectionNote({
  tone = "muted",
  children,
}: {
  tone?: "muted" | "warn" | "good";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "warn" ? "text-warn" : tone === "good" ? "text-good" : "text-ink-3";
  return <p className={`text-[13px] ${toneClass}`}>{children}</p>;
}
