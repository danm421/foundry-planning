import { z } from "zod";

export const accountSplitSchema = z.object({
  clientShare: z.number().gt(0).lt(1),
});

export type AccountSplitInput = z.infer<typeof accountSplitSchema>;
