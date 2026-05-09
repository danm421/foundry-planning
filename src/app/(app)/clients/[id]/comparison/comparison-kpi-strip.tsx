const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function fmtUsdDelta(v: number | undefined): string {
  if (v === undefined) return "…";
  if (v === 0) return "$0";
  return `${v < 0 ? "−" : "+"}${usd.format(Math.abs(v))}`;
}
function fmtPctPtsDelta(v: number | undefined): string {
  if (v === undefined) return "…";
  const pts = v * 100;
  if (pts === 0) return "0 pts";
  return `${pts < 0 ? "−" : "+"}${Math.abs(pts).toFixed(0)} pts`;
}
function fmtYearsDelta(v: number | undefined): string {
  if (v === undefined) return "…";
  if (v === 0) return "0";
  return `${v < 0 ? "−" : "+"}${Math.abs(v)}`;
}

function deltaClass(v: number | undefined, better: "higher" | "lower"): string {
  if (v === undefined || v === 0) return "text-slate-300";
  const isBetter = better === "higher" ? v > 0 : v < 0;
  return isBetter ? "text-emerald-400" : "text-rose-400";
}

interface Props {
  endingNetWorthDelta: number;
  mcSuccessDelta: number | undefined;
  lifetimeTaxDelta: number;
  toHeirsDelta: number;
  estateTaxDelta: number;
  yearsSurvivesDelta: number;
}

export function ComparisonKpiStrip(p: Props) {
  const tiles = [
    { label: "Ending NW", value: fmtUsdDelta(p.endingNetWorthDelta), cls: deltaClass(p.endingNetWorthDelta, "higher") },
    { label: "MC Success", value: fmtPctPtsDelta(p.mcSuccessDelta), cls: deltaClass(p.mcSuccessDelta, "higher") },
    { label: "Lifetime Tax", value: fmtUsdDelta(p.lifetimeTaxDelta), cls: deltaClass(p.lifetimeTaxDelta, "lower") },
    { label: "To Heirs", value: fmtUsdDelta(p.toHeirsDelta), cls: deltaClass(p.toHeirsDelta, "higher") },
    { label: "Estate Tax", value: fmtUsdDelta(p.estateTaxDelta), cls: deltaClass(p.estateTaxDelta, "lower") },
    { label: "Years Survives", value: fmtYearsDelta(p.yearsSurvivesDelta), cls: deltaClass(p.yearsSurvivesDelta, "higher") },
  ];
  return (
    <div className="sticky top-[57px] z-10 grid grid-cols-3 gap-px border-b border-slate-800 bg-slate-900 md:grid-cols-6">
      {tiles.map((t) => (
        <div key={t.label} className="bg-slate-950 px-4 py-3">
          <div className="text-xs uppercase tracking-wide text-slate-400">{t.label}</div>
          <div className={`text-xl font-semibold ${t.cls}`}>{t.value}</div>
        </div>
      ))}
    </div>
  );
}
