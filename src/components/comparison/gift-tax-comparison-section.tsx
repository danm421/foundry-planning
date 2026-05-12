"use client";

import { useMemo, useState } from "react";
import { buildRecipientDrilldown } from "@/lib/gifts/build-recipient-drilldown";
import type { RecipientGroup } from "@/lib/gifts/build-recipient-drilldown";
import { GiftCumulativeTable } from "@/components/gift-cumulative-table";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";
import { seriesColor } from "@/lib/comparison/series-palette";
import { deriveOwnerNames, deriveOwnerDobs } from "@/lib/comparison/owner-info";

function ownerAgesFor(
  plan: ComparisonPlan,
): Record<number, { client: number; spouse?: number }> {
  const dobs = deriveOwnerDobs(plan.tree);
  const cYear = parseInt(dobs.clientDob.slice(0, 4), 10);
  const sYear = dobs.spouseDob ? parseInt(dobs.spouseDob.slice(0, 4), 10) : null;
  const out: Record<number, { client: number; spouse?: number }> = {};
  for (const ly of plan.result.giftLedger ?? []) {
    out[ly.year] = {
      client: ly.year - cYear,
      ...(sYear ? { spouse: ly.year - sYear } : {}),
    };
  }
  return out;
}

function PlanCard({ plan, index }: { plan: ComparisonPlan; index: number }) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const toggle = (year: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  };
  const ownerNames = useMemo(() => deriveOwnerNames(plan.tree), [plan.tree]);

  const drilldownByYear = useMemo(() => {
    const out = new Map<number, RecipientGroup[]>();
    const ledger = plan.result.giftLedger ?? [];
    const tree = plan.tree;
    const familyMembersById = new Map(
      (tree.familyMembers ?? []).map((fm) => [
        fm.id,
        { firstName: fm.firstName, lastName: fm.lastName ?? "" },
      ]),
    );
    const entitiesById = new Map<string, { name: string }>();
    for (const e of tree.entities ?? []) {
      if (e.name) entitiesById.set(e.id, { name: e.name });
    }
    const externalBeneficiariesById = new Map(
      (tree.externalBeneficiaries ?? []).map((eb) => [
        eb.id,
        { name: eb.name, kind: eb.kind },
      ]),
    );
    const annualExclusionsByYear: Record<number, number> = {};
    const taxYearRows = (tree.taxYearRows ?? []) as Array<{
      year: number;
      giftAnnualExclusion?: string | null;
    }>;
    for (const r of taxYearRows) {
      if (r.giftAnnualExclusion != null) {
        annualExclusionsByYear[r.year] = parseFloat(r.giftAnnualExclusion);
      }
    }
    const yearByYear = new Map(plan.result.years.map((y) => [y.year, y]));
    const accountValueAtYear = (accountId: string, year: number): number => {
      const ly = yearByYear.get(year)?.accountLedgers?.[accountId];
      return ly?.endingValue ?? 0;
    };
    for (const ly of ledger) {
      const groups = buildRecipientDrilldown({
        year: ly.year,
        gifts: tree.gifts ?? [],
        giftEvents: tree.giftEvents ?? [],
        familyMembersById,
        entitiesById,
        externalBeneficiariesById,
        annualExclusion: annualExclusionsByYear[ly.year] ?? 0,
        accountValueAtYear,
      });
      if (groups.length > 0) out.set(ly.year, groups);
    }
    return out;
  }, [plan]);

  const ownerAges = useMemo(() => ownerAgesFor(plan), [plan]);
  const color = seriesColor(index) ?? "#cbd5e1";
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
          aria-hidden
        />
        <span className="text-xs uppercase tracking-wide text-slate-400">
          {plan.label}
        </span>
      </div>
      <GiftCumulativeTable
        ledger={plan.result.giftLedger ?? []}
        ownerNames={ownerNames}
        ownerAges={ownerAges}
        expandedYears={expanded}
        onToggleYear={toggle}
        drilldownByYear={drilldownByYear}
      />
    </div>
  );
}

export function GiftTaxComparisonSection({ plans }: { plans: ComparisonPlan[] }) {
  return (
    <section className="px-6 py-8">
      <h2 className="mb-4 text-lg font-semibold text-slate-100">Gift Tax</h2>
      <div className="grid grid-cols-1 gap-4">
        {plans.map((p, i) => (
          <PlanCard key={p.id} plan={p} index={i} />
        ))}
      </div>
    </section>
  );
}
