import { describe, expect, it } from "vitest";
import React from "react";
import { renderToBuffer } from "@react-pdf/renderer";
import type { DocumentProps } from "@react-pdf/renderer";
import { PrepBriefDocument } from "../prep-brief-document";
import { AgendaDocument } from "../agenda-document";
import { buildMeetingPrepPdfModel } from "../view-model";
import type { MeetingPrepBattery } from "@/lib/crm/meeting-prep/battery";

const battery: MeetingPrepBattery = {
  household: { id: "h1", name: "The Coopers", clientSince: "2024-01-15" },
  contacts: [],
  windowStart: "2026-04-01",
  lastMeetingDate: "2026-04-01",
  notesInWindow: [],
  recentNotes: [],
  outstandingTasks: [
    { id: "t1", title: "Send Roth analysis", status: "open", priority: "high", dueDate: "2026-06-01", completedAt: null },
  ],
  completedTasks: [
    { id: "t2", title: "Rebalanced portfolio", status: "done", priority: "med", dueDate: null, completedAt: "2026-05-15" },
  ],
  portfolio: {
    source: "planning",
    accounts: [{ name: "Brokerage", category: "Taxable", custodian: null, balance: 500_000, balanceAsOf: null }],
    total: 500_000,
  },
  vitals: { netWorth: 2_000_000, liquidPortfolio: 1_300_000, yearsToRetirement: 4, mcSuccessRate: 0.82 },
  alerts: [],
};

const model = buildMeetingPrepPdfModel({
  battery,
  setup: { focus: "Roth conversion", context: "", meetingDate: "2026-07-10", windowStart: null, docs: ["brief", "agenda"] },
  preparedBy: "Dan Mueller",
  generatedAt: "Jul 2, 2026, 9:00 AM",
});

describe("meeting-prep PDF documents", () => {
  it("view model flags overdue tasks and formats currency", () => {
    expect(model.outstandingTasks[0].overdue).toBe(true);
    expect(model.portfolio.totalDisplay).toBe("$500,000");
    expect(model.vitals.find((v) => v.label === "Monte Carlo success")?.value).toBe("82%");
  });

  it("renders the Prep Brief to a non-empty PDF buffer", async () => {
    const doc = React.createElement(PrepBriefDocument, {
      model,
      draft: {
        briefing: "Sam and Pat Cooper are four years from retirement.",
        sinceLastMeeting: ["Sold the lake house"],
        talkingPoints: ["Roth conversion sizing"],
        openQuestions: ["401k rollover amount?"],
        personalNotes: ["Grandchild born in May"],
      },
    }) as React.ReactElement<DocumentProps>;
    const buffer = await renderToBuffer(doc);
    expect(buffer.length).toBeGreaterThan(1_000);
  }, 30_000);

  it("renders the Agenda to a non-empty PDF buffer", async () => {
    const doc = React.createElement(AgendaDocument, {
      model,
      draft: { agendaItems: [{ title: "Portfolio review", description: "How your accounts have grown." }] },
      logoDataUrl: null,
    }) as React.ReactElement<DocumentProps>;
    const buffer = await renderToBuffer(doc);
    expect(buffer.length).toBeGreaterThan(1_000);
  }, 30_000);
});
