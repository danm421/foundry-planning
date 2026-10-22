// src/lib/integrations/connection-access.test.ts
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { integrationConnections } from "@/db/schema";
import { createByokConnection } from "./connections";
import { getOwnedConnection } from "./connection-access";

const firmIds: string[] = [];
function freshFirmId(): string {
  const id = `org_test_${randomUUID()}`;
  firmIds.push(id);
  return id;
}

function addepar(firmId: string, ownerUserId: string) {
  return createByokConnection({
    firmId,
    ownerUserId,
    name: "Ethos",
    secretBlob: JSON.stringify({ apiKey: "k", apiSecret: "s" }),
    configBlob: JSON.stringify({ apiBase: "https://ethos.addepar.com", addeparFirmId: "1069" }),
  });
}

beforeAll(() => {
  process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
});

afterAll(async () => {
  if (firmIds.length === 0) return;
  await db.delete(integrationConnections).where(inArray(integrationConnections.firmId, firmIds));
});

describe("getOwnedConnection", () => {
  it("returns the connection for its owner", async () => {
    const firmId = freshFirmId();
    const connectionId = await addepar(firmId, "advisorA");

    const conn = await getOwnedConnection({ connectionId, firmId, userId: "advisorA" });

    expect(conn).toMatchObject({ id: connectionId, firmId, ownerUserId: "advisorA", providerId: "addepar" });
    expect(conn?.accessToken).toContain("apiKey"); // decrypted, ready to use
  });

  it("null for a colleague in the same firm", async () => {
    const firmId = freshFirmId();
    const connectionId = await addepar(firmId, "advisorA");

    expect(await getOwnedConnection({ connectionId, firmId, userId: "advisorB" })).toBeNull();
  });

  it("null for the owner signed into another firm", async () => {
    const firmId = freshFirmId();
    const connectionId = await addepar(firmId, "advisorA");

    expect(
      await getOwnedConnection({ connectionId, firmId: freshFirmId(), userId: "advisorA" }),
    ).toBeNull();
  });

  it("null for a non-uuid id without throwing", async () => {
    const select = vi.spyOn(db, "select");
    try {
      await expect(
        getOwnedConnection({ connectionId: "abc", firmId: freshFirmId(), userId: "advisorA" }),
      ).resolves.toBeNull();
      expect(select).not.toHaveBeenCalled();
    } finally {
      select.mockRestore();
    }
  });
});
