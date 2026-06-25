// src/domain/forge/tools/__tests__/meetings.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: vi.fn() }));
vi.mock("@/lib/clients/authz", () => ({ verifyClientAccess: vi.fn() }));
vi.mock("../../guards", () => ({ clientToHousehold: vi.fn() }));
vi.mock("@/lib/forge/meeting-transcripts", () => ({ getOwnedMeetingTranscript: vi.fn(), deleteMeetingTranscript: vi.fn() }));
vi.mock("../../llm", () => ({ chatModel: vi.fn() }));
vi.mock("@/lib/crm/notes", () => ({ createNote: vi.fn() }));
vi.mock("@/lib/crm/documents", () => ({ uploadCrmDocument: vi.fn() }));
vi.mock("@/lib/crm/folders", () => ({ ensureTranscriptsFolder: vi.fn() }));
vi.mock("@/lib/crm-tasks/mutations", () => ({ createTask: vi.fn() }));
vi.mock("@/lib/audit", () => ({ recordAudit: vi.fn() }));

import { buildMeetingTools } from "../meetings";
import { requireOrgId } from "@/lib/db-helpers";
import { verifyClientAccess } from "@/lib/clients/authz";
import { clientToHousehold } from "../../guards";
import { getOwnedMeetingTranscript, deleteMeetingTranscript } from "@/lib/forge/meeting-transcripts";
import { chatModel } from "../../llm";
import { createNote } from "@/lib/crm/notes";
import { uploadCrmDocument } from "@/lib/crm/documents";
import { ensureTranscriptsFolder } from "@/lib/crm/folders";
import { createTask } from "@/lib/crm-tasks/mutations";

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

function getSave() {
  return buildMeetingTools(CTX as never).find((t) => t.name === "save_meeting_record")!;
}

describe("save_meeting_record", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Re-establish gate mocks cleared above.
    vi.mocked(requireOrgId).mockResolvedValue("firm_1");
    vi.mocked(verifyClientAccess).mockResolvedValue({ ok: true, firmId: "firm_1" } as never);
    vi.mocked(clientToHousehold).mockResolvedValue("hh_1");
    vi.mocked(getOwnedMeetingTranscript).mockResolvedValue({ id: "tr_1", householdId: "hh_1", rawText: "Advisor: hi", wordCount: 2 } as never);
    vi.mocked(createNote).mockResolvedValue({ id: "note_1" } as never);
    vi.mocked(ensureTranscriptsFolder).mockResolvedValue("folder_1" as never);
    vi.mocked(uploadCrmDocument).mockResolvedValue({ id: "doc_1" } as never);
    vi.mocked(createTask).mockResolvedValue({ id: "task_1" } as never);
  });

  it("writes note + document + tasks and deletes the staging row", async () => {
    const out = JSON.parse(String(await getSave().invoke({
      transcriptId: "tr_1",
      summaryTitle: "Annual review",
      summary: "Recap",
      meetingDate: "2026-06-25",
      tasks: [{ title: "Send IPS", description: "", priority: "med", dueDate: null }],
    })));
    expect(out).toEqual({ noteId: "note_1", documentId: "doc_1", tasksCreated: 1 });
    expect(createNote).toHaveBeenCalledWith("hh_1", "firm_1", "u", expect.objectContaining({ noteKind: "meeting" }));
    expect(uploadCrmDocument).toHaveBeenCalledWith("hh_1", expect.any(File), expect.objectContaining({ folderId: "folder_1" }));
    expect(createTask).toHaveBeenCalledWith("firm_1", "u", expect.objectContaining({ householdId: "hh_1", title: "Send IPS" }));
    expect(deleteMeetingTranscript).toHaveBeenCalledWith("tr_1", "client_1", "firm_1");
  });

  it("refuses a transcript outside the client (IDOR)", async () => {
    vi.mocked(getOwnedMeetingTranscript).mockResolvedValue(null);
    const out = String(await getSave().invoke({ transcriptId: "tr_x", summaryTitle: "t", summary: "s", meetingDate: "2026-06-25", tasks: [] }));
    expect(out).toMatch(/not found/i);
    expect(createNote).not.toHaveBeenCalled();
  });
});
