import type { RecipientGroup } from "@/lib/estate/transfer-report";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const DRAIN_KIND_LABELS: Record<keyof RecipientGroup["drainsByKind"], string> = {
  federal_estate_tax: "Federal estate tax",
  state_estate_tax: "State estate tax",
  admin_expenses: "Admin expenses",
  debts_paid: "Debts paid",
};

const DRAIN_KIND_ORDER: ReadonlyArray<keyof RecipientGroup["drainsByKind"]> = [
  "federal_estate_tax",
  "state_estate_tax",
  "admin_expenses",
  "debts_paid",
];

export function EstateTransferRecipientCard({
  group,
}: {
  group: RecipientGroup;
}) {
  const isSpouse = group.recipientKind === "spouse";
  const isSystemDefault = group.recipientKind === "system_default";

  const nonZeroDrains = DRAIN_KIND_ORDER.map((kind) => ({
    kind,
    amount: group.drainsByKind[kind],
  })).filter((d) => Math.abs(d.amount) >= 0.5);

  const hasReductions = nonZeroDrains.length > 0;

  return (
    <section
      className={
        "rounded-lg border px-5 py-4 " +
        (isSpouse
          ? "border-indigo-900/40 bg-indigo-950/15 ring-1 ring-indigo-500/10"
          : isSystemDefault
            ? "border-amber-900/40 bg-amber-950/15"
            : "border-gray-800/80 bg-gray-900/60")
      }
    >
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-gray-100">
          {group.recipientLabel}
          {isSystemDefault && (
            <span className="ml-2 rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-200">
              No plan
            </span>
          )}
        </h3>
        <span className="font-mono text-lg font-semibold tabular-nums text-gray-50">
          {fmt.format(group.netTotal)}
        </span>
      </div>
      <div className="space-y-3">
        {group.byMechanism.map((mech) => (
          <div key={mech.mechanism}>
            <div className="mb-1 flex items-baseline justify-between gap-4 text-xs uppercase tracking-wider text-gray-400">
              <span>{mech.mechanismLabel}</span>
              <span className="font-mono tabular-nums">{fmt.format(mech.total)}</span>
            </div>
            <div className="divide-y divide-gray-800/40 rounded border border-gray-800/40 bg-gray-950/40">
              {mech.assets.map((a, i) => (
                <div
                  key={`${a.sourceAccountId ?? a.sourceLiabilityId ?? "asset"}-${i}`}
                  className="flex items-baseline justify-between gap-4 px-3 py-1.5 text-sm text-gray-300"
                >
                  <span className="flex items-center gap-2 truncate">
                    <span className="truncate">{a.label}</span>
                    {a.conflictIds.length > 0 && (
                      <span
                        className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-200"
                        title={`${a.conflictIds.length} configuration conflict(s) on this asset`}
                      >
                        Conflict
                      </span>
                    )}
                  </span>
                  <span className="font-mono tabular-nums text-gray-200">
                    {fmt.format(a.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {hasReductions && (
        <div className="mt-3 border-t border-rose-900/30 pt-3">
          <div className="mb-1 flex items-baseline justify-between gap-3 text-[11px] uppercase tracking-[0.18em] text-rose-200/80">
            <span>Reductions</span>
            <span className="font-mono tabular-nums">
              −{fmt.format(nonZeroDrains.reduce((s, d) => s + d.amount, 0))}
            </span>
          </div>
          <div className="divide-y divide-rose-900/30">
            {nonZeroDrains.map((d) => (
              <div
                key={d.kind}
                className="flex items-baseline justify-between gap-4 py-1 text-sm text-rose-100/90"
              >
                <span>{DRAIN_KIND_LABELS[d.kind]}</span>
                <span className="font-mono tabular-nums">−{fmt.format(d.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
