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

const json = (b: unknown, method: string) =>
  new Request("https://app.test/x", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

import { PATCH } from "./route";

const body = { start: "2026-11-02T11:00", end: "2026-11-02T12:00", timeZone: "America/Chicago" };
const call = (b: unknown = body, connectionId = "conn_ms") =>
  PATCH(json(b, "PATCH"), { params: Promise.resolve({ connectionId, eventId: "evt/1=" }) });

describe("PATCH /api/workspace/accounts/[connectionId]/events/[eventId]", () => {
  beforeEach(() => {
    for (const a of [mocks.ms, mocks.g]) {
      a.getEventForEdit.mockResolvedValue({ isOrganizer: true, hasAttendees: true });
      a.moveEvent.mockResolvedValue({ id: "evt/1=" });
    }
  });

  it("moves through the Microsoft adapter with the decoded id and zone, and audits", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ event: { id: "evt/1=" } });
    expect(mocks.ms.moveEvent).toHaveBeenCalledWith(MS, "evt/1=", body);
    expect(mocks.g.moveEvent).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace.event_move", resourceId: "evt/1=", metadata: { provider: "microsoft", connectionId: "conn_ms", eventId: "evt/1=" } }),
    );
  });

  it("a Google connection moves through the Google adapter", async () => {
    mocks.resolveActingConnection.mockResolvedValue(GOOGLE);
    expect((await call(body, "conn_g")).status).toBe(200);
    // (M8) The path's connection id is the one the gate checks.
    expect(mocks.resolveActingConnection).toHaveBeenCalledWith({ firmId: "org_1", actorUserId: "user_ada", connectionId: "conn_g" });
    expect(mocks.g.moveEvent).toHaveBeenCalledWith(GOOGLE, "evt/1=", body);
    expect(mocks.ms.moveEvent).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ provider: "google", connectionId: "conn_g" }) }),
    );
  });

  it("is 403 not_organizer and never moves when the advisor isn't the organizer", async () => {
    mocks.ms.getEventForEdit.mockResolvedValue({ isOrganizer: false, hasAttendees: true });
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "not_organizer" });
    expect(mocks.ms.moveEvent).not.toHaveBeenCalled();
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("is 400 for end <= start or a Windows zone name", async () => {
    expect((await call({ ...body, start: body.end, end: body.start })).status).toBe(400);
    expect((await call({ ...body, timeZone: "Central Standard Time" })).status).toBe(400);
    expect(mocks.ms.moveEvent).not.toHaveBeenCalled();
  });

  it("is 404 for a connection that isn't the advisor's", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceConnectionNotFoundError());
    expect((await call()).status).toBe(404);
    expect(mocks.ms.getEventForEdit).not.toHaveBeenCalled();
  });

  it("is 403 impersonating, and nothing is written", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceImpersonationError());
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "impersonating" });
    expect(mocks.ms.moveEvent).not.toHaveBeenCalled();
  });

  it("is 404 when Workspace is off", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    expect((await call()).status).toBe(404);
  });
});
