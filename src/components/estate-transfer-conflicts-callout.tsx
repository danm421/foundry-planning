import type { ConflictEntry } from "@/lib/estate/transfer-report";

export function EstateTransferConflictsCallout({
  conflicts,
}: {
  conflicts: ConflictEntry[];
}) {
  if (conflicts.length === 0) return null;
  return (
    <div className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-4 py-3 text-xs">
      <p className="font-medium text-amber-200">
        <span aria-hidden>⚠ </span>
        {conflicts.length === 1
          ? "An asset transfers differently than the will directs"
          : "Some assets transfer differently than the will directs"}
      </p>
      <ul className="mt-1.5 space-y-1 text-amber-200/80">
        {conflicts.map((c) => (
          <li key={c.id}>
            <span className="font-medium text-amber-100">{c.accountLabel}</span>
            {" — "}
            {c.overriddenBy[0]?.note}
          </li>
        ))}
      </ul>
    </div>
  );
}
