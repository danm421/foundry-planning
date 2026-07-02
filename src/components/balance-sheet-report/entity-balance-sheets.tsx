// src/components/balance-sheet-report/entity-balance-sheets.tsx
import { useState } from "react";
import type { BalanceSheetViewModel, EntityGroup } from "./view-model";
import { prepareEntityGroups } from "@/lib/balance-sheet/entity-groups";
import type { TrustDetails, TrustBeneficiaryLine } from "@/lib/balance-sheet/trust-details";

const fmt = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const ENTITY_TYPE_LABEL: Record<string, string> = {
  trust: "Trust",
  llc: "LLC",
  s_corp: "S-Corp",
  c_corp: "C-Corp",
  partnership: "Partnership",
  sole_prop: "Sole Prop",
  foundation: "Foundation",
  other: "Entity",
};

type EntityFilter = "all" | "trusts" | "businesses";

const FILTER_OPTIONS: Array<{ value: EntityFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "trusts", label: "Trusts" },
  { value: "businesses", label: "Businesses" },
];

const isTrust = (g: EntityGroup) => g.entityType === "trust";

const BENEFICIARY_GROUPS: TrustBeneficiaryLine["group"][] = ["Primary", "Contingent", "Income", "Remainder"];

function TrustDetailsCard({ details }: { details: TrustDetails }) {
  const hasContent =
    details.trustee !== null ||
    details.grantor !== null ||
    details.subTypeLabel !== null ||
    details.powers.length > 0 ||
    details.beneficiaries.length > 0;
  if (!hasContent) return null;

  const beneficiaryGroups = BENEFICIARY_GROUPS.map((group) => ({
    group,
    rows: details.beneficiaries.filter((b) => b.group === group),
  })).filter((g) => g.rows.length > 0);

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
        {beneficiaryGroups.map(({ group, rows }) => (
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
}

export default function EntityBalanceSheets({ groups, trustDetails = [] }: EntityBalanceSheetsProps) {
  const [filter, setFilter] = useState<EntityFilter>("all");
  const cleaned = prepareEntityGroups(groups);
  if (cleaned.length === 0) {
    return <div className="w-full max-w-sm rounded-lg border border-hair bg-card p-6 text-center text-ink-2">No business or trust entities.</div>;
  }

  const trustCount = cleaned.filter(isTrust).length;
  const showFilter = trustCount > 0 && trustCount < cleaned.length;
  const visible =
    filter === "all" || !showFilter ? cleaned : cleaned.filter((g) => (filter === "trusts" ? isTrust(g) : !isTrust(g)));
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
              onClick={() => setFilter(opt.value)}
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
                    <td className="px-4 py-1.5 pl-8 text-ink-2">{r.accountName}</td>
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
