// src/lib/integrations/connections.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  crmHouseholds,
  integrationConnections,
  integrationHouseholdLinks,
} from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import {
  createByokConnection,
  upsertOauthConnection,
  upsertByokConnection,
  storeRefreshedTokens,
  loadConnection,
  listOwnedConnections,
  disconnectConnectionById,
  deleteConnectionById,
  listConnectedSyncingConnections,
  createOauthState,
  consumeOauthState,
} from "./connections";

const firmIds: string[] = [];
function freshFirmId(): string {
  const id = `org_test_${randomUUID()}`;
  firmIds.push(id);
  return id;
}

const ADDEPAR_SECRET = JSON.stringify({ apiKey: "k", apiSecret: "s" });
const addeparConfig = (addeparFirmId = "42") =>
  JSON.stringify({ apiBase: "https://ethos.addepar.com", addeparFirmId });

function addepar(firmId: string, ownerUserId: string, name = "Ethos") {
  return createByokConnection({
    firmId,
    ownerUserId,
    name,
    secretBlob: ADDEPAR_SECRET,
    configBlob: addeparConfig(),
  });
}

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(async () => {
  if (firmIds.length === 0) return;
  // Connections first: their household links cascade with them.
  await db.delete(integrationConnections).where(inArray(integrationConnections.firmId, firmIds));
  await db.delete(clients).where(inArray(clients.firmId, firmIds));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, firmIds));
});

