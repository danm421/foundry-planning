import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/db";
import { clientShares, clients, crmHouseholds } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  resolveSharedClientAccess,
  resolveSharesForRecipient,
  effectivePermission,
} from "../shared-access";

const OWN_FIRM = "org_share_owner";
const OWNER = "user_owner";
const RCPT = "user_rcpt";

async function makeClient(opts: { isPrivate?: boolean; advisorId?: string; deleted?: boolean }) {
  const [hh] = await db
    .insert(crmHouseholds)
    .values({
      firmId: OWN_FIRM, advisorId: opts.advisorId ?? OWNER, name: "HH",
      deletedAt: opts.deleted ? new Date() : null,
    })
    .returning();
  const [c] = await db
    .insert(clients)
    .values({
      firmId: OWN_FIRM, advisorId: opts.advisorId ?? OWNER, crmHouseholdId: hh.id,
      retirementAge: 65, planEndAge: 95, isPrivate: opts.isPrivate ?? false,
    })
    .returning();
  return c.id;
}

describe("shared-access resolver", () => {
  beforeEach(async () => {
    await db.delete(clientShares).where(eq(clientShares.firmId, OWN_FIRM));
    await db.delete(clients).where(eq(clients.firmId, OWN_FIRM));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, OWN_FIRM));
  });
  afterAll(async () => {
    await db.delete(clientShares).where(eq(clientShares.firmId, OWN_FIRM));
    await db.delete(clients).where(eq(clients.firmId, OWN_FIRM));
    await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, OWN_FIRM));
  });

  it("effectivePermission: edit beats view", () => {
    expect(effectivePermission("view", "edit")).toBe("edit");
    expect(effectivePermission("view", "view")).toBe("view");
  });

  it("share-all expands to the owner's non-private, non-deleted clients", async () => {
    const a = await makeClient({});
    const priv = await makeClient({ isPrivate: true });
    const del = await makeClient({ deleted: true });
    const otherAdvisor = await makeClient({ advisorId: "user_other_adv" });
    await db.insert(clientShares).values({
      firmId: OWN_FIRM, ownerUserId: OWNER, recipientUserId: RCPT,
      recipientEmail: "r@x.com", scope: "all", permission: "view", createdBy: OWNER,
    });
    const { sharedClientIds } = await resolveSharedClientAccess(RCPT);
    expect(sharedClientIds.has(a)).toBe(true);
    expect(sharedClientIds.has(priv)).toBe(false); // private excluded
    expect(sharedClientIds.has(del)).toBe(false);  // soft-deleted excluded
    expect(sharedClientIds.has(otherAdvisor)).toBe(false); // not this owner's book
  });

  it("per-client share overrides private exclusion", async () => {
    const priv = await makeClient({ isPrivate: true });
    await db.insert(clientShares).values({
      firmId: OWN_FIRM, ownerUserId: OWNER, recipientUserId: RCPT,
      recipientEmail: "r@x.com", scope: "client", clientId: priv,
      permission: "view", createdBy: OWNER,
    });
    const { sharedClientIds } = await resolveSharedClientAccess(RCPT);
    expect(sharedClientIds.has(priv)).toBe(true);
  });

  it("most-permissive wins when share-all (view) + per-client (edit) overlap", async () => {
    const a = await makeClient({});
    await db.insert(clientShares).values([
      { firmId: OWN_FIRM, ownerUserId: OWNER, recipientUserId: RCPT, recipientEmail: "r@x.com", scope: "all", permission: "view", createdBy: OWNER },
      { firmId: OWN_FIRM, ownerUserId: OWNER, recipientUserId: RCPT, recipientEmail: "r@x.com", scope: "client", clientId: a, permission: "edit", createdBy: OWNER },
    ]);
    const { permissionByClientId } = await resolveSharedClientAccess(RCPT);
    expect(permissionByClientId.get(a)).toBe("edit");
  });

  it("excludes revoked shares", async () => {
    const a = await makeClient({});
    await db.insert(clientShares).values({
      firmId: OWN_FIRM, ownerUserId: OWNER, recipientUserId: RCPT,
      recipientEmail: "r@x.com", scope: "client", clientId: a,
      permission: "view", createdBy: OWNER, revokedAt: new Date(),
    });
    const { sharedClientIds } = await resolveSharedClientAccess(RCPT);
    expect(sharedClientIds.has(a)).toBe(false);
  });

  it("resolveSharesForRecipient returns owner+firm per effective client", async () => {
    const a = await makeClient({});
    await db.insert(clientShares).values({
      firmId: OWN_FIRM, ownerUserId: OWNER, recipientUserId: RCPT,
      recipientEmail: "r@x.com", scope: "all", permission: "view", createdBy: OWNER,
    });
    const details = await resolveSharesForRecipient(RCPT);
    expect(details).toEqual([
      expect.objectContaining({ clientId: a, ownerUserId: OWNER, firmId: OWN_FIRM, permission: "view" }),
    ]);
  });
});
