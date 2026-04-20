import { z } from "zod";
import { uuidLike } from "./common";

export const allocationPutSchema = z
  .object({
    allocations: z
      .array(
        z
          .object({
            assetClassId: uuidLike,
            weight: z.number().min(0).max(1),
          })
          .strict()
      )
      .max(100),
  })
  .strict();

export type AllocationPutBody = z.infer<typeof allocationPutSchema>;
