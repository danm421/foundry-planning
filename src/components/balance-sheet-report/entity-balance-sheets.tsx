// src/components/balance-sheet-report/entity-balance-sheets.tsx
import type { BalanceSheetViewModel } from "./view-model";
import {
  ENTITY_TYPE_LABEL,
  entityFilterApplies,
  filterEntityGroups,
  isTrust,
  prepareEntityGroups,
  type EntityFilter,
} from "@/lib/balance-sheet/entity-groups";
import { groupBeneficiaries, hasTrustDetails, type TrustDetails } from "@/lib/balance-sheet/trust-details";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const FILTER_OPTIONS: Array<{ value: EntityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "trusts", label: "Trusts" },
  { value: "businesses", label: "Businesses" },
];

function TrustDetailsCard({ details }: { details: TrustDetails }) {
  if (!hasTrustDetails(details)) return null;

  return (
    <div className="w-full max-w-sm overflow-hidden rounded-lg border border-hair bg-card">
      <div className="flex items-baseline justify-between bg-paper px-4 py-2.5">
        <span className="font-semibold text-ink">Trust Details</span>
        {details.subTypeLabel && (
          <span className="rounded border border-hair-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
            {details.subTypeLabel}
          </span>
        )}
      </div>
      <dl className="flex flex-col gap-2 border-t border-hair px-4 py-3 text-sm">
        {details.trustee && (
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-ink-3">Trustee</dt>
            <dd className="text-right text-ink-2">{details.trustee}</dd>
          </div>
        )}
        {details.grantor && (
          <div className="flex justify-between gap-3">
            <dt className="shrink-0 text-ink-3">Grantor</dt>
            <dd className="text-right text-ink-2">{details.grantor}</dd>
          </div>
        )}
        {details.powers.length > 0 && (
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 text-ink-3">Powers</dt>
            <dd className="flex flex-wrap justify-end gap-1">
              {details.powers.map((p) => (
                <span key={p} className="rounded border border-hair-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                  {p}
                </span>
              ))}
            </dd>
          </div>
        )}
        {groupBeneficiaries(details).map(({ group, rows }) => (
          <div key={group}>
            <dt className="mb-1 text-[10px] uppercase tracking-wide text-ink-3">{group} beneficiaries</dt>
            {rows.map((b, i) => (
              <dd key={`${b.name}-${i}`} className="flex justify-between gap-3 py-0.5">
                <span className="text-ink-2">{b.name}</span>
                <span className="tabular text-ink">{b.percentage}%</span>
              </dd>
            ))}
          </div>
        ))}
      </dl>
    </div>
  );
}

interface EntityBalanceSheetsProps {
  groups: NonNullable<BalanceSheetViewModel["entityGroups"]>;
  trustDetails?: TrustDetails[];
  /** The All / Trusts / Businesses toggle — owned by the report so its PDF
   *  export prints the same filtered set. */
  filter: EntityFilter;
  onFilterChange: (next: EntityFilter) => void;
}

export default function EntityBalanceSheets({ groups, trustDetails = [], filter, onFilterChange }: EntityBalanceSheetsProps) {
  const cleaned = prepareEntityGroups(groups);
  if (cleaned.length === 0) {
    return <div className="w-full max-w-sm rounded-lg border border-hair bg-card p-6 text-center text-ink-2">No business or trust entities.</div>;
  }

  const showFilter = entityFilterApplies(cleaned);
  const visible = filterEntityGroups(cleaned, filter);
  const detailsById = new Map(trustDetails.map((d) => [d.entityId, d]));

  const filterClass = (active: boolean) =>
    active
      ? "rounded-md border border-accent bg-card-2 px-3 py-1 text-xs font-medium text-accent"
      : "rounded-md border border-transparent px-3 py-1 text-xs text-ink-2 hover:bg-card-2 hover:text-ink";

  return (
    <div className="flex w-full flex-col gap-4">
      {showFilter && (
        <div role="tablist" aria-label="Entity type filter" className="flex gap-1">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              role="tab"
              aria-selected={filter === opt.value}
              className={filterClass(filter === opt.value)}
              onClick={() => onFilterChange(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {visible.map((g) => (
        <div key={g.entityId} className="flex flex-col items-start gap-4 lg:flex-row">
          <div className="w-full max-w-sm shrink-0 overflow-hidden rounded-lg border border-hair bg-card">
            <div className="flex items-baseline justify-between bg-paper px-4 py-2.5">
              <div className="flex items-baseline gap-2">
                <span className="font-semibold text-ink">{g.entityName}</span>
                <span className="rounded border border-hair-2 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-ink-3">
                  {ENTITY_TYPE_LABEL[g.entityType] ?? g.entityType}
                </span>
              </div>
              <span className={`font-semibold tabular-nums ${g.netWorth < 0 ? "text-crit" : "text-ink"}`}>{fmt(g.netWorth)}</span>
            </div>
            <table className="w-full text-sm">
              <tbody>
                {g.assetRows.map((r) => (
                  <tr key={r.rowKey} className="border-t border-hair">
                    <td className="px-4 py-1.5 pl-8 text-ink-2">
                      {r.accountName}
                      {(r.marginLoan ?? 0) > 0 && (
                        <div className="text-[10px] text-ink-4">after {fmt(r.marginLoan!)} margin loan</div>
                      )}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-ink">{fmt(r.value)}</td>
                  </tr>
                ))}
                {g.liabilityRows.map((r) => (
                  <tr key={r.rowKey} className="border-t border-hair">
                    <td className="px-4 py-1.5 pl-8 text-ink-2">{r.liabilityName}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-crit">({fmt(r.balance)})</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {isTrust(g) && detailsById.has(g.entityId) && <TrustDetailsCard details={detailsById.get(g.entityId)!} />}
        </div>
      ))}
    </div>
  );
}
