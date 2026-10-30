import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceImpersonationError } from "@/lib/workspace/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireActiveSubscription: vi.fn(),
  listActingConnections: vi.fn(),
  getEventForEdit: vi.fn(),
  cancelEvent: vi.fn(),
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
  cancelEvent: mocks.cancelEvent,
}));

import { POST } from "./route";

const CONN = { id: "conn_1" };
const cancel = () =>
  POST(new Request("https://app.test/api/workspace/events/evt_1/cancel", { method: "POST" }), {
    params: Promise.resolve({ eventId: "evt_1" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
  mocks.requireActiveSubscription.mockResolvedValue(undefined);
  mocks.listActingConnections.mockResolvedValue([CONN]);
  mocks.getEventForEdit.mockResolvedValue({ isOrganizer: true, hasAttendees: true });
  mocks.cancelEvent.mockResolvedValue(undefined);
  mocks.recordAudit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/workspace/events/[eventId]/cancel", () => {
  it("cancels with hasAttendees and audits", async () => {
    const res = await cancel();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.cancelEvent).toHaveBeenCalledWith({ conn: CONN }, "evt_1", { hasAttendees: true });
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace.event_cancel", resourceId: "evt_1" }),
    );
  });

  it("passes hasAttendees:false for a solo event", async () => {
    mocks.getEventForEdit.mockResolvedValue({ isOrganizer: true, hasAttendees: false });
    await cancel();
    expect(mocks.cancelEvent).toHaveBeenCalledWith({ conn: CONN }, "evt_1", { hasAttendees: false });
  });

  it("is 403 and never cancels for a non-organizer", async () => {
    mocks.getEventForEdit.mockResolvedValue({ isOrganizer: false, hasAttendees: true });
    const res = await cancel();
    expect(res.status).toBe(403);
    expect(mocks.cancelEvent).not.toHaveBeenCalled();
  });

  it("(interim, replaced in Task 9) no connected accounts → 409 connect, and nothing is written", async () => {
    mocks.listActingConnections.mockResolvedValue([]);
    const res = await cancel();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "connect" });
    expect(mocks.cancelEvent).not.toHaveBeenCalled();
  });

  it("(Review Focus 5) an impersonation session → 403 impersonating, and nothing is written", async () => {
    mocks.listActingConnections.mockRejectedValue(new WorkspaceImpersonationError());
    const res = await cancel();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "impersonating" });
    expect(mocks.cancelEvent).not.toHaveBeenCalled();
  });
});
