import { useEffect, useMemo, useState } from "react";
import type { ProjectionYear, ClientData } from "@/engine";
import type { SolverMutation, SolverSource } from "@/lib/solver/types";
import type { LifeInsuranceInventory } from "@/lib/insurance-policies/load-li-inventory";
import { buildSolverSummaryContext } from "@/lib/solver/summary-context";
import type { SummaryKey } from "@/components/solver/summaries/types";
import { useSolverFullProjection } from "./use-solver-full-projection";

interface Args {
  clientId: string;
  source: SolverSource;
  mutations: SolverMutation[];
  years: ProjectionYear[];
  workingTree: ClientData;
  clientName: string;
  spouseName: string | null;
  mcSuccessRate: number | null;
  baseClientData: ClientData;
  baseProjection: ProjectionYear[];
  activeSummary: SummaryKey;
  enabled: boolean;
}

export function useSolverSummaryData(args: Args) {
  const { clientId, source, mutations, years, workingTree, clientName, spouseName, mcSuccessRate, baseClientData, baseProjection, activeSummary, enabled } = args;

  const [lifeInsurance, setLifeInsurance] = useState<LifeInsuranceInventory | undefined>(undefined);
  const [liLoading, setLiLoading] = useState(false);

  // Estate: debounced full-projection fetch while the estate summary is active.
  // Shared with the Estate report's Flow Chart sub-tab — see
  // use-solver-full-projection.ts.
  const { projection: fullProjection, loading: estateLoading } = useSolverFullProjection({
    clientId,
    source,
    mutations,
    enabled: enabled && activeSummary === "estate",
  });

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
    () => buildSolverSummaryContext({ years, clientData: workingTree, clientName, spouseName, mcSuccessRate, fullProjection, lifeInsurance, baseClientData, baseProjection }),
    [years, workingTree, clientName, spouseName, mcSuccessRate, fullProjection, lifeInsurance, baseClientData, baseProjection],
  );

  return { context, estateLoading, liLoading };
}
