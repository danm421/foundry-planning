// Zod contracts for the risk-profile mutation routes (Tasks 10-14).
import { z } from "zod";
import { RISK_LEVELS } from "@/lib/risk-levels";
import { ENV_ADJ_MIN, ENV_ADJ_MAX } from "./scoring";

const nonEmpty = z.string().trim().min(1).max(2000);

export const MANUAL_TOLERANCE_SCHEMA = z.object({
  level: z.enum(RISK_LEVELS),
  // A hand-set rung with no explanation is an unexplained change to a
  // suitability record. Always required.
  reason: nonEmpty,
});

export const ENVIRONMENT_SCHEMA = z
  .object({
    adjustment: z.number().int().min(ENV_ADJ_MIN).max(ENV_ADJ_MAX),
    reason: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.adjustment === 0 || (v.reason?.length ?? 0) > 0, {
    message: "Reasoning is required for a non-zero environmental adjustment",
    path: ["reason"],
  });

export const RTQ_SUBMIT_SCHEMA = z.object({
  answers: z.record(z.string().max(40), z.string().max(40)),
  environmentNote: z.string().trim().max(2000).optional(),
});

export const SEND_RTQ_SCHEMA = z.object({
  subject: z.enum(["primary", "spouse"]),
  recipientEmail: z.email().max(200),
  recipientName: z.string().trim().max(200).optional(),
});
