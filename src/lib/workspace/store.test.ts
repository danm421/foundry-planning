import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { inArray, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  workspaceConnections,
  workspaceFirmApprovals,
  workspaceMemberAccess,
  workspaceOauthStates,
} from "@/db/schema";
import type { ProviderTokenSet } from "./types";
import { createWorkspaceOauthState, consumeWorkspaceOauthState } from "./oauth-states";
import { getFirmApproval, upsertFirmApproval, deleteFirmProvider } from "./approvals";
import { hasMemberAccess, setMemberAccess, enableMembers, removeWorkspaceMember } from "./access";
import {
  listFirmConnectionSummaries,
  listUserConnections,
  upsertUserConnection,
  getConnectionById,
  listUserConnectionSummaries,
  listFirmConnections,
  deleteConnection,
} from "./connections";
import { MAX_ACCOUNTS_PER_ADVISOR } from "./accounts";
import type { WorkspaceProvider } from "./types";

const firmIds: string[] = [];
function freshFirmId(): string {
  const id = `org_test_${randomUUID()}`;
  firmIds.push(id);
  return id;
}

const tokens: ProviderTokenSet = {
  accessToken: "plain-access-token",
  refreshToken: "plain-refresh-token",
  expiresInSec: 3600,
  scope: "Calendars.ReadWrite offline_access",
  idToken: null,
};

function connect(firmId: string, userId: string, externalUserId: string, email = "a@x.com") {
  return upsertUserConnection({
    firmId, userId, provider: "microsoft", tenantId: "tenant-1",
    externalUserId, externalEmail: email, tokens,
  });
}

function connectAs(firmId: string, userId: string, provider: WorkspaceProvider, externalUserId: string, t: ProviderTokenSet = tokens) {
  return upsertUserConnection({
    firmId, userId, provider, tenantId: provider === "google" ? "" : "tenant-1",
    externalUserId, externalEmail: `${externalUserId}@x.com`, tokens: t,
  });
}

/** The user's Microsoft connection, or null; these tests give each user at most one. */
async function microsoftConnection(firmId: string, userId: string) {
  return (await listUserConnections(firmId, userId)).find((c) => c.provider === "microsoft") ?? null;
}

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(async () => {
  if (firmIds.length === 0) return;
  await db.delete(workspaceConnections).where(inArray(workspaceConnections.firmId, firmIds));
  await db.delete(workspaceMemberAccess).where(inArray(workspaceMemberAccess.firmId, firmIds));
  await db.delete(workspaceFirmApprovals).where(inArray(workspaceFirmApprovals.firmId, firmIds));
  await db.delete(workspaceOauthStates).where(inArray(workspaceOauthStates.firmId, firmIds));
});

describe("oauth states", () => {
  it("consumes once", async () => {
    const firmId = freshFirmId();
    const state = await createWorkspaceOauthState({
      firmId, provider: "microsoft", kind: "user_connect", userId: "u1", codeVerifier: "v", ttlMs: 60_000,
    });
    expect(await consumeWorkspaceOauthState(state)).toEqual({
      firmId, provider: "microsoft", kind: "user_connect", userId: "u1", codeVerifier: "v",
    });
    expect(await consumeWorkspaceOauthState(state)).toBeNull();
  });
  it("expired state consumes as null", async () => {
    const firmId = freshFirmId();
    const state = await createWorkspaceOauthState({
      firmId, provider: "microsoft", kind: "admin_consent", userId: "u1", codeVerifier: null, ttlMs: -1,
    });
    expect(await consumeWorkspaceOauthState(state)).toBeNull();
  });
});

