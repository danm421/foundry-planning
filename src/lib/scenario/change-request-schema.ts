// Client-safe request shapes for scenario change writes: zod plus the engine's
// lookup maps only (no db, no node:). Shared by the /changes route and the
// Solver's held-change mutation schema.
import { z } from "zod";
import {
  TARGET_KIND_TO_FIELD,
  SINGLETON_KIND_TO_FIELD,
} from "@/engine/scenario/applyChanges";
import type { TargetKind } from "@/engine/scenario/types";

// All writable TargetKind values, derived from the runtime lookup maps so the
// route enum stays in sync with applyChanges automatically. Unknown strings are
// rejected here with a 400 before they ever reach the writer (which would
// otherwise throw and surface as a 500).
export const WRITABLE_TARGET_KINDS = [
  ...Object.keys(TARGET_KIND_TO_FIELD),
  ...Object.keys(SINGLETON_KIND_TO_FIELD),
].filter((v, i, a) => a.indexOf(v) === i) as [TargetKind, ...TargetKind[]];

export const CHANGE_REQUEST_SCHEMA = z.discriminatedUnion("op", [
  z.object({
    op: z.literal("edit"),
    targetKind: z.enum(WRITABLE_TARGET_KINDS),
    targetId: z.string().uuid(),
    desiredFields: z.record(z.string(), z.unknown()),
    toggleGroupId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    op: z.literal("add"),
    targetKind: z.enum(WRITABLE_TARGET_KINDS),
    // entity must carry an `id` (the writer treats it as the targetId).
    entity: z
      .record(z.string(), z.unknown())
      .refine((e) => typeof e.id === "string" && e.id.length > 0, {
        message: "entity.id is required",
      }),
    toggleGroupId: z.string().uuid().nullable().optional(),
  }),
  z.object({
    op: z.literal("remove"),
    targetKind: z.enum(WRITABLE_TARGET_KINDS),
    targetId: z.string().uuid(),
    toggleGroupId: z.string().uuid().nullable().optional(),
  }),
]);
