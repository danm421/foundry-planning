import { z } from "zod";

export const MAX_SCREENSHOTS = 3;
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_SCREENSHOT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const feedbackTypeSchema = z.enum(["bug", "feature"]);

export const feedbackSubmissionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("support"),
    subject: z.string().trim().min(1, "Subject is required").max(200),
    message: z.string().trim().min(1, "Message is required").max(5000),
    pageUrl: z.string().trim().max(2000).optional(),
  }),
  z.object({
    mode: z.literal("feedback"),
    type: feedbackTypeSchema,
    message: z.string().trim().min(1, "Message is required").max(5000),
    pageUrl: z.string().trim().max(2000).optional(),
  }),
]);

export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;

export type ScreenshotValidation = { ok: true } | { ok: false; error: string };

/** Defense-in-depth file validation; the client mirrors these rules. */
export function validateScreenshots(files: File[]): ScreenshotValidation {
  if (files.length > MAX_SCREENSHOTS) {
    return { ok: false, error: `At most ${MAX_SCREENSHOTS} screenshots.` };
  }
  for (const f of files) {
    if (!ALLOWED_SCREENSHOT_TYPES.includes(f.type as never)) {
      return { ok: false, error: `${f.name}: only PNG, JPG, or WebP images.` };
    }
    if (f.size > MAX_SCREENSHOT_BYTES) {
      return { ok: false, error: `${f.name}: exceeds 5 MB.` };
    }
  }
  return { ok: true };
}
