import { z } from "zod";
import { MAX_RATE_STRESS_POINTS } from "@/lib/tax/rate-stress";
import { MONEY, RATE, YEAR } from "@/lib/solver/mutation-schema";
import { STRESS_TEST_IDS } from "@/engine/stress-tests";
import type { StressTest } from "@/engine/types";

const FRACTION = z.number().min(0).max(1);
const head = { id: z.string().uuid(), name: z.string().trim().min(1).max(120) };

/** A saved stressor, validated whole wherever a `stress_test` change is
 *  written. Bounds are the solver's own (`SOLVER_MUTATION_SCHEMA`'s `stress-*`
 *  arms), so a draft that previews can always be saved. */
export const stressTestSchema = z
  .discriminatedUnion("kind", [
    z.object({ ...head, kind: z.literal("inflation"), rate: RATE }),
    z.object({ ...head, kind: z.literal("ss-haircut"), pct: FRACTION, startYear: YEAR }),
    z.object({ ...head, kind: z.literal("tax-rates"), points: z.number().min(0).max(MAX_RATE_STRESS_POINTS), startYear: YEAR }),
    z.object({ ...head, kind: z.literal("disability"), person: z.enum(["client", "spouse"]), startYear: YEAR, endYear: YEAR.nullable() }),
    z.object({ ...head, kind: z.literal("market-crash"), year: YEAR, drawdownPct: FRACTION }),
    z.object({ ...head, kind: z.literal("exemption-cap"), cap: MONEY }),
  ])
  // The fixed per-kind id is what makes a re-save update the scenario's one row
  // instead of adding a second stressor of the same kind beside it.
  .refine((t) => t.id === STRESS_TEST_IDS[t.kind], {
    message: "id must be the fixed id for this stress test kind",
    path: ["id"],
  }) satisfies z.ZodType<StressTest>;
