import { z } from "zod";
import type { EarlyYearsTidbitsPageOptions } from "./types";

// `.default()` on every field, for the same reason the sibling Early Years pages
// carry it: the export route passes RAW page options to the ref hooks while
// `document.tsx` passes `{...defaultOptions, ...options}`. A field that parses to
// `undefined` on one side and a value on the other makes the two disagree.
export const earlyYearsTidbitsOptionsSchema = z.object({
  tidbits: z.array(z.string()).max(6).default([]),
}) satisfies z.ZodType<EarlyYearsTidbitsPageOptions>;
