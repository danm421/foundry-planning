import { z } from "zod";

export const accountGroupNameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(80, "Name must be 80 characters or fewer");

export const createAccountGroupSchema = z.object({
  name: accountGroupNameSchema,
  description: z.string().max(500).nullish(),
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Invalid hex color")
    .nullish(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  memberAccountIds: z.array(z.uuid()).default([]),
});

export const updateAccountGroupSchema = z.object({
  name: accountGroupNameSchema.optional(),
  description: z.string().max(500).nullish(),
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/)
    .nullish(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  // When present, replaces the full member set (not partial).
  memberAccountIds: z.array(z.uuid()).optional(),
});

export type CreateAccountGroupInput = z.infer<typeof createAccountGroupSchema>;
export type UpdateAccountGroupInput = z.infer<typeof updateAccountGroupSchema>;
