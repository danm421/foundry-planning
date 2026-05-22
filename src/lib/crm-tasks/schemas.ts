import { z } from "zod";

export const crmTaskPrioritySchema = z.enum(["low", "med", "high"]);
export const crmTaskStatusSchema = z.enum(["open", "in_progress", "blocked", "done"]);
export const crmTaskRecurrenceSchema = z.enum(["none", "weekly", "monthly", "quarterly"]);

export const createCrmTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(10_000).default(""),
  priority: crmTaskPrioritySchema.default("med"),
  status: crmTaskStatusSchema.default("open"),
  dueDate: z.iso.date().nullable().optional(),
  startDate: z.iso.date().nullable().optional(),
  recurrence: crmTaskRecurrenceSchema.default("none"),
  householdId: z.uuid().nullable().optional(),
  assigneeUserId: z.string().min(1).nullable().optional(),
});

// PATCH /api/crm/tasks/[taskId] takes a single typed field.
export const updateCrmTaskFieldSchema = z.discriminatedUnion("field", [
  z.object({ field: z.literal("title"), value: z.string().trim().min(1).max(200) }),
  z.object({ field: z.literal("description"), value: z.string().max(10_000) }),
  z.object({ field: z.literal("priority"), value: crmTaskPrioritySchema }),
  z.object({ field: z.literal("dueDate"), value: z.iso.date().nullable() }),
  z.object({ field: z.literal("startDate"), value: z.iso.date().nullable() }),
  z.object({ field: z.literal("recurrence"), value: crmTaskRecurrenceSchema }),
  z.object({ field: z.literal("householdId"), value: z.uuid().nullable() }),
  z.object({ field: z.literal("assigneeUserId"), value: z.string().min(1).nullable() }),
]);

export const setCrmTaskStatusSchema = z.object({
  status: crmTaskStatusSchema,
});

export const postCrmTaskCommentSchema = z.object({
  bodyMarkdown: z.string().trim().min(1).max(20_000),
});

export const createCrmTagSchema = z.object({
  label: z.string().trim().min(1).max(40),
  color: z.enum(["gold", "green", "blue", "red", "purple", "orange", "teal", "gray"]),
});

export const attachCrmTagSchema = z.object({
  tagId: z.uuid(),
});

export type CreateCrmTaskInput = z.infer<typeof createCrmTaskSchema>;
export type UpdateCrmTaskFieldInput = z.infer<typeof updateCrmTaskFieldSchema>;
export type SetCrmTaskStatusInput = z.infer<typeof setCrmTaskStatusSchema>;
export type PostCrmTaskCommentInput = z.infer<typeof postCrmTaskCommentSchema>;
export type CreateCrmTagInput = z.infer<typeof createCrmTagSchema>;
export type AttachCrmTagInput = z.infer<typeof attachCrmTagSchema>;
