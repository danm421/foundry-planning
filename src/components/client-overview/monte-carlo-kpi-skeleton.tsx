import KpiCard from "./kpi-card";

export function MonteCarloKpiSkeleton() {
  return (
    <KpiCard
      href="#"
      num="03"
      categoryLabel="Resilience"
      category="life"
      label="Monte Carlo success"
      value={null}
      valueFormat="pct"
      footnote="10,000 trials"
      delta={null}
      loading
    />
  );
}
