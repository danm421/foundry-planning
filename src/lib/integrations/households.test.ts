// src/lib/integrations/households.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { accounts, clients, crmHouseholds, integrationConnections, integrationHouseholdLinks } from "@/db/schema";
import { createTestClientWithScenario } from "@/test/factories";
import type { ExtractedAccount } from "@/lib/extraction/types";
import { encodeAddeparConfig } from "./providers/addepar/credentials";
import {
  createByokConnection,
  loadConnection,
  upsertOauthConnection,
  type IntegrationConnectionRow,
} from "./connections";
import {
  getHouseholdLinkForClient,
  recordLastPull,
  linkHouseholdOnConnection,
  listFirmLinksOutside,
  unlinkHousehold,
} from "./households";
import { countConnectedAccounts } from "./household-table";

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
  // Clients cascade their scenarios and accounts.
  await db.delete(clients).where(inArray(clients.firmId, firmIds));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, firmIds));
});

async function orionConnection(firmId: string, ownerUserId: string): Promise<IntegrationConnectionRow> {
  const id = await upsertOauthConnection({ firmId, providerId: "orion", ownerUserId, accessToken: "fake" });
  return (await loadConnection(id))!;
}

async function addeparConnection(
  firmId: string,
  ownerUserId: string,
  addeparFirmId: string,
): Promise<IntegrationConnectionRow> {
  const id = await createByokConnection({
    firmId,
    ownerUserId,
    name: `Addepar ${addeparFirmId}`,
    secretBlob: JSON.stringify({ apiKey: "k", apiSecret: "s" }),
    configBlob: encodeAddeparConfig({ apiBase: "https://ethos.addepar.com", addeparFirmId }),
  });
  return (await loadConnection(id))!;
}

