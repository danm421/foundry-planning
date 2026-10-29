import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts, crmHouseholds, firms } from "@/db/schema";
import { findHouseholdsByEmail, linkEventHousehold } from "./client-links";
import type { WorkspaceEvent } from "./types";

const RUN = Date.now().toString(36);
const SILO = `org_wslinks_silo_${RUN}`;
const OPEN = `org_wslinks_open_${RUN}`;
const OWNER = "adv_owner";
const OTHER = "adv_other";

let liveId: string;
let privateSiloId: string;

async function seedHousehold(
  firmId: string,
  advisorId: string,
  name: string,
  email: string,
  opts: { deleted?: boolean; isPrivate?: boolean } = {},
) {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId, name, deletedAt: opts.deleted ? new Date() : null })
    .returning();
  await db.insert(crmHouseholdContacts).values({
    householdId: h.id,
    role: "primary",
    firstName: "Pat",
    lastName: "Test",
    email,
  });
  if (opts.isPrivate !== undefined) {
    await db.insert(clients).values({
      firmId,
      advisorId,
      crmHouseholdId: h.id,
      isPrivate: opts.isPrivate,
      retirementAge: 65,
      planEndAge: 95,
      lifeExpectancy: 95,
      filingStatus: "single",
    });
  }
  return h.id;
}

beforeAll(async () => {
  await db.insert(firms).values([
    { firmId: SILO, bookSiloEnabled: true },
    { firmId: OPEN, bookSiloEnabled: false },
  ]);
  liveId = await seedHousehold(SILO, OWNER, "Live HH", "Pat@Example.com", { isPrivate: false });
  await seedHousehold(SILO, OWNER, "Deleted HH", "gone@example.com", { deleted: true });
  privateSiloId = await seedHousehold(SILO, OTHER, "Private Silo HH", "priv@example.com", {
    isPrivate: true,
  });
  // Non-silo firm: members see every book, so only the Private rule can hide.
  await seedHousehold(OPEN, OTHER, "Private Open HH", "privopen@example.com", { isPrivate: true });
  await seedHousehold(OPEN, OTHER, "Public Open HH", "pubopen@example.com", { isPrivate: false });
  // Same email on two households: first by name wins.
  await seedHousehold(OPEN, OTHER, "Zed HH", "dup@example.com", { isPrivate: false });
  await seedHousehold(OPEN, OTHER, "Alpha HH", "dup@example.com", { isPrivate: false });
});

afterAll(async () => {
  const firmIds = [SILO, OPEN];
  await db.delete(clients).where(inArray(clients.firmId, firmIds));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, firmIds));
  await db.delete(firms).where(inArray(firms.firmId, firmIds));
});

const find = (firmId: string, orgRole: string, emails: string[], userId = OWNER) =>
  findHouseholdsByEmail({ firmId, userId, orgRole, emails });

describe("findHouseholdsByEmail", () => {
  it("matches case-insensitively and keys by lowercased email", async () => {
    const map = await find(SILO, "org:member", ["pat@example.com"]);
    expect(map.get("pat@example.com")).toEqual({ householdId: liveId, householdName: "Live HH" });
  });

  it("returns an empty map for no emails", async () => {
    expect((await find(SILO, "org:member", [])).size).toBe(0);
  });

  it("ignores soft-deleted households", async () => {
    expect((await find(SILO, "org:member", ["gone@example.com"])).size).toBe(0);
  });

  it("is scoped to the firm", async () => {
    expect((await find(OPEN, "org:member", ["pat@example.com"])).size).toBe(0);
  });

  it("book rule + Private rule: other advisor's Private household in a book-silo firm", async () => {
    expect((await find(SILO, "org:member", ["priv@example.com"])).size).toBe(0);
    const admin = await find(SILO, "org:admin", ["priv@example.com"], "adv_admin");
    expect(admin.get("priv@example.com")?.householdId).toBe(privateSiloId);
  });

  it("Private rule alone hides it in a non-silo firm; a public household is still visible", async () => {
    const map = await find(OPEN, "org:member", ["privopen@example.com", "pubopen@example.com"]);
    expect(map.has("privopen@example.com")).toBe(false);
    expect(map.get("pubopen@example.com")?.householdName).toBe("Public Open HH");
    const own = await find(OPEN, "org:member", ["privopen@example.com"], OTHER);
    expect(own.has("privopen@example.com")).toBe(true);
  });

  it("an email on two households maps to the first by name", async () => {
    const map = await find(OPEN, "org:member", ["DUP@example.com"]);
    expect(map.get("dup@example.com")?.householdName).toBe("Alpha HH");
  });
});

describe("linkEventHousehold", () => {
  const link = { householdId: "h1", householdName: "Live HH" };
  const links = new Map([["pat@example.com", link]]);
  const event = (emails: string[]) =>
    ({ attendees: emails.map((email) => ({ email, name: null })) }) as unknown as WorkspaceEvent;

  it("matches attendees case-insensitively, first hit wins", () => {
    expect(linkEventHousehold(event(["x@y.com", "PAT@Example.com"]), links)).toBe(link);
  });
  it("returns null with no match", () => {
    expect(linkEventHousehold(event(["x@y.com"]), links)).toBeNull();
  });
});
