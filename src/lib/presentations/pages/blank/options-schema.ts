// src/lib/presentations/pages/blank/options-schema.ts
import { z } from "zod";

export interface BlankPageOptions {
  markdown: string;
}

export const blankOptionsSchema = z.object({
  markdown: z.string(),
}) satisfies z.ZodType<BlankPageOptions>;

export const BLANK_PAGE_OPTIONS_DEFAULT: BlankPageOptions = { markdown: "" };