describe("linkHouseholdOnConnection", () => {
  it("refuses to link a client already linked through a colleague's connection", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    const mine = await orionConnection(firmId, "advisorA");
    const colleagues = await orionConnection(firmId, "advisorB");

    expect(
      await linkHouseholdOnConnection({ connection: mine, clientId, externalHouseholdId: "hhA", userId: "advisorA" }),
    ).toEqual({ ok: true });
    const before = await getHouseholdLinkForClient(clientId);

    const outcome = await linkHouseholdOnConnection({
      connection: colleagues,
      clientId,
      externalHouseholdId: "hhB",
      userId: "advisorB",
    });

    expect(outcome).toEqual({ ok: false, reason: "client_linked_elsewhere", linkedByUserId: "advisorA" });
    // Nothing replaced: same connection, household, linker and edit stamp.
    expect(await getHouseholdLinkForClient(clientId)).toEqual(before);
    expect(before).toMatchObject({
      connectionId: mine.id,
      externalHouseholdId: "hhA",
      externalFirmId: null,
      linkedByUserId: "advisorA",
    });
  });

  it("refuses a household already held through another connection to the same Addepar firm", async () => {
    const firmId = freshFirmId();
    const first = await createTestClientWithScenario(firmId);
    const second = await createTestClientWithScenario(firmId);
    const mine = await addeparConnection(firmId, "advisorA", "1069");
    const colleagues = await addeparConnection(firmId, "advisorB", "1069");

    await linkHouseholdOnConnection({
      connection: mine,
      clientId: first.clientId,
      externalHouseholdId: "g1",
      userId: "advisorA",
    });
    const outcome = await linkHouseholdOnConnection({
      connection: colleagues,
      clientId: second.clientId,
      externalHouseholdId: "g1",
      userId: "advisorB",
    });

    expect(outcome).toEqual({ ok: false, reason: "household_linked_elsewhere", linkedByUserId: "advisorA" });
    expect(await getHouseholdLinkForClient(second.clientId)).toBeNull();
  });

  it("allows the same group id under two different Addepar firms", async () => {
    const firmId = freshFirmId();
    const first = await createTestClientWithScenario(firmId);
    const second = await createTestClientWithScenario(firmId);
    const ethos = await addeparConnection(firmId, "advisorA", "1069");
    const other = await addeparConnection(firmId, "advisorB", "2000");

    expect(
      await linkHouseholdOnConnection({
        connection: ethos,
        clientId: first.clientId,
        externalHouseholdId: "g1",
        userId: "advisorA",
      }),
    ).toEqual({ ok: true });
    expect(
      await linkHouseholdOnConnection({
        connection: other,
        clientId: second.clientId,
        externalHouseholdId: "g1",
        userId: "advisorB",
      }),
    ).toEqual({ ok: true });

    // Each link carries its connection's Addepar firm id.
    expect(await getHouseholdLinkForClient(first.clientId)).toMatchObject({
      connectionId: ethos.id,
      externalFirmId: "1069",
    });
    expect(await getHouseholdLinkForClient(second.clientId)).toMatchObject({
      connectionId: other.id,
      externalFirmId: "2000",
    });
  });

  it("re-linking a client on the same connection replaces its household", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    const conn = await orionConnection(firmId, "advisorA");

    await linkHouseholdOnConnection({ connection: conn, clientId, externalHouseholdId: "hhA", userId: "advisorA" });
    const before = await getHouseholdLinkForClient(clientId);
    // Small delay so updated_at can advance.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const outcome = await linkHouseholdOnConnection({
      connection: conn,
      clientId,
      externalHouseholdId: "hhB",
      userId: "assistant",
    });

    expect(outcome).toEqual({ ok: true });
    const after = await getHouseholdLinkForClient(clientId);
    expect(after).toMatchObject({
      id: before!.id,
      connectionId: conn.id,
      externalHouseholdId: "hhB",
      // "Linked by" names whoever performed THIS link.
      linkedByUserId: "assistant",
    });
    // Both writes stamp updated_at from the DB clock (a smoke check, not a guard).
    expect(after!.updatedAt.getTime()).toBeGreaterThan(before!.updatedAt.getTime());
  });

  it("re-linking to a different household clears the last pull; the same household keeps it", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    const conn = await orionConnection(firmId, "advisorA");
    const link = { connection: conn, clientId, userId: "advisorA" };
    const snapshot = async () => {
      const [row] = await db
        .select({ accounts: integrationHouseholdLinks.lastPullAccounts, at: integrationHouseholdLinks.lastPulledAt })
        .from(integrationHouseholdLinks)
        .where(eq(integrationHouseholdLinks.clientId, clientId));
      return row;
    };

    await linkHouseholdOnConnection({ ...link, externalHouseholdId: "hhA" });
    const [{ id: linkId }] = await db
      .select({ id: integrationHouseholdLinks.id })
      .from(integrationHouseholdLinks)
      .where(eq(integrationHouseholdLinks.clientId, clientId));
    await recordLastPull(linkId, [{ name: "A1", externalId: "a1" }], new Date());

    // The same household again: the snapshot stays.
    await linkHouseholdOnConnection({ ...link, externalHouseholdId: "hhA" });
    expect(await snapshot()).toMatchObject({ accounts: [{ externalId: "a1" }] });
    expect((await snapshot()).at).not.toBeNull();

    // A different household: the previous family's accounts must not linger.
    await linkHouseholdOnConnection({ ...link, externalHouseholdId: "hhB" });
    expect(await snapshot()).toEqual({ accounts: null, at: null });
  });

  it("a household held by another client on the same connection is refused, naming its linker", async () => {
    const firmId = freshFirmId();
    const first = await createTestClientWithScenario(firmId);
    const second = await createTestClientWithScenario(firmId);
    const conn = await orionConnection(firmId, "advisorA");

    await linkHouseholdOnConnection({ connection: conn, clientId: first.clientId, externalHouseholdId: "hhA", userId: "advisorA" });
    await linkHouseholdOnConnection({ connection: conn, clientId: second.clientId, externalHouseholdId: "hhB", userId: "advisorA" });

    // Moving the second client onto the first's household trips the household
    // index on the UPDATE path, not just the insert.
    const outcome = await linkHouseholdOnConnection({
      connection: conn,
      clientId: second.clientId,
      externalHouseholdId: "hhA",
      userId: "advisorA",
    });
    expect(outcome).toEqual({ ok: false, reason: "household_linked_elsewhere", linkedByUserId: "advisorA" });
    expect(await getHouseholdLinkForClient(second.clientId)).toMatchObject({ externalHouseholdId: "hhB" });
  });
});

