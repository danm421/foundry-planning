import type { RecipientGroup } from "@/lib/estate/transfer-report";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const DRAIN_KINDS: ReadonlyArray<keyof RecipientGroup["drainsByKind"]> = [
  "federal_estate_tax",
  "state_estate_tax",
  "admin_expenses",
  "debts_paid",
  "ird_tax",
];

export function EstateTransferRecipientCard({
  group,
}: {
  group: RecipientGroup;
}) {
  const isSpouse = group.recipientKind === "spouse";
  const isSystemDefault = group.recipientKind === "system_default";

  const totalDrains = DRAIN_KINDS.reduce(
    (s, k) => s + group.drainsByKind[k],
    0,
  );
  const hasReductions = Math.abs(totalDrains) >= 0.5;

  return (
    <section
      className={
        "rounded-lg border px-4 py-3 " +
        (isSpouse
          ? "border-indigo-900/40 bg-indigo-950/15"
          : isSystemDefault
            ? "border-amber-900/40 bg-amber-950/15"
            : "border-gray-800/80 bg-gray-900/50")
      }
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="flex items-baseline gap-2 text-sm font-semibold text-gray-100">
          <span>{group.recipientLabel}</span>
          {isSystemDefault && (
            <span className="rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-amber-200">
              No plan
            </span>
          )}
        </h3>
        <div className="flex items-baseline gap-2">
          {hasReductions && (
            <span className="text-[10px] uppercase tracking-wider text-gray-500">
              Net
            </span>
          )}
          <span className="text-base font-semibold tabular-nums text-gray-50">
            {fmt.format(group.netTotal)}
          </span>
        </div>
      </div>

      <div className="mt-2 space-y-2">
        {group.byMechanism.map((mech) => (
          <div key={mech.mechanism}>
            <div className="flex items-baseline justify-between gap-4 border-b border-gray-800/40 pb-0.5 text-[11px] uppercase tracking-wider text-gray-400">
              <span>{mech.mechanismLabel}</span>
              <span className="tabular-nums">
                {fmt.format(mech.total)}
              </span>
            </div>
            <div>
              {mech.assets.map((a, i) => (
                <div
                  key={`${a.sourceAccountId ?? a.sourceLiabilityId ?? "asset"}-${i}`}
                  className="flex items-baseline justify-between gap-4 py-0.5 pl-3 text-sm text-gray-300"
                >
                  <span className="flex items-baseline gap-2 truncate">
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
                  <span className="tabular-nums text-gray-200">
                    {fmt.format(a.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {hasReductions && (
        <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-gray-800/60 pt-1.5 text-xs text-gray-400">
          <span>
            Gross transfers {fmt.format(group.total)}{" "}
            <span className="text-rose-300/80">
              − reductions {fmt.format(totalDrains)}
            </span>
          </span>
          <span className="tabular-nums text-gray-300">
            {fmt.format(group.netTotal)}
          </span>
        </div>
      )}
    </section>
  );
}