describe("integration connections", () => {
  it("stores tokens encrypted and reads them back decrypted", async () => {
    const firmId = freshFirmId();
    const id = await upsertOauthConnection({
      firmId, providerId: "orion", ownerUserId: "u1", accessToken: "AT", refreshToken: "RT",
    });
    const conn = await loadConnection(id);
    expect(conn).toMatchObject({
      id, firmId, providerId: "orion", ownerUserId: "u1", status: "connected",
      accessToken: "AT", refreshToken: "RT",
    });
    expect(conn?.accessTokenEnc).not.toContain("AT"); // raw column is ciphertext
  });

  it("one advisor can hold two Addepar connections", async () => {
    const firmId = freshFirmId();
    const zeta = await addepar(firmId, "owner", "Zeta");
    const ethos = await addepar(firmId, "owner", "Ethos");
    expect(zeta).not.toBe(ethos);

    const list = await listOwnedConnections({ firmId, userId: "owner" });
    expect(list).toHaveLength(2);
    // Ordered by name.
    expect(list.map((c) => [c.id, c.name, c.providerId])).toEqual([
      [ethos, "Ethos", "addepar"],
      [zeta, "Zeta", "addepar"],
    ]);
  });

  it("listOwnedConnections never shows a colleague's connection", async () => {
    const firmId = freshFirmId();
    await addepar(firmId, "advisorA");
    await upsertOauthConnection({ firmId, providerId: "orion", ownerUserId: "advisorA", accessToken: "AT" });

    expect(await listOwnedConnections({ firmId, userId: "advisorB" })).toEqual([]);
  });

  it("listOwnedConnections never returns the firm's Azure connection", async () => {
    const firmId = freshFirmId();
    await upsertByokConnection({
      firmId, providerId: "azure_openai", secretBlob: "{}", configBlob: "{}", userId: "admin",
    });
    // Even if an Azure row somehow carried an owner, it stays off the list.
    await db
      .update(integrationConnections)
      .set({ ownerUserId: "admin" })
      .where(eq(integrationConnections.firmId, firmId));

    expect(await listOwnedConnections({ firmId, userId: "admin" })).toEqual([]);
  });

  it("listOwnedConnections narrows to one provider and counts linked households", async () => {
    const firmId = freshFirmId();
    const linked = await addepar(firmId, "owner", "Ethos");
    const empty = await addepar(firmId, "owner", "Other");
    await upsertOauthConnection({ firmId, providerId: "orion", ownerUserId: "owner", accessToken: "AT" });
    for (const hh of ["hh1", "hh2"]) {
      const { clientId } = await createTestClientWithScenario(firmId);
      await db.insert(integrationHouseholdLinks).values({
        firmId, provider: "addepar", clientId, connectionId: linked,
        externalHouseholdId: hh, externalFirmId: "42", linkedByUserId: "owner",
      });
    }

    const list = await listOwnedConnections({ firmId, userId: "owner", providerId: "addepar" });
    expect(list.map((c) => [c.id, c.linkedHouseholds])).toEqual([
      [linked, 2],
      [empty, 0],
    ]);
    expect(list[0]).toMatchObject({ status: "connected", lastSyncedAt: null, lastSyncError: null });
  });

  it("a token refresh keeps the owner", async () => {
    const firmId = freshFirmId();
    const id = await upsertOauthConnection({
      firmId, providerId: "orion", ownerUserId: "u1", accessToken: "OLD", refreshToken: "RT_OLD",
    });
    await storeRefreshedTokens(id, {
      accessToken: "NEW", refreshToken: "RT_NEW", expiresAt: new Date(Date.now() + 3_600_000), scope: "read",
    });

    const conn = await loadConnection(id);
    expect(conn).toMatchObject({ ownerUserId: "u1", accessToken: "NEW", refreshToken: "RT_NEW", scope: "read" });
    const [raw] = await db
      .select({ connectedBy: integrationConnections.connectedByUserId })
      .from(integrationConnections)
      .where(eq(integrationConnections.id, id));
    expect(raw.connectedBy).toBe("u1");
  });

  it("a refresh finishing after Disconnect does not bring the tokens back", async () => {
    const firmId = freshFirmId();
    const id = await upsertOauthConnection({
      firmId, providerId: "orion", ownerUserId: "u1", accessToken: "AT", refreshToken: "RT",
    });
    await disconnectConnectionById(id);

    await storeRefreshedTokens(id, {
      accessToken: "LATE", refreshToken: "RT_LATE", expiresAt: new Date(Date.now() + 3_600_000), scope: "read",
    });

    expect(await loadConnection(id)).toMatchObject({
      status: "disconnected", accessToken: null, refreshToken: null, tokenExpiresAt: null,
    });
  });

  it("OAuth reconnect updates the same row", async () => {
    const firmId = freshFirmId();
    const first = await upsertOauthConnection({ firmId, providerId: "orion", ownerUserId: "u1", accessToken: "AT1" });
    const again = await upsertOauthConnection({ firmId, providerId: "orion", ownerUserId: "u1", accessToken: "AT2" });
    expect(again).toBe(first);
    expect((await loadConnection(first))?.accessToken).toBe("AT2");

    // The same advisor's Schwab, and a colleague's Orion, are rows of their own.
    const schwab = await upsertOauthConnection({ firmId, providerId: "schwab", ownerUserId: "u1", accessToken: "S" });
    const colleague = await upsertOauthConnection({ firmId, providerId: "orion", ownerUserId: "u2", accessToken: "C" });
    expect(new Set([first, schwab, colleague]).size).toBe(3);
  });

  it("disconnect nulls tokens and flips status, keeping the row", async () => {
    const firmId = freshFirmId();
    const id = await upsertOauthConnection({
      firmId, providerId: "orion", ownerUserId: "u1", accessToken: "AT", refreshToken: "RT",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    await disconnectConnectionById(id);
    const conn = await loadConnection(id);
    expect(conn).toMatchObject({
      status: "disconnected", accessToken: null, refreshToken: null, tokenExpiresAt: null, ownerUserId: "u1",
    });
  });

  it("deleting a connection removes its links and says how many", async () => {
    const firmId = freshFirmId();
    const id = await addepar(firmId, "owner");
    const other = await addepar(firmId, "owner", "Other");
    const clientIds: string[] = [];
    for (const [connectionId, hh] of [[id, "hh1"], [id, "hh2"], [other, "hh3"]]) {
      const { clientId } = await createTestClientWithScenario(firmId);
      clientIds.push(clientId);
      await db.insert(integrationHouseholdLinks).values({
        firmId, provider: "addepar", clientId, connectionId,
        externalHouseholdId: hh, externalFirmId: "42", linkedByUserId: "owner",
      });
    }

    expect(await deleteConnectionById(id)).toBe(2);

    expect(await loadConnection(id)).toBeNull();
    const links = await db
      .select({ externalHouseholdId: integrationHouseholdLinks.externalHouseholdId })
      .from(integrationHouseholdLinks)
      .where(inArray(integrationHouseholdLinks.clientId, clientIds));
    // The other connection's link stays.
    expect(links).toEqual([{ externalHouseholdId: "hh3" }]);
  });

  it("listConnectedSyncingConnections skips disconnected and azure rows", async () => {
    const firmId = freshFirmId();
    const live = await addepar(firmId, "owner", "Live");
    const gone = await addepar(firmId, "owner", "Gone");
    await disconnectConnectionById(gone);
    await upsertByokConnection({
      firmId, providerId: "azure_openai", secretBlob: "{}", configBlob: "{}", userId: "admin",
    });

    const mine = (await listConnectedSyncingConnections()).filter((c) => c.firmId === firmId);
    expect(mine).toEqual([{ id: live, firmId, providerId: "addepar" }]);
  });

  it("oauth state is single-use", async () => {
    const firmId = freshFirmId();
    const state = `st_${randomUUID()}`;
    await createOauthState({ firmId, providerId: "orion", userId: "u1", state, codeVerifier: "v1", ttlMs: 60000 });
    expect(await consumeOauthState(state)).toMatchObject({ firmId, providerId: "orion", userId: "u1" });
    expect(await consumeOauthState(state)).toBeNull(); // consumed
  });

  it("expired state returns null", async () => {
    const firmId = freshFirmId();
    const state = `st_${randomUUID()}`;
    await createOauthState({ firmId, providerId: "orion", userId: "u1", state, codeVerifier: "v2", ttlMs: -1 });
    expect(await consumeOauthState(state)).toBeNull();
  });
});