describe("listFirmLinksOutside", () => {
  it("returns the firm's links held through any other connection, of every provider", async () => {
    const firmId = freshFirmId();
    const otherFirmId = freshFirmId();
    const a = await createTestClientWithScenario(firmId);
    const b = await createTestClientWithScenario(firmId);
    const c = await createTestClientWithScenario(firmId);
    const d = await createTestClientWithScenario(otherFirmId);
    const mine = await addeparConnection(firmId, "advisorA", "1069");
    const colleagues = await addeparConnection(firmId, "advisorB", "2000");
    const orion = await orionConnection(firmId, "advisorB");
    const elsewhere = await addeparConnection(otherFirmId, "advisorZ", "1069");

    await linkHouseholdOnConnection({ connection: mine, clientId: a.clientId, externalHouseholdId: "g1", userId: "advisorA" });
    await linkHouseholdOnConnection({ connection: colleagues, clientId: b.clientId, externalHouseholdId: "g2", userId: "advisorB" });
    await linkHouseholdOnConnection({ connection: orion, clientId: c.clientId, externalHouseholdId: "hh3", userId: "advisorB" });
    await linkHouseholdOnConnection({ connection: elsewhere, clientId: d.clientId, externalHouseholdId: "g4", userId: "advisorZ" });

    const rows = await listFirmLinksOutside({ firmId, connectionId: mine.id });
    // Not this connection's own link, and not another firm's.
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        {
          clientId: b.clientId,
          // The client's own advisor and Private flag (the factory's defaults).
          advisorId: "test_advisor",
          isPrivate: false,
          providerId: "addepar",
          externalFirmId: "2000",
          externalHouseholdId: "g2",
          linkedByUserId: "advisorB",
        },
        // A client linked through another provider's connection is taken too.
        {
          clientId: c.clientId,
          advisorId: "test_advisor",
          isPrivate: false,
          providerId: "orion",
          externalFirmId: null,
          externalHouseholdId: "hh3",
          linkedByUserId: "advisorB",
        },
      ]),
    );
  });
});

describe("unlinkHousehold", () => {
  it("deletes the client's link on that connection only", async () => {
    const firmId = freshFirmId();
    const { clientId } = await createTestClientWithScenario(firmId);
    const mine = await orionConnection(firmId, "advisorA");
    const colleagues = await orionConnection(firmId, "advisorB");
    await linkHouseholdOnConnection({ connection: mine, clientId, externalHouseholdId: "hhC", userId: "advisorA" });

    await unlinkHousehold(colleagues.id, clientId);
    expect(await getHouseholdLinkForClient(clientId)).not.toBeNull();

    await unlinkHousehold(mine.id, clientId);
    expect(await getHouseholdLinkForClient(clientId)).toBeNull();
  });
});

describe("countConnectedAccounts", () => {
  it("countConnectedAccounts counts base-case accounts whose external id is in the last pull", async () => {
    const firmId = freshFirmId();
    const { clientId, scenarioId } = await createTestClientWithScenario(firmId);
    // No what-if account here: a trigger only lets base-case rows into
    // accounts, so the base-case join can't be exercised with a real row.
    // A second client tied to the same ids: its accounts never count for this link.
    const neighbour = await createTestClientWithScenario(firmId);
    const plan = (over: { clientId?: string; scenarioId?: string; externalProvider: string; externalId: string }) => ({
      clientId,
      scenarioId,
      name: over.externalId,
      category: "taxable" as const,
      subType: "brokerage" as const,
      value: "100",
      ...over,
    });
    await db.insert(accounts).values([
      plan({ externalProvider: "addepar", externalId: "a1" }),
      plan({ externalProvider: "addepar", externalId: "a2" }),
      // Tied to Addepar, but not in this household's last pull.
      plan({ externalProvider: "addepar", externalId: "zz" }),
      // Same id from another provider: not this provider's tie.
      plan({ externalProvider: "orion", externalId: "a3" }),
      plan({
        clientId: neighbour.clientId,
        scenarioId: neighbour.scenarioId,
        externalProvider: "addepar",
        externalId: "a3",
      }),
    ]);
    const pulled = (externalId: string): ExtractedAccount => ({ name: externalId, externalId });

    const counts = await countConnectedAccounts({
      providerId: "addepar",
      links: [
        { id: "link-pulled", clientId, lastPullAccounts: [pulled("a1"), pulled("a2"), pulled("a3")] },
        { id: "link-never-pulled", clientId, lastPullAccounts: null },
      ],
    });

    expect(counts.get("link-pulled")).toEqual({ connected: 2, total: 3 });
    expect(counts.has("link-never-pulled")).toBe(false);
  });

  it("returns an empty map without querying when no link has been pulled", async () => {
    const counts = await countConnectedAccounts({
      providerId: "addepar",
      links: [{ id: "l", clientId: randomUUID(), lastPullAccounts: null }],
    });
    expect(counts.size).toBe(0);
  });
});