describe("firm approval", () => {
  it("upsert twice keeps one row with the second tenant", async () => {
    const firmId = freshFirmId();
    const base = { firmId, provider: "microsoft" as const, approvedScopes: "a b", approvedByUserId: "admin" };
    await upsertFirmApproval({ ...base, tenantId: "t1" });
    await upsertFirmApproval({ ...base, tenantId: "t2" });
    const rows = await db.select().from(workspaceFirmApprovals).where(eq(workspaceFirmApprovals.firmId, firmId));
    expect(rows).toHaveLength(1);
    expect((await getFirmApproval(firmId, "microsoft"))?.tenantId).toBe("t2");
  });

  // Advisors sign in from any organization, so a re-approval from a DIFFERENT
  // tenant leaves their connections (and the access switches) alone.
  describe("re-approval and advisor connections", () => {
    const approve = (firmId: string, tenantId: string) =>
      upsertFirmApproval({ firmId, provider: "microsoft", tenantId, approvedScopes: "s", approvedByUserId: "admin" });

    async function approvedFirmWithConnectedAdvisor(): Promise<string> {
      const firmId = freshFirmId();
      await approve(firmId, "t1");
      await setMemberAccess({ firmId, provider: "microsoft", userId: "u1", enabled: true, updatedByUserId: "admin" });
      expect((await connect(firmId, "u1", "oid-1")).ok).toBe(true);
      return firmId;
    }

    it("the SAME tenant keeps the advisor's connection", async () => {
      const firmId = await approvedFirmWithConnectedAdvisor();
      await approve(firmId, "t1");
      expect(await microsoftConnection(firmId, "u1")).not.toBeNull();
    });

    it("a DIFFERENT tenant keeps the connection and the access switch", async () => {
      const firmId = await approvedFirmWithConnectedAdvisor();
      await approve(firmId, "t2");
      expect(await microsoftConnection(firmId, "u1")).not.toBeNull();
      expect(await hasMemberAccess(firmId, "u1", "microsoft")).toBe(true);
      expect((await getFirmApproval(firmId, "microsoft"))?.tenantId).toBe("t2");
    });

    it("another firm's connection is untouched by a tenant change", async () => {
      const firmId = await approvedFirmWithConnectedAdvisor();
      const otherFirmId = await approvedFirmWithConnectedAdvisor();
      await approve(firmId, "t2");
      expect(await microsoftConnection(otherFirmId, "u1")).not.toBeNull();
    });
  });
});

