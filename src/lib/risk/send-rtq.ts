// src/lib/risk/send-rtq.ts
import { newIntakeToken, defaultExpiry } from "@/lib/intake/tokens";
import { RTQ_VERSION } from "./rtq";
import type { NewRiskQuestionnaireRow } from "@/db/schema";

/** Build the row for an emailed questionnaire. Reuses the intake token
 *  generator and 30-day expiry so both form types age out the same way. */
export function buildQuestionnaireRow(args: {
  clientId: string;
  firmId: string;
  createdByUserId: string;
  subject: "primary" | "spouse";
  recipientEmail: string;
  recipientName?: string;
  now: Date;
}): NewRiskQuestionnaireRow {
  return {
    clientId: args.clientId,
    firmId: args.firmId,
    createdByUserId: args.createdByUserId,
    subject: args.subject,
    recipientEmail: args.recipientEmail,
    recipientName: args.recipientName ?? null,
    token: newIntakeToken(),
    status: "sent",
    rtqVersion: RTQ_VERSION,
    answers: {},
    score: null,
    sentAt: args.now,
    expiresAt: defaultExpiry(args.now),
  };
}
