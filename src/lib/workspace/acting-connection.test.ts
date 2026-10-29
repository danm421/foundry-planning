// src/lib/workspace/acting-connection.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveActingConnection } from "./acting-connection";
import { WorkspaceNotConnectedError, WorkspaceReconnectRequiredError } from "./errors";
import { getFirmApproval } from "./approvals";
import { hasMemberAccess } from "./access";
import { getUserConnection, type WorkspaceConnection } from "./connections";

vi.mock("./approvals", () => ({ getFirmApproval: vi.fn() }));
vi.mock("./access", () => ({ hasMemberAccess: vi.fn() }));
vi.mock("./connections", () => ({ getUserConnection: vi.fn() }));

const INPUT = { firmId: "firm-1", actorUserId: "actor-1", provider: "microsoft" as const };

const APPROVAL = { tenantId: "tenant-1", approvedScopes: "Calendars.ReadWrite", approvedAt: new Date() };

function connection(status: WorkspaceConnection["status"]): WorkspaceConnection {
  return {
    id: "conn-1",
    firmId: "firm-1",
    userId: "actor-1",
    provider: "microsoft",
    tenantId: "tenant-1",
    externalUserId: "oid-1",
    externalEmail: "advisor@firm.test",
    accessToken: "AT",
    refreshToken: "RT",
    tokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    scope: "Calendars.ReadWrite",
    status,
    lastError: status === "needs_reconnect" ? "invalid_grant" : null,
    connectedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

async function rejection(): Promise<unknown> {
  return resolveActingConnection(INPUT).catch((e: unknown) => e);
}

describe("resolveActingConnection", () => {
  beforeEach(() => {
    vi.mocked(getFirmApproval).mockResolvedValue(APPROVAL);
    vi.mocked(hasMemberAccess).mockResolvedValue(true);
    vi.mocked(getUserConnection).mockResolvedValue(connection("connected"));
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("no firm approval → WorkspaceNotConnectedError firm_not_approved", async () => {
    vi.mocked(getFirmApproval).mockResolvedValue(null);

    const err = await rejection();

    expect(err).toBeInstanceOf(WorkspaceNotConnectedError);
    expect((err as WorkspaceNotConnectedError).state).toBe("firm_not_approved");
    expect(getUserConnection).not.toHaveBeenCalled();
  });

  it("approved but the member switch is off → member_off", async () => {
    vi.mocked(hasMemberAccess).mockResolvedValue(false);

    const err = await rejection();

    expect(err).toBeInstanceOf(WorkspaceNotConnectedError);
    expect((err as WorkspaceNotConnectedError).state).toBe("member_off");
    expect(getUserConnection).not.toHaveBeenCalled();
  });

  it("switched on with no connection → connect", async () => {
    vi.mocked(getUserConnection).mockResolvedValue(null);

    const err = await rejection();

    expect(err).toBeInstanceOf(WorkspaceNotConnectedError);
    expect((err as WorkspaceNotConnectedError).state).toBe("connect");
  });

  it("(Review Focus 1) switched on with a needs_reconnect connection → WorkspaceReconnectRequiredError", async () => {
    vi.mocked(getUserConnection).mockResolvedValue(connection("needs_reconnect"));

    await expect(resolveActingConnection(INPUT)).rejects.toBeInstanceOf(WorkspaceReconnectRequiredError);
  });

  it("switched on and connected → returns the connection", async () => {
    const conn = connection("connected");
    vi.mocked(getUserConnection).mockResolvedValue(conn);

    await expect(resolveActingConnection(INPUT)).resolves.toBe(conn);
  });

  it("looks up only the actor's own access and connection", async () => {
    await resolveActingConnection(INPUT);

    expect(getFirmApproval).toHaveBeenCalledWith("firm-1", "microsoft");
    expect(hasMemberAccess).toHaveBeenCalledTimes(1);
    expect(hasMemberAccess).toHaveBeenCalledWith("firm-1", "actor-1", "microsoft");
    expect(getUserConnection).toHaveBeenCalledTimes(1);
    expect(getUserConnection).toHaveBeenCalledWith("firm-1", "actor-1", "microsoft");
  });

  it("a connection lookup failure (e.g. a token that won't decrypt) propagates, not needs-reconnect", async () => {
    const decryptFailure = new Error("Unsupported state or unable to authenticate data");
    vi.mocked(getUserConnection).mockRejectedValue(decryptFailure);

    await expect(resolveActingConnection(INPUT)).rejects.toBe(decryptFailure);
  });
});
