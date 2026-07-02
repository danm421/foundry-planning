import { describe, expect, it } from "vitest";
import {
  MeetingPrepSetupSchema,
  PrepBriefDraftSchema,
  AgendaDraftSchema,
} from "../schemas";

describe("MeetingPrepSetupSchema", () => {
  it("accepts a minimal setup and defaults docs to both", () => {
    const s = MeetingPrepSetupSchema.parse({
      focus: "Annual review — Roth conversion decision",
      meetingDate: "2026-07-10",
    });
    expect(s.docs).toEqual(["brief", "agenda"]);
    expect(s.context).toBe("");
    expect(s.windowStart).toBeNull();
  });

  it("rejects an empty focus and a malformed date", () => {
    expect(() =>
      MeetingPrepSetupSchema.parse({ focus: "", meetingDate: "2026-07-10" }),
    ).toThrow();
    expect(() =>
      MeetingPrepSetupSchema.parse({ focus: "x", meetingDate: "July 10" }),
    ).toThrow();
  });

  it("rejects an empty docs array", () => {
    expect(() =>
      MeetingPrepSetupSchema.parse({
        focus: "x",
        meetingDate: "2026-07-10",
        docs: [],
      }),
    ).toThrow();
  });
});

describe("draft schemas", () => {
  it("parses a brief draft and defaults list sections", () => {
    const d = PrepBriefDraftSchema.parse({ briefing: "Hi." });
    expect(d.sinceLastMeeting).toEqual([]);
    expect(d.talkingPoints).toEqual([]);
    expect(d.openQuestions).toEqual([]);
    expect(d.personalNotes).toEqual([]);
  });

  it("requires at least one agenda item", () => {
    expect(() => AgendaDraftSchema.parse({ agendaItems: [] })).toThrow();
    const a = AgendaDraftSchema.parse({
      agendaItems: [{ title: "Portfolio review" }],
    });
    expect(a.agendaItems[0].description).toBe("");
  });
});
