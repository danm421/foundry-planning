import { MoneyText } from "foundry-planning";
import type { ReactNode } from "react";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-8 py-1.5">
      <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{label}</span>
      {children}
    </div>
  );
}

export function Formats() {
  return (
    <div className="bg-paper text-ink font-sans p-6 w-[340px]">
      <Row label="currency">
        <MoneyText value={4213850} />
      </Row>
      <Row label="accounting · negative">
        <MoneyText value={-12400} format="accounting" />
      </Row>
      <Row label="pct">
        <MoneyText value={0.874} format="pct" />
      </Row>
      <Row label="int">
        <MoneyText value={1000} format="int" />
      </Row>
      <Row label="null → em dash">
        <MoneyText value={null} />
      </Row>
    </div>
  );
}

export function KpiSize() {
  return (
    <div className="bg-paper text-ink font-sans p-6">
      <div className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
        Projected estate to heirs
      </div>
      <div className="mt-1">
        <MoneyText value={2847300} size="kpi" />
      </div>
    </div>
  );
}
