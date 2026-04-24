import { z } from "zod";
import { isoDate } from "./common";

const priority = z.enum(["low", "medium", "high"]);

export const openItemCreateSchema = z
  .object({
    title: z.string().min(1).max(500),
    priority: priority.default("medium"),
    dueDate: isoDate.nullable().optional(),
  })
  .strict();

export const openItemUpdateSchema = z
  .object({
    title: z.string().min(1).max(500).optional(),
    priority: priority.optional(),
    dueDate: isoDate.nullable().optional(),
    completedAt: z
      .union([z.string().datetime(), z.null()])
      .optional(),
  })
  .strict();

export type OpenItemCreateInput = z.infer<typeof openItemCreateSchema>;
export type OpenItemUpdateInput = z.infer<typeof openItemUpdateSchema>;
