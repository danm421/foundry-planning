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
import type { MicrosoftTokenSet } from "./types";
import { createWorkspaceOauthState, consumeWorkspaceOauthState } from "./oauth-states";
import { getFirmApproval, upsertFirmApproval, deleteFirmProvider } from "./approvals";
import { hasMemberAccess, setMemberAccess, enableMembers, removeWorkspaceMember } from "./access";
import { getUserConnection, listFirmConnectionSummaries, upsertUserConnection } from "./connections";

const firmIds: string[] = [];
function freshFirmId(): string {
  const id = `org_test_${randomUUID()}`;
  firmIds.push(id);
  return id;
}

const tokens: MicrosoftTokenSet = {
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
});

describe("member access + connections", () => {
  it("switching off deletes the connection", async () => {
    const firmId = freshFirmId();
    await setMemberAccess({ firmId, provider: "microsoft", userId: "u1", enabled: true, updatedByUserId: "admin" });
    expect(await hasMemberAccess(firmId, "u1", "microsoft")).toBe(true);
    expect((await connect(firmId, "u1", "oid-1")).ok).toBe(true);
    await setMemberAccess({ firmId, provider: "microsoft", userId: "u1", enabled: false, updatedByUserId: "admin" });
    expect(await getUserConnection(firmId, "u1", "microsoft")).toBeNull();
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
    expect((await getUserConnection(firmId, "u1", "microsoft"))?.accessToken).toBe("plain-access-token");
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
    expect(await getUserConnection(firmId, "u1", "microsoft")).toBeNull();
    expect(await hasMemberAccess(firmId, "u2", "microsoft")).toBe(true);
    expect(await getUserConnection(firmId, "u2", "microsoft")).not.toBeNull();
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
});
