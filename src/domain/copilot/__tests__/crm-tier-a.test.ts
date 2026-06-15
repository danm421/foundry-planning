import { describe, it, expect, vi, beforeEach } from "vitest";

const requireOrgId = vi.fn();
const verifyClientAccess = vi.fn();
const clientToHousehold = vi.fn();
const createNote = vi.fn();
const recordActivity = vi.fn();
const recordAudit = vi.fn();

vi.mock("@/lib/db-helpers", () => ({ requireOrgId: () => requireOrgId() }));
vi.mock("@/lib/clients/authz", () => ({
  verifyClientAccess: (c: string, f: string) => verifyClientAccess(c, f),
}));
vi.mock("../guards", async (o) => ({
  ...(await o()),
  clientToHousehold: (c: string, f: string) => clientToHousehold(c, f),
}));
vi.mock("@/lib/crm/notes", () => ({
  createNote: (...a: unknown[]) => createNote(...a),
  listHouseholdNotes: vi.fn(),
}));
vi.mock("@/lib/crm/activity", () => ({
  recordActivity: (i: unknown, o: unknown) => recordActivity(i, o),
  listActivity: vi.fn(),
}));
vi.mock("@/lib/audit", () => ({ recordAudit: (a: unknown) => recordAudit(a) }));

import { buildCrmTools } from "../tools/crm";
import { buildToolContext } from "../context";

const ctx = { userId: "advisor-9", firmId: "org_A", clientId: "c1", scenarioId: "base" };
const byName = (n: string) =>
  buildCrmTools(buildToolContext(ctx, "conv-1")).find((t) => t.name === n)!;

beforeEach(() => {
  requireOrgId.mockResolvedValue("org_A");
  verifyClientAccess.mockResolvedValue(true);
  clientToHousehold.mockResolvedValue("hh-1");
  createNote.mockReset();
  recordActivity.mockReset();
  recordAudit.mockReset();
});

describe("crm_log_activity (Tier A)", () => {
  it("records activity with actorUserId=ctx.userId and fires copilot.tool_call", async () => {
    recordActivity.mockResolvedValue(undefined);
    const out = JSON.parse(
      await byName("crm_log_activity").invoke({
        kind: "call",
        title: "Quarterly check-in",
        body: "Reviewed allocation",
        occurredAt: "2026-06-15T10:00:00Z",
      }),
    );
    expect(recordActivity).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: "hh-1", kind: "call", title: "Quarterly check-in" }),
      { actorUserId: "advisor-9" },
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.tool_call",
        resourceType: "crm_activity",
        resourceId: "hh-1",
      }),
    );
    expect(out.ok).toBe(true);
    expect(out.kind).toBe("call");
  });

  it("returns an error string when access is denied", async () => {
    verifyClientAccess.mockResolvedValue(false);
    const out = await byName("crm_log_activity").invoke({ kind: "call", title: "test" });
    expect(out).toMatch(/access denied/i);
    expect(recordActivity).not.toHaveBeenCalled();
  });
});

describe("crm_add_note (Tier A)", () => {
  it("creates a note with actorUserId=ctx.userId and fires copilot.tool_call", async () => {
    createNote.mockResolvedValue({ id: "n1", subject: "Met with Sam", noteKind: "meeting" });
    const out = JSON.parse(
      await byName("crm_add_note").invoke({
        subject: "Met with Sam",
        body: "Discussed RMDs",
        noteKind: "meeting",
        noteDate: "2026-06-15",
      }),
    );
    expect(createNote).toHaveBeenCalledWith(
      "hh-1",
      "org_A",
      "advisor-9",
      expect.objectContaining({ subject: "Met with Sam", noteKind: "meeting" }),
    );
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "copilot.tool_call",
        resourceType: "crm_note",
        resourceId: "n1",
      }),
    );
    expect(out.note.id).toBe("n1");
  });

  it("returns an error string and does NOT write when access is denied", async () => {
    verifyClientAccess.mockResolvedValue(false);
    const out = await byName("crm_add_note").invoke({
      subject: "x",
      noteDate: "2026-06-15",
    });
    expect(out).toMatch(/access denied/i);
    expect(createNote).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});
