"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { runProjectionWithEvents, type ProjectionResult } from "@/engine/projection";
import type { EstateTaxResult } from "@/engine/types";
import type { InheritanceRecipientResult } from "@/lib/tax/state-inheritance";

const fmt = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

interface Props {
  clientId: string;
}

type Ordering = "primaryFirst" | "spouseFirst";

interface DeathSection {
  year: number;
  ordering: Ordering;
  deathLabel: string;
  result: EstateTaxResult;
}

export default function StateInheritanceTaxReportView({ clientId }: Props) {
  const searchParams = useSearchParams();
  const [projection, setProjection] = useState<ProjectionResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        const data = await res.json();
        const result = runProjectionWithEvents(data);
        if (cancelled) return;
        setProjection(result);
      } catch (e) {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Failed to load projection data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [clientId, searchParams]);

  const sections: DeathSection[] = useMemo(() => {
    if (!projection) return [];
    const out: DeathSection[] = [];
    const events = [
      { kind: "first" as const, result: projection.firstDeathEvent },
      { kind: "second" as const, result: projection.secondDeathEvent },
    ];
    for (const { kind, result } of events) {
      if (!result?.stateInheritanceTax || result.stateInheritanceTax.inactive) continue;
      out.push({
        year: result.year,
        ordering: "primaryFirst" as Ordering,
        deathLabel: kind === "first"
          ? `${result.deceased === "client" ? "Client" : "Spouse"} (first death)`
          : `${result.deceased === "client" ? "Client" : "Spouse"} (final death)`,
        result,
      });
    }
    return out;
  }, [projection]);

  if (loading) {
    return <div className="p-6 text-gray-300">Loading projection…</div>;
  }
  if (loadError) {
    return <div className="p-6 text-red-400">Failed to load projection: {loadError}</div>;
  }

  if (sections.length === 0) {
    return (
      <div className="p-6 text-gray-200">
        <h1 className="text-2xl font-semibold">State Inheritance Tax</h1>
        <p className="mt-2 text-sm text-gray-400">
          No state inheritance tax applies to this client&apos;s residence state.
          Inheritance tax is levied by PA, NJ, KY, NE, and MD on beneficiaries
          (other than spouse/lineal heirs in most jurisdictions).
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6 text-gray-100">
      <header>
        <h1 className="text-2xl font-semibold">State Inheritance Tax</h1>
        <p className="text-sm text-gray-400">
          Per-beneficiary tax breakdown. Inheritance tax is reported here for
          information only — it does not reduce the asset value passed to
          recipients in the projection.
        </p>
      </header>

      {sections.map((d, i) => (
        <DeathSectionView key={`${d.year}-${d.ordering}-${d.result.deathOrder}-${i}`} death={d} />
      ))}
    </div>
  );
}

function DeathSectionView({ death }: { death: DeathSection }) {
  const sti = death.result.stateInheritanceTax!;
  const credit = death.result.stateEstateTaxDetail.inheritanceCredit;

  return (
    <section className="rounded-md border border-gray-800 bg-gray-900/40 p-4">
      <h2 className="text-xl font-semibold">
        {death.year} — {death.deathLabel} · {sti.state}
      </h2>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-xs uppercase text-gray-400">
              <th className="py-2 pr-3 text-left">Recipient</th>
              <th className="px-3 text-left">Class</th>
              <th className="px-3 text-right">Gross share</th>
              <th className="px-3 text-right">Excluded</th>
              <th className="px-3 text-right">Exemption</th>
              <th className="px-3 text-right">Taxable</th>
              <th className="px-3 text-right">Tax</th>
              <th className="pl-3 text-right">Net to recipient</th>
            </tr>
          </thead>
          <tbody>
            {sti.perRecipient.map((r) => (
              <RecipientRow key={r.recipientKey} r={r} />
            ))}
            <tr className="border-t border-gray-800 font-medium">
              <td className="py-2 pr-3" colSpan={6}>Total inheritance tax</td>
              <td className="px-3 text-right">{fmt.format(sti.totalTax)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {credit?.applied && (
        <div className="mt-3 rounded bg-amber-950/40 p-3 text-sm text-amber-200">
          <strong>MD estate-tax credit applied:</strong> -{fmt.format(credit.reduction)}{" "}
          (credit = {fmt.format(credit.credit)}; state estate tax = {fmt.format(death.result.stateEstateTax)} after credit).
        </div>
      )}

      {sti.notes.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-gray-400">
          {sti.notes.map((n, i) => <li key={i}>• {n}</li>)}
        </ul>
      )}
    </section>
  );
}

function RecipientRow({ r }: { r: InheritanceRecipientResult }) {
  return (
    <tr className="border-b border-gray-800/60">
      <td className="py-2 pr-3">{r.label}</td>
      <td className="px-3">
        Class {r.classLabel}
        <span className="ml-1 text-xs text-gray-500">({r.classSource})</span>
        {r.excludedReasons.length > 0 && (
          <div className="mt-1 text-xs text-gray-500">
            {r.excludedReasons.map((reason, i) => (
              <div key={i}>{reason}</div>
            ))}
          </div>
        )}
      </td>
      <td className="px-3 text-right">{fmt.format(r.grossShare)}</td>
      <td className="px-3 text-right">{fmt.format(r.excluded)}</td>
      <td className="px-3 text-right">{fmt.format(r.exemption)}</td>
      <td className="px-3 text-right">{fmt.format(r.taxableShare)}</td>
      <td className="px-3 text-right">{fmt.format(r.tax)}</td>
      <td className="pl-3 text-right">{fmt.format(r.netToRecipient)}</td>
    </tr>
  );
}
