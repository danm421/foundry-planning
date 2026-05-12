"use client";

import { useEffect, useRef, useState } from "react";
import type { ComparisonPlan } from "@/lib/comparison/build-comparison-plans";

export interface PreviewPlansState {
  status: "idle" | "loading" | "ready" | "error";
  plans?: ComparisonPlan[];
  error?: string;
}

interface Args {
  clientId: string;
  planIds: string[];
  enabled: boolean;
}

const cacheKey = (clientId: string, planIds: string[]) =>
  `${clientId}|${[...planIds].sort().join(",")}`;

export function usePreviewPlans({ clientId, planIds, enabled }: Args): PreviewPlansState {
  const cache = useRef<Map<string, ComparisonPlan[]>>(new Map());
  const [state, setState] = useState<PreviewPlansState>({ status: "idle" });

  const unique = Array.from(new Set(planIds));
  const key = unique.length === 0 ? null : cacheKey(clientId, unique);

  useEffect(() => {
    if (!enabled || key === null) {
      setState({ status: "idle" });
      return;
    }
    const cached = cache.current.get(key);
    if (cached) {
      setState({ status: "ready", plans: cached });
      return;
    }
    let cancelled = false;
    setState({ status: "loading" });
    (async () => {
      try {
        const res = await fetch(`/api/clients/${clientId}/comparison-plans`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ plans: unique }),
        });
        if (!res.ok) throw new Error(`comparison-plans fetch failed: ${res.status}`);
        const json = (await res.json()) as { plans: ComparisonPlan[] };
        if (cancelled) return;
        cache.current.set(key, json.plans);
        setState({ status: "ready", plans: json.plans });
      } catch (e) {
        if (!cancelled) {
          setState({ status: "error", error: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, key, enabled]);

  return state;
}
