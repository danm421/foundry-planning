// src/lib/integrations/__tests__/claim-household.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholds, integrationConnections } from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import { encodeAddeparConfig } from "../providers/addepar/credentials";
import { createByokConnection, loadConnection, type IntegrationConnectionRow } from "../connections";
import { claimHousehold, getHouseholdLinkForClient, linkHouseholdOnConnection } from "../households";

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
  // Connections first: their household links cascade with them.
  await db.delete(integrationConnections).where(inArray(integrationConnections.firmId, firmIds));
  await db.delete(clients).where(inArray(clients.firmId, firmIds));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, firmIds));
});

async function addeparConnection(firmId: string, ownerUserId: string): Promise<IntegrationConnectionRow> {
  const id = await createByokConnection({
    firmId,
    ownerUserId,
    name: "Ethos",
    secretBlob: JSON.stringify({ apiKey: "k", apiSecret: "s" }),
    configBlob: encodeAddeparConfig({ apiBase: "https://ethos.addepar.com", addeparFirmId: "1069" }),
  });
  return (await loadConnection(id))!;
}

const book = async () => [
  { id: "1234567", name: "Doe Family" },
  { id: "7654321", name: "Roe Family" },
];

describe("claimHousehold", () => {
  it("returns unknown_household when the id is not in the connection's book", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    const connection = await addeparConnection(firmId, "u1");

    const result = await claimHousehold({
      connection,
      clientId,
      externalHouseholdId: "9999999",
      userId: "u1",
      listHouseholds: book,
    });

    expect(result).toEqual({ ok: false, reason: "unknown_household" });
    expect(await getHouseholdLinkForClient(clientId)).toBeNull();
  });

  it("links through the connection and returns the household name on success", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    const connection = await addeparConnection(firmId, "u1");

    const result = await claimHousehold({
      connection,
      clientId,
      externalHouseholdId: "1234567",
      userId: "u1",
      listHouseholds: book,
    });

    expect(result).toEqual({ ok: true, name: "Doe Family" });
    expect(await getHouseholdLinkForClient(clientId)).toMatchObject({
      firmId,
      provider: "addepar",
      connectionId: connection.id,
      externalFirmId: "1069",
      externalHouseholdId: "1234567",
      linkedByUserId: "u1",
    });
  });

  it("re-claiming on the same connection replaces the client's household", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    const connection = await addeparConnection(firmId, "u1");
    const input = { connection, clientId, userId: "u1", listHouseholds: book };

    await claimHousehold({ ...input, externalHouseholdId: "1234567" });
    const before = await getHouseholdLinkForClient(clientId);
    const result = await claimHousehold({ ...input, externalHouseholdId: "7654321" });

    expect(result).toEqual({ ok: true, name: "Roe Family" });
    // The same row (one link per client), now on the new household.
    expect(await getHouseholdLinkForClient(clientId)).toMatchObject({
      id: before!.id,
      externalHouseholdId: "7654321",
    });
  });

  it("a household another client holds is already_linked, not thrown", async () => {
    const firmId = freshFirmId();
    const holder = await createTestClientWithScenario(firmId);
    const { clientId } = await createTestClientWithScenario(firmId);
    const connection = await addeparConnection(firmId, "u1");
    await linkHouseholdOnConnection({
      connection,
      clientId: holder.clientId,
      externalHouseholdId: "1234567",
      userId: "u1",
    });

    const result = await claimHousehold({
      connection,
      clientId,
      externalHouseholdId: "1234567",
      userId: "u1",
      listHouseholds: book,
    });

    expect(result).toEqual({ ok: false, reason: "already_linked" });
    expect(await getHouseholdLinkForClient(clientId)).toBeNull();
  });

  it("a client linked through another connection is not claimable", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    const colleagues = await addeparConnection(firmId, "advisorA");
    const mine = await addeparConnection(firmId, "advisorB");
    await linkHouseholdOnConnection({
      connection: colleagues,
      clientId,
      externalHouseholdId: "7654321",
      userId: "advisorA",
    });
    const before = await getHouseholdLinkForClient(clientId);

    const result = await claimHousehold({
      connection: mine,
      clientId,
      externalHouseholdId: "1234567",
      userId: "advisorB",
      listHouseholds: book,
    });

    expect(result).toEqual({ ok: false, reason: "already_linked" });
    expect(await getHouseholdLinkForClient(clientId)).toEqual(before);
  });

  it("rethrows a non-unique DB error (never silently reports already_linked)", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    // A connection id with no row trips the link's foreign key (23503).
    const connection = { ...(await addeparConnection(firmId, "u1")), id: randomUUID() };

    await expect(
      claimHousehold({
        connection,
        clientId,
        externalHouseholdId: "1234567",
        userId: "u1",
        listHouseholds: book,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
  });
});
