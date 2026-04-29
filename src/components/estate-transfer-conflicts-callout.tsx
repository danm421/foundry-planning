import type { ConflictEntry } from "@/lib/estate/transfer-report";

export function EstateTransferConflictsCallout({
  conflicts,
}: {
  conflicts: ConflictEntry[];
}) {
  if (conflicts.length === 0) return null;
  return (
    <section className="rounded-lg border border-amber-900/40 bg-amber-950/20 px-5 py-4">
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-amber-200">
        Conflicts &amp; Overrides
      </h3>
      <p className="mb-3 text-[11px] text-amber-200/80">
        These assets have configuration that disagrees with how they actually transfer.
        The mechanism that wins is shown; the overridden instruction is listed below.
      </p>
      <ul className="space-y-2">
        {conflicts.map((c) => (
          <li
            key={c.id}
            className="rounded border border-amber-900/30 bg-amber-950/10 px-3 py-2 text-sm text-amber-100/90"
          >
            <div className="font-medium text-amber-100">{c.accountLabel}</div>
            <div className="mt-0.5 text-xs text-amber-200/70">
              Routes to <strong>{c.governingRecipient}</strong> via {c.governingMechanism}.
            </div>
            <ul className="mt-1 space-y-0.5">
              {c.overriddenBy.map((o, i) => (
                <li key={i} className="text-xs text-amber-200/90">
                  ▸ {o.note}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
