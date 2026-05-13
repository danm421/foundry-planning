"use client";

import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import type { Account, EntitySummary, FamilyMember, Liability } from "@/engine/types";
import type { AccountOwner } from "@/engine/ownership";
import { seriesColor } from "@/lib/comparison/series-palette";

function fmt(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}

const CATEGORY_LABELS: Record<Account["category"], string> = {
  cash: "Cash",
  taxable: "Taxable",
  retirement: "Retirement",
  real_estate: "Real Estate",
  business: "Business",
  life_insurance: "Life Insurance",
};

function categoryLabel(c: Account["category"] | string | undefined): string {
  if (!c) return "—";
  return CATEGORY_LABELS[c as Account["category"]] ?? c;
}

function familyMemberLabel(fm: FamilyMember | undefined, id: string): string {
  if (!fm) return id.slice(0, 6);
  if (fm.role === "client") return "client";
  if (fm.role === "spouse") return "spouse";
  return fm.firstName || fm.role;
}

function ownerLabelFor(
  owners: AccountOwner[] | undefined,
  familyById: Map<string, FamilyMember>,
  entityNames: Map<string, string>,
): string {
  const list = owners ?? [];
  if (list.length === 0) return "—";
  if (list.length === 1 && (list[0].percent ?? 1) >= 0.999) {
    const o = list[0];
    return o.kind === "entity"
      ? entityNames.get(o.entityId) ?? "entity"
      : familyMemberLabel(familyById.get(o.familyMemberId), o.familyMemberId);
  }
  // Multiple owners: collapse to "joint" if both household principals, else "shared".
  const allFamily = list.every((o) => o.kind === "family_member");
  if (allFamily) {
    const roles = new Set(
      list.map((o) =>
        o.kind === "family_member" ? familyById.get(o.familyMemberId)?.role : undefined,
      ),
    );
    if (roles.has("client") && roles.has("spouse") && roles.size === 2) return "joint";
    return "shared";
  }
  return "mixed";
}

function PlanColumn({ plan, index }: { plan: ComparisonPlan; index: number }) {
  const accounts = (plan.tree.accounts ?? []) as Account[];
  const liabilities = (plan.tree.liabilities ?? []) as Liability[];
  const entities = (plan.tree.entities ?? []) as EntitySummary[];
  const familyMembers = (plan.tree.familyMembers ?? []) as FamilyMember[];
  const entityNames = new Map<string, string>(
    entities.map((e) => [e.id, e.name ?? e.id.slice(0, 6)]),
  );
  const familyById = new Map<string, FamilyMember>(familyMembers.map((fm) => [fm.id, fm]));
  const totalAssets = accounts.reduce((s, a) => s + (Number(a.value) || 0), 0);
  const totalLiabs = liabilities.reduce((s, l) => s + (Number(l.balance) || 0), 0);
  const netWorth = totalAssets - totalLiabs;
  const color = seriesColor(index) ?? "#cbd5e1";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-3 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-xs uppercase tracking-wide text-slate-400">{plan.label}</span>
      </div>
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
        Assets
      </div>
      {accounts.length === 0 ? (
        <p className="mb-3 text-sm text-slate-400">No accounts.</p>
      ) : (
        <table className="mb-3 w-full text-xs">
          <thead className="text-slate-400">
            <tr>
              <th className="text-left font-normal">Account</th>
              <th className="text-left font-normal">Owner</th>
              <th className="text-left font-normal">Type</th>
              <th className="text-right font-normal">Value</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map((a) => (
              <tr key={a.id} className="text-slate-200">
                <td className="py-0.5">{a.name}</td>
                <td>{ownerLabelFor(a.owners, familyById, entityNames)}</td>
                <td>{categoryLabel(a.category)}</td>
                <td className="text-right tabular-nums">{fmt(Number(a.value) || 0)}</td>
              </tr>
            ))}
            <tr className="border-t border-slate-700 text-slate-100">
              <td className="py-0.5 font-semibold" colSpan={3}>
                Total Assets
              </td>
              <td className="text-right font-semibold tabular-nums">{fmt(totalAssets)}</td>
            </tr>
          </tbody>
        </table>
      )}
      {liabilities.length > 0 && (
        <>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-300">
            Liabilities
          </div>
          <table className="mb-3 w-full text-xs">
            <thead className="text-slate-400">
              <tr>
                <th className="text-left font-normal">Liability</th>
                <th className="text-left font-normal">Owner</th>
                <th className="text-right font-normal">Balance</th>
              </tr>
            </thead>
            <tbody>
              {liabilities.map((l) => (
                <tr key={l.id} className="text-slate-200">
                  <td className="py-0.5">{l.name}</td>
                  <td>{ownerLabelFor(l.owners, familyById, entityNames)}</td>
                  <td className="text-right tabular-nums">{fmt(Number(l.balance) || 0)}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-700 text-slate-100">
                <td className="py-0.5 font-semibold" colSpan={2}>
                  Total Liabilities
                </td>
                <td className="text-right font-semibold tabular-nums">{fmt(totalLiabs)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
      <div className="rounded border border-slate-700 bg-slate-950/30 px-3 py-2 text-sm font-semibold text-slate-100">
        Net Worth: <span className="tabular-nums">{fmt(netWorth)}</span>
      </div>
    </div>
  );
}

export function BalanceSheetComparisonSection({ plans }: { plans: ComparisonPlan[] }) {
  const cols =
    plans.length === 1
      ? "grid-cols-1"
      : plans.length === 2
        ? "grid-cols-1 lg:grid-cols-2"
        : "grid-cols-1 md:grid-cols-3";
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Balance Sheet</h2>
      <div className={`grid gap-4 ${cols}`}>
        {plans.map((p, i) => (
          <PlanColumn key={p.id} plan={p} index={i} />
        ))}
      </div>
    </section>
  );
}
