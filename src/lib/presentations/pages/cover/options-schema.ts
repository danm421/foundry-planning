import { z } from "zod";
import type { CoverPageOptions } from "@/lib/presentations/types";

export const coverOptionsSchema = z.object({
  title: z.string().max(120),
}) satisfies z.ZodType<CoverPageOptions>;

export type CoverOptions = z.infer<typeof coverOptionsSchema>;
