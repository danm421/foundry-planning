// predev guard: Turbopack's persistent dev cache (.next/dev) is enabled by
// default since Next 16.1 and has no built-in size cap or eviction — it grows
// unbounded across sessions (we found it at 14GB once). This clears it ONLY
// when it crosses the threshold, so day-to-day warm starts stay fast and the
// cache self-heals before it balloons. Runs via `predev` before `next dev`.
//
// Tune the cap here if 3GB feels too aggressive/lenient.
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const DIR = ".next/dev";
const LIMIT_MB = 3000; // clear when .next/dev exceeds ~3GB

if (existsSync(DIR)) {
  try {
    const mb = parseInt(
      execFileSync("du", ["-sm", DIR]).toString().split("\t")[0],
      10
    );
    if (Number.isFinite(mb) && mb > LIMIT_MB) {
      console.log(
        `⚠ Turbopack dev cache is ${(mb / 1024).toFixed(1)}GB (> ${(
          LIMIT_MB / 1000
        ).toFixed(0)}GB) — clearing ${DIR} for a clean session.`
      );
      rmSync(DIR, { recursive: true, force: true });
    }
  } catch {
    // Never block `next dev` — if measuring/clearing fails, just continue.
  }
}
