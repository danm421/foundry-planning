import { z } from "zod";

/** `"YYYY-MM-DDTHH:mm"` in the mailbox time zone, no offset. */
export const wallClockSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

// Fixed-width wall-clock strings compare correctly as text.
const endAfterStart = (v: { start: string; end: string }) => v.end > v.start;
const END_AFTER_START = { message: "end must be after start", path: ["end"] };

export const createEventSchema = z
  .object({
    subject: z.string().trim().min(1).max(255),
    start: wallClockSchema,
    end: wallClockSchema,
    attendees: z.array(z.string().email()).max(50).default([]),
    teams: z.boolean().default(false),
  })
  .strict()
  .refine(endAfterStart, END_AFTER_START);

export const moveEventSchema = z
  .object({ start: wallClockSchema, end: wallClockSchema })
  .strict()
  .refine(endAfterStart, END_AFTER_START);

export const createTodoSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    dueDate: z.iso.date().nullable().default(null),
    notes: z.string().max(10000).default(""),
  })
  .strict();

export const updateTodoSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    dueDate: z.iso.date().nullable(),
    notes: z.string().max(10000),
    completed: z.boolean(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "at least one field is required" });
