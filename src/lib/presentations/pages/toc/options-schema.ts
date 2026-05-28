import { z } from "zod";
import type { TocPageOptions } from "@/lib/presentations/types";

export const tocOptionsSchema = z.object({}) satisfies z.ZodType<TocPageOptions>;

export type TocOptions = z.infer<typeof tocOptionsSchema>;
