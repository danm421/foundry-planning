import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/authz";
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

import { POST } from "./route";

const body = { subject: "Review", start: "2026-11-02T09:00", end: "2026-11-02T10:00", timeZone: "America/Chicago" };
const call = (b: unknown = body, connectionId = "conn_ms") =>
  POST(json(b, "POST"), { params: Promise.resolve({ connectionId }) });

describe("POST /api/workspace/accounts/[connectionId]/events", () => {
  beforeEach(() => {
    mocks.ms.createEvent.mockResolvedValue({ event: { id: "e1" }, videoFailed: false });
    mocks.g.createEvent.mockResolvedValue({ event: { id: "e2" }, videoFailed: true });
  });

  it("creates through the Microsoft adapter, passes the zone, audits provider and connection", async () => {
    const res = await call();
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ event: { id: "e1" }, videoFailed: false });
    expect(mocks.resolveActingConnection).toHaveBeenCalledWith({ firmId: "org_1", actorUserId: "user_ada", connectionId: "conn_ms" });
    expect(mocks.ms.createEvent).toHaveBeenCalledWith(MS, { ...body, attendees: [], video: false });
    expect(mocks.g.createEvent).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "workspace.event_create", metadata: { provider: "microsoft", connectionId: "conn_ms", eventId: "e1" } }),
    );
  });

  it("a Google connection uses the Google adapter and reports videoFailed", async () => {
    mocks.resolveActingConnection.mockResolvedValue(GOOGLE);
    const res = await call(body, "conn_g");
    expect(await res.json()).toEqual({ event: { id: "e2" }, videoFailed: true });
    expect(mocks.g.createEvent).toHaveBeenCalledTimes(1);
    expect(mocks.ms.createEvent).not.toHaveBeenCalled();
    expect(mocks.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ provider: "google", connectionId: "conn_g" }) }),
    );
  });

  it("is 400 for a Windows zone name, and touches nothing", async () => {
    const res = await call({ ...body, timeZone: "Central Standard Time" });
    expect(res.status).toBe(400);
    expect(mocks.resolveActingConnection).not.toHaveBeenCalled();
    expect(mocks.ms.createEvent).not.toHaveBeenCalled();
  });

  it("is 404 for a connection that isn't the advisor's", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceConnectionNotFoundError());
    expect((await call()).status).toBe(404);
    expect(mocks.ms.createEvent).not.toHaveBeenCalled();
  });

  it("is 403 impersonating while signed in as someone else", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceImpersonationError());
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "impersonating" });
    expect(mocks.recordAudit).not.toHaveBeenCalled();
  });

  it("is 403 and never reaches the provider when the subscription lapsed", async () => {
    mocks.requireActiveSubscription.mockRejectedValue(new ForbiddenError("Active subscription required"));
    expect((await call()).status).toBe(403);
    expect(mocks.resolveActingConnection).not.toHaveBeenCalled();
    expect(mocks.ms.createEvent).not.toHaveBeenCalled();
  });

  it("is 404 when Workspace is off", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    expect((await call()).status).toBe(404);
  });
});
