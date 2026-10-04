import type { z } from "zod";
import type { TargetKind } from "@/engine/scenario/types";
import { ltcEventSchema } from "@/lib/schemas/ltc-event";
import { stressTestSchema } from "@/lib/schemas/stress-test";

/** Scenario-only kinds saved WHOLE: the Solver's stress tests. They have no
 *  Details form to shape a partial edit, so an `add` carries the full entity —
 *  validated here, then upserted — and an `edit` is refused (it would merge an
 *  unvalidated partial payload into the stored entity). The changes route and
 *  the shared writer both read this map. */
export const WHOLE_ENTITY_SCHEMAS: Partial<Record<TargetKind, z.ZodType<{ id: string }>>> = {
  ltc_event: ltcEventSchema,
  stress_test: stressTestSchema,
};
