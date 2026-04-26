import type { TopRisk } from "./lib/top-risks";

const TONE_DOT: Record<TopRisk["tone"], string> = {
  emerald: "bg-emerald-400",
  amber: "bg-amber-400",
  rose: "bg-rose-400",
};

const TONE_TEXT: Record<TopRisk["tone"], string> = {
  emerald: "text-emerald-300",
  amber: "text-amber-300",
  rose: "text-rose-300",
};

interface TopRisksCardProps {
  risks: TopRisk[];
}

export function TopRisksCard({ risks }: TopRisksCardProps) {
  return (
    <section className="rounded-lg bg-slate-900/60 ring-1 ring-slate-800 p-4">
      <h3 className="text-sm font-semibold text-slate-100 mb-3">Top Risks</h3>
      {risks.length === 0 ? (
        <p className="text-[13px] text-slate-400">No elevated risks detected.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {risks.map((r) => (
            <li key={r.label} className="flex items-center gap-2 text-sm">
              <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[r.tone]}`} />
              <span className={TONE_TEXT[r.tone]}>{r.label}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
