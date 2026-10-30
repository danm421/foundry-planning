import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceImpersonationError } from "@/lib/workspace/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireActiveSubscription: vi.fn(),
  listActingConnections: vi.fn(),
  getEventForEdit: vi.fn(),
  getMailboxTimeZone: vi.fn(),
  moveEvent: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireActiveSubscription: mocks.requireActiveSubscription,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/acting-connection", () => ({ listActingConnections: mocks.listActingConnections }));
vi.mock("@/lib/workspace/microsoft/calendar", () => ({
  getEventForEdit: mocks.getEventForEdit,
  getMailboxTimeZone: mocks.getMailboxTimeZone,
  moveEvent: mocks.moveEvent,
}));

import { PATCH } from "./route";

const CONN = { id: "conn_1" };
const body = { start: "2026-11-02T11:00", end: "2026-11-02T12:00" };

function patch(b: unknown, eventId = "evt/1=") {
  return PATCH(
    new Request("https://app.test/api/workspace/events/x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(b),
    }),
    { params: Promise.resolve({ eventId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
  mocks.requireActiveSubscription.mockResolvedValue(undefined);
  mocks.listActingConnections.mockResolvedValue([CONN]);
  mocks.getEventForEdit.mockResolvedValue({ isOrganizer: true, hasAttendees: true });
  mocks.getMailboxTimeZone.mockResolvedValue("Eastern Standard Time");
  mocks.moveEvent.mockResolvedValue({ id: "evt/1=" });
  mocks.recordAudit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("PATCH /api/workspace/events/[eventId]", () => {
  it("moves with the mailbox time zone, passing the decoded id through, and audits", async () => {
    const res = await patch(body);
    expect(res.status).toBe(200);
    expect(mocks.moveEvent).toHaveBeenCalledWith({ conn: CONN }, "evt/1=", { ...body, timeZone: "Eastern Standard Time" });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace.event_move", resourceId: "evt/1=", firmId: "org_1" }),
    );
  });

  it("is 403 not_organizer and never moves when the advisor isn't the organizer", async () => {
    mocks.getEventForEdit.mockResolvedValue({ isOrganizer: false, hasAttendees: true });
    const res = await patch(body);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_organizer" });
    expect(mocks.moveEvent).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("is 400 when end <= start", async () => {
    const res = await patch({ start: body.end, end: body.start });
    expect(res.status).toBe(400);
    expect(mocks.moveEvent).not.toHaveBeenCalled();
  });

  it("is 404 when Workspace is off", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    expect((await patch(body)).status).toBe(404);
  });

  it("(interim, replaced in Task 9) no connected accounts → 409 connect, and nothing is written", async () => {
    mocks.listActingConnections.mockResolvedValue([]);
    const res = await patch(body);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "connect" });
    expect(mocks.moveEvent).not.toHaveBeenCalled();
  });

  it("(Review Focus 5) an impersonation session → 403 impersonating, and nothing is written", async () => {
    mocks.listActingConnections.mockRejectedValue(new WorkspaceImpersonationError());
    const res = await patch(body);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "impersonating" });
    expect(mocks.moveEvent).not.toHaveBeenCalled();
  });
});
