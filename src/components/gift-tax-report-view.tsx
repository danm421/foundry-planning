"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  runProjectionWithEvents,
  type ProjectionResult,
} from "@/engine/projection";
import type { ClientData } from "@/engine/types";
import {
  buildRecipientDrilldown,
  type RecipientGroup,
} from "@/lib/gifts/build-recipient-drilldown";
import { GiftCumulativeTable } from "./gift-cumulative-table";

interface GiftTaxReportViewProps {
  clientId: string;
  ownerNames: { clientName: string; spouseName: string | null };
  ownerDobs: { clientDob: string; spouseDob: string | null };
}

export default function GiftTaxReportView({
  clientId,
  ownerNames,
  ownerDobs,
}: GiftTaxReportViewProps) {
  const searchParams = useSearchParams();
  const [tree, setTree] = useState<ClientData | null>(null);
  const [projection, setProjection] = useState<ProjectionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [expandedYears, setExpandedYears] = useState<Set<number>>(new Set());

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const scenarioParam = searchParams?.get("scenario");
        const url = scenarioParam
          ? `/api/clients/${clientId}/projection-data?scenario=${encodeURIComponent(scenarioParam)}`
          : `/api/clients/${clientId}/projection-data`;
        const res = await fetch(url);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as ClientData;
        const result = runProjectionWithEvents(data);
        if (cancelled) return;
        setTree(data);
        setProjection(result);
      } catch (e) {
        if (cancelled) return;
        setLoadError(
          e instanceof Error ? e.message : "Failed to load projection data",
        );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [clientId, searchParams]);

  const ownerAges = useMemo(() => {
    const out: Record<number, { client: number; spouse?: number }> = {};
    if (!projection) return out;
    const cYear = parseInt(ownerDobs.clientDob.slice(0, 4), 10);
    const sYear = ownerDobs.spouseDob
      ? parseInt(ownerDobs.spouseDob.slice(0, 4), 10)
      : null;
    for (const ly of projection.giftLedger) {
      out[ly.year] = {
        client: ly.year - cYear,
        ...(sYear ? { spouse: ly.year - sYear } : {}),
      };
    }
    return out;
  }, [projection, ownerDobs]);

  const drilldownByYear = useMemo(() => {
    const out = new Map<number, RecipientGroup[]>();
    if (!projection || !tree) return out;

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

    const yearByYear = new Map(projection.years.map((y) => [y.year, y]));
    const accountValueAtYear = (accountId: string, year: number): number => {
      const ledger = yearByYear.get(year)?.accountLedgers?.[accountId];
      return ledger?.endingValue ?? 0;
    };

    for (const ly of projection.giftLedger) {
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
  }, [projection, tree]);

  function toggleYear(year: number) {
    setExpandedYears((prev) => {
      const next = new Set(prev);
      if (next.has(year)) next.delete(year);
      else next.add(year);
      return next;
    });
  }

  if (loadError) {
    return (
      <div className="gift-tax-report-printable p-4 text-red-400">
        Failed to load projection: {loadError}
      </div>
    );
  }
  if (loading) {
    return (
      <div className="gift-tax-report-printable p-4 text-ink-3">Loading…</div>
    );
  }
  if (!projection || projection.giftLedger.length === 0) {
    return (
      <div className="gift-tax-report-printable p-4 text-ink-3">
        No gift ledger available.
      </div>
    );
  }

  return (
    <div className="gift-tax-report-printable p-4 space-y-4 print:p-0 print:space-y-2">
      <h1 className="text-lg font-medium print:text-base">Gift Tax Report</h1>
      <GiftCumulativeTable
        ledger={projection.giftLedger}
        ownerNames={ownerNames}
        ownerAges={ownerAges}
        expandedYears={expandedYears}
        onToggleYear={toggleYear}
        drilldownByYear={drilldownByYear}
      />
    </div>
  );
}
