import type { ProjectionYear } from "@/engine/types";

export type MetricFormat = "currency" | "percent" | "number" | "years";

export type MetricFetchCtx = {
  client: { id: string };
  projection: ProjectionYear[];      // pre-run projection
  year: number;
  prevYear?: ProjectionYear;
};

export type MetricRegistryEntry = {
  key: string;
  label: string;
  format: MetricFormat;
  category: "Net worth" | "Cashflow" | "Tax" | "Outlook" | "Estate";
  fetch: (ctx: MetricFetchCtx) => number | null;       // null = unavailable
};

const REGISTRY = new Map<string, MetricRegistryEntry>();

export function registerMetric(entry: MetricRegistryEntry): void {
  REGISTRY.set(entry.key, entry);
}

export function getMetric(key: string): MetricRegistryEntry {
  const m = REGISTRY.get(key);
  if (!m) throw new Error(`Unknown metric: ${key}`);
  return m;
}

export function listMetrics(): MetricRegistryEntry[] {
  return [...REGISTRY.values()];
}

export function formatMetric(value: number | null, format: MetricFormat): string {
  if (value == null) return "—";
  switch (format) {
    case "currency":
      return value.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "years":
      return `${value.toFixed(1)} yrs`;
    case "number":
      return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  }
}
