// Shared empty state for comparison-aware widgets when no
// `comparisonBinding` is set on the report (or one side is missing).

export function ComparisonEmptyState({ title }: { title: string }) {
  return (
    <div className="bg-report-card border border-report-hair rounded-md p-6 text-center text-report-ink-3">
      <div className="text-base font-serif font-medium text-report-ink mb-2">
        {title}
      </div>
      <div className="text-xs">Bind two scenarios to use this widget.</div>
    </div>
  );
}
