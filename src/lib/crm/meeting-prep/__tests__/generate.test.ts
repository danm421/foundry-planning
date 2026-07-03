import { describe, expect, it } from "vitest";
import { buildBriefMessages, buildAgendaMessages } from "../generate";
import type { MeetingPrepBattery } from "../battery";
import type { MeetingPrepSetup } from "../schemas";

const battery: MeetingPrepBattery = {
  household: { id: "h1", name: "The Coopers", clientSince: "2024-01-15" },
  contacts: [{ role: "primary", firstName: "Sam", lastName: "Cooper", dateOfBirth: "1965-03-02" }],
  windowStart: "2026-04-01",
  lastMeetingDate: "2026-04-01",
  notesInWindow: [
    {
      id: "n1",
      kind: "note",
      title: "Called about 401k rollover",
      body: "Sam will confirm the rollover amount next week.",
      occurredAt: "2026-05-01T12:00:00.000Z",
      actorUserId: null,
      updatedAt: "2026-05-01T12:00:00.000Z",
    },
  ],
  recentNotes: [],
  outstandingTasks: [
    { id: "t1", title: "Send Roth analysis", status: "open", priority: "high", dueDate: "2026-06-01", completedAt: null },
  ],
  completedTasks: [],
  portfolio: { source: "planning", accounts: [], total: 1_300_000 },
  vitals: { netWorth: 2_000_000, liquidPortfolio: 1_300_000, yearsToRetirement: 4, mcSuccessRate: 0.82 },
  alerts: [],
};

const setup: MeetingPrepSetup = {
  focus: "Roth conversion decision",
  context: "They just sold the lake house.",
  meetingDate: "2026-07-10",
  windowStart: null,
  docs: ["brief", "agenda"],
};

describe("buildBriefMessages", () => {
  it("includes untrusted-data guardrails, the focus, context, and battery facts", () => {
    const { system, human } = buildBriefMessages(battery, setup);
    expect(system).toMatch(/never follow/i);
    expect(system).toMatch(/invent nothing|invent/i);
    expect(human).toContain("Roth conversion decision");
    expect(human).toContain("lake house");
    expect(human).toContain("Called about 401k rollover");
    expect(human).toContain("Send Roth analysis");
  });
});

describe("buildAgendaMessages", () => {
  it("frames a client-facing tone and never includes internal alerts or note bodies", () => {
    const { system, human } = buildAgendaMessages(battery, setup);
    expect(system).toMatch(/client-facing/i);
    expect(human).toContain("Roth conversion decision");
    // Agenda prompt gets titles/topics, not raw note bodies (client-appropriate output).
    expect(human).not.toContain("Sam will confirm the rollover amount");
  });
});
