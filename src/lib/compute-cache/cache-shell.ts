// src/lib/compute-cache/cache-shell.ts
//
// Read-through cache envelope shared by getOrComputeMonteCarlo (monte-carlo.ts)
// and getOrComputeLifeInsuranceSolve (life-insurance.ts). It wraps the two
// graceful-degradation IO steps both helpers had verbatim — the cache read and
// the upsert — while the caller supplies the bespoke compute body.
//
// On a hash hit it returns the cached payload; otherwise it runs `compute`,
// persists the result keyed by (scenarioId, kind), and returns it. Cache
// read/write failures are logged and swallowed so a DB hiccup never blocks a
// fresh result.
import { db } from "@/db";
import { scenarioComputeCache } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { ENGINE_VERSION } from "./hash";
import { singleFlight } from "./single-flight";

type CacheKind = "monte_carlo" | "life_insurance_solve" | "max_spending";

export async function withComputeCache<T>(args: {
  firmId: string;
  clientId: string;
  realScenarioId: string;
  kind: CacheKind;
  inputHash: string;
  trials: number;
  forceRefresh?: boolean;
  /** Human label for cache log lines, e.g. "monte_carlo". */
  label: string;
  compute: () => Promise<T>;
}): Promise<T> {
  if (!args.forceRefresh) {
    try {
      const [row] = await db
        .select()
        .from(scenarioComputeCache)
        .where(
          and(
            eq(scenarioComputeCache.scenarioId, args.realScenarioId),
            eq(scenarioComputeCache.kind, args.kind),
          ),
        );
      if (row && row.inputHash === args.inputHash) {
        return row.payload as T;
      }
    } catch (err) {
      console.error(`${args.label} cache read failed; recomputing`, err);
    }
  }

  // Coalesce concurrent misses for the same (kind, scenario, inputHash): one
  // compute serves all callers on this instance instead of N competing for CPU.
  // (Each Monte Carlo run is ~75s single-threaded; two racing the gauge + report
  // fetches would otherwise time-slice and ~double the wall-clock.)
  return singleFlight(
    `${args.kind}:${args.realScenarioId}:${args.inputHash}`,
    async () => {
      const start = Date.now();
      const payload = await args.compute();
      const computeMs = Date.now() - start;

      try {
        await db
          .insert(scenarioComputeCache)
          .values({
            firmId: args.firmId,
            clientId: args.clientId,
            scenarioId: args.realScenarioId,
            kind: args.kind,
            inputHash: args.inputHash,
            trials: args.trials,
            engineVersion: ENGINE_VERSION,
            payload,
            computeMs,
          })
          .onConflictDoUpdate({
            target: [scenarioComputeCache.scenarioId, scenarioComputeCache.kind],
            set: {
              inputHash: args.inputHash,
              trials: args.trials,
              engineVersion: ENGINE_VERSION,
              payload,
              computeMs,
              computedAt: new Date(),
            },
          });
      } catch (err) {
        console.error(`${args.label} cache write failed; returning fresh result`, err);
      }

      return payload;
    },
  );
}
