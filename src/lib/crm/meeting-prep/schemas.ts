//
// Contracts between the wizard, the LLM draft, and the PDF renderers.
// AI-authored blocks live here; deterministic data (tasks, accounts, vitals)
// is re-derived server-side at export and never round-trips the client.
import { z } from "zod";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const MEETING_PREP_DOC_KINDS = ["brief", "agenda"] as const;
export type MeetingPrepDocKind = (typeof MEETING_PREP_DOC_KINDS)[number];

export const MeetingPrepSetupSchema = z.object({
  focus: z.string().min(1).max(2_000),
  context: z.string().max(10_000).default(""),
  meetingDate: z.string().regex(ISO_DATE), // YYYY-MM-DD
  // null → auto: since last meeting/call, 90-day fallback
  windowStart: z.string().regex(ISO_DATE).nullable().default(null),
  docs: z.array(z.enum(MEETING_PREP_DOC_KINDS)).min(1).default(["brief", "agenda"]),
});
export type MeetingPrepSetup = z.infer<typeof MeetingPrepSetupSchema>;

export const PrepBriefDraftSchema = z.object({
  briefing: z.string().min(1).max(8_000), // markdown paragraphs
  sinceLastMeeting: z.array(z.string().max(500)).max(12).default([]),
  talkingPoints: z.array(z.string().max(500)).max(12).default([]),
  openQuestions: z.array(z.string().max(500)).max(12).default([]),
  personalNotes: z.array(z.string().max(500)).max(10).default([]),
});
export type PrepBriefDraft = z.infer<typeof PrepBriefDraftSchema>;

export const AgendaDraftSchema = z.object({
  agendaItems: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        description: z.string().max(600).default(""),
      }),
    )
    .min(1)
    .max(8),
});
export type AgendaDraft = z.infer<typeof AgendaDraftSchema>;
