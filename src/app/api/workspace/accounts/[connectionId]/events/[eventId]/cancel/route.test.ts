import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { WorkspaceConnectionNotFoundError, WorkspaceImpersonationError } from "@/lib/workspace/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireActiveSubscription: vi.fn(),
  resolveActingConnection: vi.fn(),
  deleteConnection: vi.fn(),
  recordAudit: vi.fn(),
  ms: { createEvent: vi.fn(), moveEvent: vi.fn(), cancelEvent: vi.fn(), getEventForEdit: vi.fn(), createTodo: vi.fn(), updateTodo: vi.fn(), revoke: vi.fn() },
  g: { createEvent: vi.fn(), moveEvent: vi.fn(), cancelEvent: vi.fn(), getEventForEdit: vi.fn(), createTodo: vi.fn(), updateTodo: vi.fn(), revoke: vi.fn() },
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireActiveSubscription: mocks.requireActiveSubscription,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/acting-connection", () => ({ resolveActingConnection: mocks.resolveActingConnection }));
vi.mock("@/lib/workspace/connections", () => ({ deleteConnection: mocks.deleteConnection }));
vi.mock("@/lib/workspace/provider-adapter", () => ({
  adapterFor: (p: string) => (p === "google" ? mocks.g : mocks.ms),
}));

const MS = { id: "conn_ms", provider: "microsoft", userId: "user_ada", firmId: "org_1", status: "connected" };
const GOOGLE = { id: "conn_g", provider: "google", userId: "user_ada", firmId: "org_1", status: "connected" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
  mocks.requireActiveSubscription.mockResolvedValue(undefined);
  mocks.resolveActingConnection.mockResolvedValue(MS);
  mocks.recordAudit.mockResolvedValue(undefined);
  mocks.deleteConnection.mockResolvedValue(true);
});
afterEach(() => vi.unstubAllEnvs());

import { POST } from "./route";

const call = (connectionId = "conn_ms") =>
  POST(new Request("https://app.test/x", { method: "POST" }), { params: Promise.resolve({ connectionId, eventId: "evt/1=" }) });

describe("POST /api/workspace/accounts/[connectionId]/events/[eventId]/cancel", () => {
  beforeEach(() => {
    for (const a of [mocks.ms, mocks.g]) {
      a.getEventForEdit.mockResolvedValue({ isOrganizer: true, hasAttendees: true });
      a.cancelEvent.mockResolvedValue(undefined);
    }
  });

  it("cancels through the Microsoft adapter, notifying when there are attendees, and audits", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.ms.cancelEvent).toHaveBeenCalledWith(MS, "evt/1=", { hasAttendees: true });
    expect(mocks.g.cancelEvent).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace.event_cancel", metadata: { provider: "microsoft", connectionId: "conn_ms", eventId: "evt/1=", hasAttendees: true } }),
    );
  });

  it("a Google connection cancels through the Google adapter", async () => {
    mocks.resolveActingConnection.mockResolvedValue(GOOGLE);
    expect((await call("conn_g")).status).toBe(200);
    // (M8) The path's connection id is the one the gate checks.
    expect(mocks.resolveActingConnection).toHaveBeenCalledWith({ firmId: "org_1", actorUserId: "user_ada", connectionId: "conn_g" });
    expect(mocks.g.cancelEvent).toHaveBeenCalledTimes(1);
    expect(mocks.ms.cancelEvent).not.toHaveBeenCalled();
  });

  it("is 403 not_organizer and never cancels", async () => {
    mocks.ms.getEventForEdit.mockResolvedValue({ isOrganizer: false, hasAttendees: false });
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_organizer" });
    expect(mocks.ms.cancelEvent).not.toHaveBeenCalled();
  });

  it("is 404 for a connection that isn't the advisor's", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceConnectionNotFoundError());
    expect((await call()).status).toBe(404);
  });

  it("is 403 impersonating", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceImpersonationError());
    expect((await call()).status).toBe(403);
    expect(mocks.ms.cancelEvent).not.toHaveBeenCalled();
  });
});
