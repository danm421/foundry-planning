"use client";

import type { ProjectionYear } from "@/engine";

interface Props {
  year: ProjectionYear | null;
  onClose: () => void;
}

function dollars(n: number) {
  return `$${Math.round(n).toLocaleString()}`;
}

export function MedicareDrillDownModal({ year, onClose }: Props) {
  if (!year || !year.medicare) return null;
  const { client, spouse } = year.medicare;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-surface-1 rounded-lg shadow-xl p-6 max-w-2xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-start mb-4">
          <h3 className="text-lg font-medium">Medicare detail — {year.year}</h3>
          <button onClick={onClose} className="text-ink-3 hover:text-ink-1">
            ✕
          </button>
        </div>

        {(["client", "spouse"] as const).map((who) => {
          const d = who === "client" ? client : spouse;
          if (!d || !d.enrolled) return null;
          return (
            <div key={who} className="mb-4 border-t border-line-2 pt-3">
              <div className="text-sm font-medium capitalize mb-2">
                {who} — age {d.age}
              </div>
              <table className="w-full text-sm">
                <tbody>
                  <tr>
                    <td className="text-ink-3">Part B (standard)</td>
                    <td className="text-right">{dollars(d.partBStandardPremium)}</td>
                  </tr>
                  <tr>
                    <td className="text-ink-3">Part B IRMAA surcharge</td>
                    <td className="text-right">{dollars(d.partBIrmaaSurcharge)}</td>
                  </tr>
                  <tr>
                    <td className="text-ink-3">Part D (plan + IRMAA)</td>
                    <td className="text-right">{dollars(d.partDPremium)}</td>
                  </tr>
                  <tr>
                    <td className="text-ink-3">Medigap</td>
                    <td className="text-right">{dollars(d.medigapPremium)}</td>
                  </tr>
                  <tr className="border-t border-line-2">
                    <td className="font-medium">Total</td>
                    <td className="text-right font-medium">{dollars(d.totalAnnualCost)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="mt-3 text-[12px] text-ink-3">
                Why tier {d.irmaaTier}? Source MAGI from {d.sourceYearForIrmaa}:{" "}
                {dollars(d.sourceMagi)} ({d.irmaaFilingStatus.toUpperCase()} brackets).
                {d.isColdStart &&
                  " Cold-start year — based on entered prior-year MAGI or year-0 projection."}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
