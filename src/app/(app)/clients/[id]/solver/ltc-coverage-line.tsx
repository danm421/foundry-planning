"use client";

import type { ClientInfo } from "@/engine/types";
import type { LtcCoverage } from "@/engine/ltc-event";
import { ltcCoverageLines } from "@/lib/ltc/ltc-coverage-text";

/** What the LTC policies pay in this stress test. Shown under "Include LTC
 *  policies" and in the Stress row's saved state. */
export function LtcCoverageLine({ coverage, client }: { coverage: LtcCoverage; client: ClientInfo }) {
  return (
    <div className="space-y-1 text-[12px] leading-snug text-ink-2">
      {ltcCoverageLines(coverage, client).map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  );
}