describe("member access + connections", () => {
  it("switching off deletes the connection", async () => {
    const firmId = freshFirmId();
    await setMemberAccess({ firmId, provider: "microsoft", userId: "u1", enabled: true, updatedByUserId: "admin" });
    expect(await hasMemberAccess(firmId, "u1", "microsoft")).toBe(true);
    expect((await connect(firmId, "u1", "oid-1")).ok).toBe(true);
    await setMemberAccess({ firmId, provider: "microsoft", userId: "u1", enabled: false, updatedByUserId: "admin" });
    expect(await microsoftConnection(firmId, "u1")).toBeNull();
    expect(await hasMemberAccess(firmId, "u1", "microsoft")).toBe(false);
  });

  it("same account for a second user in a firm is account_in_use", async () => {
    const firmId = freshFirmId();
    expect((await connect(firmId, "u1", "oid-1")).ok).toBe(true);
    expect(await connect(firmId, "u2", "oid-1")).toEqual({ ok: false, reason: "account_in_use" });
  });

  it("same account in a different firm is ok", async () => {
    expect((await connect(freshFirmId(), "u1", "oid-shared")).ok).toBe(true);
    expect((await connect(freshFirmId(), "u1", "oid-shared")).ok).toBe(true);
  });

  it("reconnect updates the one row", async () => {
    const firmId = freshFirmId();
    await connect(firmId, "u1", "oid-1", "old@x.com");
    await connect(firmId, "u1", "oid-1", "new@x.com");
    const rows = await db.select().from(workspaceConnections).where(eq(workspaceConnections.firmId, firmId));
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("connected");
    expect(rows[0].externalEmail).toBe("new@x.com");
  });

  it("tokens are encrypted at rest and decrypted on read", async () => {
    const firmId = freshFirmId();
    await connect(firmId, "u1", "oid-1");
    const [raw] = await db.select({ a: workspaceConnections.accessTokenEnc }).from(workspaceConnections)
      .where(eq(workspaceConnections.firmId, firmId));
    expect(raw.a).not.toBe("plain-access-token");
    expect((await microsoftConnection(firmId, "u1"))?.accessToken).toBe("plain-access-token");
  });

  it("summaries carry no tokens", async () => {
    const firmId = freshFirmId();
    await connect(firmId, "u1", "oid-1");
    const list = await listFirmConnectionSummaries(firmId, "microsoft");
    expect(list).toHaveLength(1);
    expect(list[0]).not.toHaveProperty("accessToken");
    expect(list[0]).toEqual({ userId: "u1", externalEmail: "a@x.com", status: "connected" });
  });

  it("enableMembers returns the count", async () => {
    const firmId = freshFirmId();
    expect(await enableMembers({ firmId, provider: "microsoft", userIds: ["a", "b", "c"], updatedByUserId: "admin" })).toBe(3);
  });

  it("removeWorkspaceMember leaves a colleague untouched", async () => {
    const firmId = freshFirmId();
    for (const [u, oid] of [["u1", "o1"], ["u2", "o2"]]) {
      await setMemberAccess({ firmId, provider: "microsoft", userId: u, enabled: true, updatedByUserId: "admin" });
      await connect(firmId, u, oid);
    }
    await removeWorkspaceMember(firmId, "u1");
    expect(await hasMemberAccess(firmId, "u1", "microsoft")).toBe(false);
    expect(await microsoftConnection(firmId, "u1")).toBeNull();
    expect(await hasMemberAccess(firmId, "u2", "microsoft")).toBe(true);
    expect(await microsoftConnection(firmId, "u2")).not.toBeNull();
  });

  it("deleteFirmProvider leaves no workspace rows", async () => {
    const firmId = freshFirmId();
    await upsertFirmApproval({ firmId, provider: "microsoft", tenantId: "t", approvedScopes: "s", approvedByUserId: "admin" });
    await setMemberAccess({ firmId, provider: "microsoft", userId: "u1", enabled: true, updatedByUserId: "admin" });
    await connect(firmId, "u1", "o1");
    await createWorkspaceOauthState({ firmId, provider: "microsoft", kind: "user_connect", userId: "u1", codeVerifier: null, ttlMs: 60_000 });
    await deleteFirmProvider(firmId, "microsoft");
    for (const t of [workspaceFirmApprovals, workspaceMemberAccess, workspaceConnections, workspaceOauthStates]) {
      expect(await db.select().from(t).where(eq(t.firmId, firmId))).toHaveLength(0);
    }
  });

  describe("several accounts per advisor", () => {
    it("one user connects Microsoft and Google; summaries come back oldest first", async () => {
      const firmId = freshFirmId();
      await connectAs(firmId, "u1", "microsoft", "oid-1");
      await connectAs(firmId, "u1", "google", "sub-1");
      const list = await listUserConnectionSummaries(firmId, "u1");
      expect(list.map((a) => [a.provider, a.email])).toEqual([
        ["microsoft", "oid-1@x.com"],
        ["google", "sub-1@x.com"],
      ]);
      expect(list[0]).not.toHaveProperty("accessToken");
      expect(typeof list[0].connectedAt).toBe("string");
    });

    it("the same user connects Google twice as two rows", async () => {
      const firmId = freshFirmId();
      await connectAs(firmId, "u1", "google", "sub-1");
      await connectAs(firmId, "u1", "google", "sub-2");
      expect(await listUserConnectionSummaries(firmId, "u1")).toHaveLength(2);
    });

    it("reconnect keeps the row, its id and connectedAt, and stores the new tokens", async () => {
      const firmId = freshFirmId();
      const first = await connectAs(firmId, "u1", "google", "sub-1");
      await connectAs(firmId, "u1", "google", "sub-2");
      const [before] = await db.select().from(workspaceConnections).where(eq(workspaceConnections.id, (first as { id: string }).id));
      const again = await connectAs(firmId, "u1", "google", "sub-1", { ...tokens, accessToken: "fresh-access" });
      expect(again).toEqual({ ok: true, id: (first as { id: string }).id });
      expect(await listUserConnectionSummaries(firmId, "u1")).toHaveLength(2);
      const [after] = await db.select().from(workspaceConnections).where(eq(workspaceConnections.id, before.id));
      expect(after.connectedAt.getTime()).toBe(before.connectedAt.getTime());
      expect((await getConnectionById(before.id))?.accessToken).toBe("fresh-access");
    });

    it("someone else's account is account_in_use and leaves it untouched", async () => {
      const firmId = freshFirmId();
      const mine = await connectAs(firmId, "uA", "google", "sub-1");
      expect(await connectAs(firmId, "uB", "google", "sub-1", { ...tokens, accessToken: "intruder" })).toEqual({
        ok: false,
        reason: "account_in_use",
      });
      const conn = await getConnectionById((mine as { id: string }).id);
      expect(conn?.userId).toBe("uA");
      expect(conn?.accessToken).toBe("plain-access-token");
      expect(await listUserConnectionSummaries(firmId, "uB")).toHaveLength(0);
    });

    it("caps an advisor at the maximum, but a reconnect at the cap still works", async () => {
      const firmId = freshFirmId();
      for (let i = 0; i < MAX_ACCOUNTS_PER_ADVISOR; i++) {
        expect((await connectAs(firmId, "u1", "google", `sub-${i}`)).ok).toBe(true);
      }
      expect(await connectAs(firmId, "u1", "google", "sub-extra")).toEqual({ ok: false, reason: "too_many_accounts" });
      expect(await listUserConnectionSummaries(firmId, "u1")).toHaveLength(MAX_ACCOUNTS_PER_ADVISOR);
      expect((await connectAs(firmId, "u1", "google", "sub-2")).ok).toBe(true);
      expect(await listUserConnectionSummaries(firmId, "u1")).toHaveLength(MAX_ACCOUNTS_PER_ADVISOR);
    });

    it("a tenant change on re-approval keeps the firm's connections", async () => {
      const firmId = freshFirmId();
      await connect(firmId, "u1", "oid-1");
      await connectAs(firmId, "u2", "google", "sub-1");
      const approval = { firmId, provider: "microsoft" as const, approvedScopes: "s", approvedByUserId: "admin" };
      await upsertFirmApproval({ ...approval, tenantId: "t1" });
      await upsertFirmApproval({ ...approval, tenantId: "t2" });
      expect(await listFirmConnections(firmId)).toHaveLength(2);
    });

    it("deleteConnection honours the owner restriction", async () => {
      const firmId = freshFirmId();
      const row = (await connectAs(firmId, "u1", "google", "sub-1")) as { id: string };
      expect(await deleteConnection(firmId, row.id, { userId: "other" })).toBe(false);
      expect(await getConnectionById(row.id)).not.toBeNull();
      expect(await deleteConnection(firmId, row.id, { userId: "u1" })).toBe(true);
      expect(await getConnectionById(row.id)).toBeNull();
    });

    it("listFirmConnections spans providers and users and carries no tokens", async () => {
      const firmId = freshFirmId();
      await connectAs(firmId, "u1", "microsoft", "oid-1");
      await connectAs(firmId, "u2", "google", "sub-1");
      const list = await listFirmConnections(firmId);
      expect(list.map((a) => [a.userId, a.provider]).sort()).toEqual([["u1", "microsoft"], ["u2", "google"]]);
      for (const a of list) {
        expect(a).not.toHaveProperty("accessToken");
        expect(a).not.toHaveProperty("accessTokenEnc");
        expect(a).not.toHaveProperty("refreshToken");
      }
    });
  });
});
