import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ForbiddenError } from "@/lib/authz";
import { GraphThrottledError, WorkspaceReconnectRequiredError } from "@/lib/workspace/errors";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireActiveSubscription: vi.fn(),
  resolveActingConnection: vi.fn(),
  getMailboxTimeZone: vi.fn(),
  listEvents: vi.fn(),
  canEditEvent: vi.fn(),
  createEvent: vi.fn(),
  findHouseholdsByEmail: vi.fn(),
  linkEventHousehold: vi.fn(),
  recordAudit: vi.fn(),
}));

vi.mock("@clerk/nextjs/server", () => ({ auth: mocks.auth }));
vi.mock("@/lib/authz", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/authz")>()),
  requireActiveSubscription: mocks.requireActiveSubscription,
}));
vi.mock("@/lib/audit", () => ({ recordAudit: mocks.recordAudit }));
vi.mock("@/lib/workspace/acting-connection", () => ({ resolveActingConnection: mocks.resolveActingConnection }));
vi.mock("@/lib/workspace/microsoft/calendar", () => ({
  getMailboxTimeZone: mocks.getMailboxTimeZone,
  listEvents: mocks.listEvents,
  canEditEvent: mocks.canEditEvent,
  createEvent: mocks.createEvent,
}));
vi.mock("@/lib/workspace/client-links", () => ({
  findHouseholdsByEmail: mocks.findHouseholdsByEmail,
  linkEventHousehold: mocks.linkEventHousehold,
}));

import { GET, POST } from "./route";

const CONN = { id: "conn_1" };
const ev = (id: string, emails: string[]) => ({
  id,
  subject: "Meeting",
  attendees: emails.map((email) => ({ email, name: null })),
});

function get(start?: string) {
  return GET(new Request(`https://app.test/api/workspace/events${start ? `?start=${start}` : ""}`));
}
function post(body: unknown) {
  return POST(
    new Request("https://app.test/api/workspace/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("WORKSPACE_ENABLED", "true");
  mocks.auth.mockResolvedValue({ userId: "user_ada", orgId: "org_1", orgRole: "org:member" });
  mocks.requireActiveSubscription.mockResolvedValue(undefined);
  mocks.resolveActingConnection.mockResolvedValue(CONN);
  mocks.getMailboxTimeZone.mockResolvedValue("Eastern Standard Time");
  mocks.listEvents.mockResolvedValue([]);
  mocks.canEditEvent.mockReturnValue(false);
  mocks.findHouseholdsByEmail.mockResolvedValue(new Map());
  mocks.linkEventHousehold.mockReturnValue(null);
  mocks.recordAudit.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/workspace/events", () => {
  it("returns editable and household per event from one household lookup", async () => {
    const link = { householdId: "h1", householdName: "Smith" };
    mocks.listEvents.mockResolvedValue([ev("a", ["x@c.com"]), ev("b", ["y@c.com", "z@c.com"])]);
    mocks.canEditEvent.mockImplementation((e: { id: string }) => e.id === "a");
    mocks.linkEventHousehold.mockImplementation((e: { id: string }) => (e.id === "a" ? link : null));
    const res = await get("2026-11-02");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timeZone).toBe("Eastern Standard Time");
    expect(body.events.map((e: { id: string; editable: boolean; household: unknown }) => [e.id, e.editable, e.household])).toEqual([
      ["a", true, link],
      ["b", false, null],
    ]);
    expect(mocks.findHouseholdsByEmail).toHaveBeenCalledTimes(1);
    expect(mocks.findHouseholdsByEmail).toHaveBeenCalledWith({
      firmId: "org_1",
      userId: "user_ada",
      orgRole: "org:member",
      emails: ["x@c.com", "y@c.com", "z@c.com"],
    });
    expect(mocks.listEvents).toHaveBeenCalledWith({ conn: CONN }, { startDate: "2026-11-02", days: 7, timeZone: "Eastern Standard Time" });
  });

  it("is 409 needs_reconnect when the sign-in expired", async () => {
    mocks.resolveActingConnection.mockRejectedValue(new WorkspaceReconnectRequiredError());
    const res = await get("2026-11-02");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "needs_reconnect" });
  });

  it("is 503 throttled when Graph is throttling", async () => {
    mocks.listEvents.mockRejectedValue(new GraphThrottledError("rid"));
    const res = await get("2026-11-02");
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "throttled" });
  });

  it.each([[undefined], ["2026-10-28"], ["2026-11-03"], ["nope"], ["2026-02-30"], ["2026-11-02T00:00"]])(
    "is 400 for start=%s",
    async (start) => {
      const res = await get(start);
      expect(res.status).toBe(400);
      expect(mocks.resolveActingConnection).not.toHaveBeenCalled();
    },
  );

  it("is 404 when Workspace is off", async () => {
    vi.stubEnv("WORKSPACE_ENABLED", "false");
    const res = await get("2026-11-02");
    expect(res.status).toBe(404);
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});

describe("POST /api/workspace/events", () => {
  const valid = { subject: "Review", start: "2026-11-02T09:00", end: "2026-11-02T10:00", attendees: ["a@c.com"], teams: true };

  it("passes teams through, uses the mailbox zone, returns teamsFailed, audits ids only", async () => {
    mocks.createEvent.mockResolvedValue({ event: { id: "evt_1" }, teamsFailed: true });
    const res = await post(valid);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ event: { id: "evt_1" }, teamsFailed: true });
    expect(mocks.createEvent).toHaveBeenCalledWith({ conn: CONN }, { ...valid, timeZone: "Eastern Standard Time" });
    expect(mocks.recordAudit).toHaveBeenCalledWith({
      action: "workspace.event_create",
      resourceType: "workspace_event",
      resourceId: "evt_1",
      firmId: "org_1",
      metadata: { eventId: "evt_1" },
    });
  });

  it("is 403 and never calls Graph when the subscription lapsed", async () => {
    mocks.requireActiveSubscription.mockRejectedValue(new ForbiddenError("Active subscription required"));
    const res = await post(valid);
    expect(res.status).toBe(403);
    expect(mocks.resolveActingConnection).not.toHaveBeenCalled();
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });

  it("is 400 for end <= start and for malformed JSON", async () => {
    expect((await post({ ...valid, end: valid.start })).status).toBe(400);
    expect((await post("{nope")).status).toBe(400);
    expect(mocks.createEvent).not.toHaveBeenCalled();
  });
});
