// Typed Zod schemas for the HITL approval interrupt + its resume payload,
// replacing the inline `as` casts at graph.ts (interrupt return) and the two
// route snapshot reads. The interrupt VALUE (what the graph surfaces to the UI)
// is an ApprovalInterrupt; the RESUME value (what the advisor sends back) is
// ResumeDecisions. zod v4 two-arg z.record(keyType, valueType).
import { z } from "zod";

export const WritePreviewSchema = z.object({
  summary: z.string(),
  name: z.string(),
  details: z.array(z.string()).optional(),
});
export const ApprovalCallSchema = z.object({
  id: z.string(),
  name: z.string(),
  args: z.record(z.string(), z.unknown()),
});
export const ApprovalInterruptSchema = z.object({
  type: z.literal("approval_required"),
  previews: z.array(WritePreviewSchema),
  calls: z.array(ApprovalCallSchema),
});
export const ResumeDecisionsSchema = z.object({
  decisions: z.record(z.string(), z.enum(["confirm", "reject"])),
});

export type WritePreview = z.infer<typeof WritePreviewSchema>;
export type ApprovalCall = z.infer<typeof ApprovalCallSchema>;
export type ApprovalInterrupt = z.infer<typeof ApprovalInterruptSchema>;
export type ResumeDecisions = z.infer<typeof ResumeDecisionsSchema>;

export function parseApprovalInterrupt(value: unknown): ApprovalInterrupt {
  return ApprovalInterruptSchema.parse(value);
}
export function parseResumeDecisions(value: unknown): ResumeDecisions {
  return ResumeDecisionsSchema.parse(value);
}
