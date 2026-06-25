// src/domain/forge/tools/__tests__/meetings.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("../../guards", () => ({ clientToHousehold: vi.fn() }));
vi.mock("@/lib/forge/meeting-transcripts", () => ({ getOwnedMeetingTranscript: vi.fn() }));
vi.mock("../../llm", () => ({ chatModel: vi.fn() }));

import { buildMeetingTools } from "../meetings";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { clientToHousehold } from "../../guards";
import { getOwnedMeetingTranscript } from "@/lib/forge/meeting-transcripts";
import { chatModel } from "../../llm";

const CTX = {
  ctx: { userId: "u", firmId: "firm_1", clientId: "client_1", scenarioId: "base" },
  conversationId: "c1",
};

beforeEach(() => {
  vi.mocked(requireOrgId).mockResolvedValue("firm_1");
  vi.mocked(verifyClientAccess).mockResolvedValue({ ok: true, firmId: "firm_1" } as never);
  vi.mocked(clientToHousehold).mockResolvedValue("hh_1");
});

function getTool() {
  return buildMeetingTools(CTX as never).find((t) => t.name === "summarize_meeting_transcript")!;
}

describe("summarize_meeting_transcript", () => {
  it("returns a structured summary for an owned transcript", async () => {
    vi.mocked(getOwnedMeetingTranscript).mockResolvedValue({
      id: "tr_1",
      householdId: "hh_1",
      rawText: "Advisor: hi",
      wordCount: 2,
    });
    const invoke = vi.fn().mockResolvedValue({
      summaryTitle: "Annual review",
      summary: "Recap...",
      meetingDate: null,
      keyPoints: ["Roth"],
      proposedTasks: [{ title: "Send IPS", description: "", priority: "med", dueDate: null }],
    });
    vi.mocked(chatModel).mockReturnValue({ withStructuredOutput: () => ({ invoke }) } as never);
    const out = JSON.parse(String(await getTool().invoke({ transcriptId: "tr_1" })));
    expect(out.summaryTitle).toBe("Annual review");
    expect(out.proposedTasks).toHaveLength(1);
  });

  it("refuses a transcript outside the client (IDOR)", async () => {
    vi.mocked(getOwnedMeetingTranscript).mockResolvedValue(null);
    // chatModel isn't called in this path — no mock needed
    const out = String(await getTool().invoke({ transcriptId: "tr_x" }));
    expect(out).toMatch(/not found/i);
  });
});
