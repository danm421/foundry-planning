import type { TopRisk } from "./lib/top-risks";

const TONE_DOT: Record<TopRisk["tone"], string> = {
  emerald: "bg-good",
  amber: "bg-warn",
  rose: "bg-crit",
};

const TONE_TEXT: Record<TopRisk["tone"], string> = {
  emerald: "text-good",
  amber: "text-warn",
  rose: "text-crit",
};

interface TopRisksCardProps {
  risks: TopRisk[];
}

export function TopRisksCard({ risks }: TopRisksCardProps) {
  return (
    <section className="rounded-lg bg-card ring-1 ring-hair p-4">
      <h3 className="text-sm font-semibold text-ink mb-3">Top Risks</h3>
      {risks.length === 0 ? (
        <p className="text-[13px] text-ink-3">No elevated risks detected.</p>
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
