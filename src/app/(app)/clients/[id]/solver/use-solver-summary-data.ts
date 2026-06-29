import { useEffect, useMemo, useRef, useState } from "react";
import type { ProjectionYear, ProjectionResult, ClientData } from "@/engine";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import type { LifeInsuranceInventory } from "@/lib/insurance-policies/load-li-inventory";
import { buildSolverSummaryContext } from "@/lib/solver/summary-context";
import { parseProjectionResponse } from "@/lib/solver/projection-wire";
import type { SummaryKey } from "@/components/solver/summaries/types";

interface Args {
  clientId: string;
  source: SolverSource;
  mutations: SolverMutation[];
  years: ProjectionYear[];
  workingTree: ClientData;
  clientName: string;
  spouseName: string | null;
  mcSuccessRate: number | null;
  activeSummary: SummaryKey;
  enabled: boolean;
}

export function useSolverSummaryData(args: Args) {
  const { clientId, source, mutations, years, workingTree, clientName, spouseName, mcSuccessRate, activeSummary, enabled } = args;

  const [fullProjection, setFullProjection] = useState<ProjectionResult | undefined>(undefined);
  const [estateLoading, setEstateLoading] = useState(false);
  const [lifeInsurance, setLifeInsurance] = useState<LifeInsuranceInventory | undefined>(undefined);
  const [liLoading, setLiLoading] = useState(false);
  const estateDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Estate: debounced full-projection fetch while estate summary is active.
  useEffect(() => {
    if (!enabled || activeSummary !== "estate") return;
    if (estateDebounce.current) clearTimeout(estateDebounce.current);
    setEstateLoading(true);
    estateDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/solver/project`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ source, mutations, includeEvents: true }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        // parseProjectionResponse (not res.json()) revives the projection's Map
        // fields, which JSON drops. See projection-wire.ts.
        const data = parseProjectionResponse<{ projectionResult?: ProjectionResult }>(
          await res.text(),
        );
        setFullProjection(data.projectionResult);
      } catch {
        setFullProjection(undefined);
      } finally {
        setEstateLoading(false);
      }
    }, 600);
    return () => { if (estateDebounce.current) clearTimeout(estateDebounce.current); setEstateLoading(false); };
  }, [enabled, activeSummary, clientId, source, mutations]);

  // Life insurance: fetch the inventory once on first activation.
  useEffect(() => {
    if (!enabled || activeSummary !== "lifeInsurance" || lifeInsurance) return;
    const controller = new AbortController();
    setLiLoading(true);
    const qs = new URLSearchParams({ clientName, spouseName: spouseName ?? "" });
    fetch(`/api/clients/${clientId}/solver/li-inventory?${qs.toString()}`, { method: "GET", signal: controller.signal })
      .then((res) => (res.ok ? res.json() : { policies: [] }))
      .then((inv: LifeInsuranceInventory) => {
        if (controller.signal.aborted) return;
        setLifeInsurance(inv);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        void err;
        setLifeInsurance({ policies: [] });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLiLoading(false);
      });
    return () => { controller.abort(); };
  }, [enabled, activeSummary, lifeInsurance, clientId, clientName, spouseName]);

  const context = useMemo(
    () => buildSolverSummaryContext({ years, clientData: workingTree, clientName, spouseName, mcSuccessRate, fullProjection, lifeInsurance }),
    [years, workingTree, clientName, spouseName, mcSuccessRate, fullProjection, lifeInsurance],
  );

  return { context, estateLoading, liLoading };
}
