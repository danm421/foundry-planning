// src/lib/integrations/connections-byok.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import {
  createByokConnection,
  updateByokCredentials,
  upsertByokConnection,
  setConnectionStatusById,
  loadConnection,
  getConnection,
} from "./connections";

const firmIds: string[] = [];
function freshFirmId(): string {
  const id = `org_test_${randomUUID()}`;
  firmIds.push(id);
  return id;
}

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(async () => {
  if (firmIds.length === 0) return;
  await db.delete(integrationConnections).where(inArray(integrationConnections.firmId, firmIds));
});

describe("createByokConnection", () => {
  it("stores the secret encrypted and the config in scope, under its owner and name", async () => {
    const firmId = freshFirmId();
    const id = await createByokConnection({
      firmId,
      ownerUserId: "u1",
      name: "Ethos",
      secretBlob: JSON.stringify({ apiKey: "k", apiSecret: "s" }),
      configBlob: JSON.stringify({ apiBase: "https://ethos.addepar.com", addeparFirmId: "1069" }),
    });
    const conn = await loadConnection(id);
    expect(conn).toMatchObject({ id, firmId, providerId: "addepar", ownerUserId: "u1", name: "Ethos", status: "connected" });
    expect(conn?.accessToken).toContain("apiKey");         // helper decrypts to the secret JSON
    expect(conn?.accessTokenEnc).not.toContain("apiKey");  // raw column is ciphertext
    expect(conn?.scope).toContain("1069");                  // config lives in scope
  });
});

describe("updateByokCredentials", () => {
  it("replaces the key and name, clears an error, and keeps the owner", async () => {
    const firmId = freshFirmId();
    const id = await createByokConnection({
      firmId, ownerUserId: "u1", name: "Old", secretBlob: '{"apiKey":"old"}', configBlob: '{"addeparFirmId":"1"}',
    });
    await setConnectionStatusById(id, "error", "Addepar rejected the key");

    await updateByokCredentials({
      connectionId: id, name: "New", secretBlob: '{"apiKey":"new"}', configBlob: '{"addeparFirmId":"2"}', userId: "u1",
    });

    expect(await loadConnection(id)).toMatchObject({
      ownerUserId: "u1", name: "New", status: "connected", lastSyncError: null,
      accessToken: '{"apiKey":"new"}', scope: '{"addeparFirmId":"2"}',
    });
  });
});

describe("upsertByokConnection (Azure OpenAI)", () => {
  it("keeps one Azure connection per firm, replacing its key on reconnect", async () => {
    const firmId = freshFirmId();
    for (const key of ["first", "second"]) {
      await upsertByokConnection({
        firmId, providerId: "azure_openai", secretBlob: key, configBlob: "{}", userId: "admin",
      });
    }
    const rows = await db
      .select({ id: integrationConnections.id })
      .from(integrationConnections)
      .where(eq(integrationConnections.firmId, firmId));
    expect(rows).toHaveLength(1);
    expect((await getConnection(firmId, "azure_openai"))?.accessToken).toBe("second");
  });
});
