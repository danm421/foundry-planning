// src/lib/workspace/acting-connection.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { listActingConnections, resolveActingConnection } from "./acting-connection";
import {
  WorkspaceConnectionNotFoundError,
  WorkspaceImpersonationError,
  WorkspaceReconnectRequiredError,
} from "./errors";
import { isImpersonating } from "./impersonation";
import { getConnectionById, listUserConnections, type WorkspaceConnection } from "./connections";

vi.mock("./impersonation", () => ({ isImpersonating: vi.fn() }));
vi.mock("./connections", () => ({ getConnectionById: vi.fn(), listUserConnections: vi.fn() }));

const CONN_ID = "6f1c2b9e-3d4a-4e5f-8a6b-7c8d9e0f1a2b";
const INPUT = { firmId: "firm-1", actorUserId: "actor-1", connectionId: CONN_ID };

function connection(over: Partial<WorkspaceConnection> = {}): WorkspaceConnection {
  return {
    id: CONN_ID,
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
    status: "connected",
    lastError: null,
    connectedAt: new Date("2026-01-01T00:00:00Z"),
    ...over,
  };
}

describe("resolveActingConnection", () => {
  beforeEach(() => {
    vi.mocked(isImpersonating).mockResolvedValue(false);
    vi.mocked(getConnectionById).mockResolvedValue(connection());
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("(Review Focus 5) an impersonation session is refused before anything is read", async () => {
    vi.mocked(isImpersonating).mockResolvedValue(true);

    await expect(resolveActingConnection(INPUT)).rejects.toBeInstanceOf(WorkspaceImpersonationError);
    expect(getConnectionById).not.toHaveBeenCalled();
  });

  it("the actor's own connected account is returned, looked up by its id", async () => {
    const conn = connection();
    vi.mocked(getConnectionById).mockResolvedValue(conn);

    await expect(resolveActingConnection(INPUT)).resolves.toBe(conn);
    expect(getConnectionById).toHaveBeenCalledWith(CONN_ID);
  });

  it("an id with no row → not found", async () => {
    vi.mocked(getConnectionById).mockResolvedValue(null);

    await expect(resolveActingConnection(INPUT)).rejects.toBeInstanceOf(WorkspaceConnectionNotFoundError);
  });

  it("another user's connection in the same firm → not found", async () => {
    vi.mocked(getConnectionById).mockResolvedValue(connection({ userId: "colleague-2" }));

    await expect(resolveActingConnection(INPUT)).rejects.toBeInstanceOf(WorkspaceConnectionNotFoundError);
  });

  it("another firm's connection, even one held by the same user id → not found", async () => {
    vi.mocked(getConnectionById).mockResolvedValue(connection({ firmId: "firm-2" }));

    await expect(resolveActingConnection(INPUT)).rejects.toBeInstanceOf(WorkspaceConnectionNotFoundError);
  });

  it.each(["not-a-uuid", "", "'; drop table x; --", `${CONN_ID}x`])(
    "(R12) a malformed id %j → not found, and never reaches the uuid column",
    async (connectionId) => {
      await expect(resolveActingConnection({ ...INPUT, connectionId })).rejects.toBeInstanceOf(
        WorkspaceConnectionNotFoundError,
      );
      expect(getConnectionById).not.toHaveBeenCalled();
    },
  );

  it("a needs_reconnect connection → WorkspaceReconnectRequiredError", async () => {
    vi.mocked(getConnectionById).mockResolvedValue(connection({ status: "needs_reconnect" }));

    await expect(resolveActingConnection(INPUT)).rejects.toBeInstanceOf(WorkspaceReconnectRequiredError);
  });

  it("allowNeedsReconnect returns a needs_reconnect connection (so it can be disconnected)", async () => {
    const conn = connection({ status: "needs_reconnect" });
    vi.mocked(getConnectionById).mockResolvedValue(conn);

    await expect(resolveActingConnection({ ...INPUT, allowNeedsReconnect: true })).resolves.toBe(conn);
  });

  it("allowNeedsReconnect never lets another user's connection through", async () => {
    vi.mocked(getConnectionById).mockResolvedValue(connection({ status: "needs_reconnect", userId: "colleague-2" }));

    await expect(resolveActingConnection({ ...INPUT, allowNeedsReconnect: true })).rejects.toBeInstanceOf(
      WorkspaceConnectionNotFoundError,
    );
  });

  it("a connection lookup failure (e.g. a token that won't decrypt) propagates, not needs-reconnect", async () => {
    const decryptFailure = new Error("Unsupported state or unable to authenticate data");
    vi.mocked(getConnectionById).mockRejectedValue(decryptFailure);

    await expect(resolveActingConnection(INPUT)).rejects.toBe(decryptFailure);
  });
});

describe("listActingConnections", () => {
  beforeEach(() => {
    vi.mocked(isImpersonating).mockResolvedValue(false);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("(Review Focus 5) an impersonation session is refused before anything is read", async () => {
    vi.mocked(isImpersonating).mockResolvedValue(true);

    await expect(listActingConnections({ firmId: "firm-1", actorUserId: "actor-1" })).rejects.toBeInstanceOf(
      WorkspaceImpersonationError,
    );
    expect(listUserConnections).not.toHaveBeenCalled();
  });

  it("returns the actor's own rows in the firm, every status, in the store's order", async () => {
    const rows = [connection(), connection({ id: "second", status: "needs_reconnect", provider: "google" })];
    vi.mocked(listUserConnections).mockResolvedValue(rows);

    await expect(listActingConnections({ firmId: "firm-1", actorUserId: "actor-1" })).resolves.toEqual(rows);
    expect(listUserConnections).toHaveBeenCalledTimes(1);
    expect(listUserConnections).toHaveBeenCalledWith("firm-1", "actor-1");
  });

  it("none connected → an empty list", async () => {
    vi.mocked(listUserConnections).mockResolvedValue([]);

    await expect(listActingConnections({ firmId: "firm-1", actorUserId: "actor-1" })).resolves.toEqual([]);
  });
});
