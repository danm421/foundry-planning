import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/db";
import { clients, crmHouseholdContacts, crmHouseholds, firms } from "@/db/schema";

vi.mock("@/lib/crm-tasks/members", () => ({ listFirmMembers: vi.fn() }));
import { listFirmMembers } from "@/lib/crm-tasks/members";
import { suggestAttendees } from "./attendee-suggestions";

const FIRM = `org_wssuggest_${Date.now().toString(36)}`;
const OPEN = `${FIRM}_open`;
const FOREIGN = `${FIRM}_foreign`;
const ME = "user_me";
const OTHER = "user_other";

async function seedContact(
  firmId: string,
  advisorId: string,
  first: string,
  email: string,
  opts: { deleted?: boolean; isPrivate?: boolean } = {},
) {
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId, name: `${first} HH`, deletedAt: opts.deleted ? new Date() : null })
    .returning();
  await db.insert(crmHouseholdContacts).values({
    householdId: h.id,
    role: "primary",
    firstName: first,
    lastName: "Scope",
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
}

const member = (userId: string, displayName: string, email: string | null) => ({
  userId,
  displayName,
  email,
  imageUrl: null,
  role: "Member",
  roleKey: "org:member",
});

beforeAll(async () => {
  await db.insert(firms).values([
    { firmId: FIRM, bookSiloEnabled: true },
    { firmId: OPEN, bookSiloEnabled: false },
    { firmId: FOREIGN, bookSiloEnabled: false },
  ]);
  // Silo firm: the caller's own household is the only one a member may see.
  await seedContact(FIRM, ME, "Pao", "pao@own.com", { isPrivate: false });
  await seedContact(FIRM, OTHER, "Pax", "pax@otherbook.com", { isPrivate: false });
  await seedContact(FIRM, OTHER, "Pak", "pak@otherprivate.com", { isPrivate: true });
  await seedContact(FIRM, ME, "Pal", "pal@deleted.com", { deleted: true });
  // Another firm, same advisor id: only the firmId clause can hide it.
  await seedContact(FOREIGN, ME, "Pag", "pag@foreign.com", { isPrivate: false });
  // Non-silo firm: the book rule shows every book, so only Private can hide.
  await seedContact(OPEN, OTHER, "Pav", "pav@openpublic.com", { isPrivate: false });
  await seedContact(OPEN, OTHER, "Pah", "pah@openprivate.com", { isPrivate: true });
  const [h] = await db
    .insert(crmHouseholds)
    .values({ firmId: FIRM, advisorId: ME, name: "Suggest HH" })
    .returning();
  await db.insert(crmHouseholdContacts).values([
    { householdId: h.id, role: "primary", firstName: "Pat", lastName: "Client", email: "pat@client.com" },
    { householdId: h.id, role: "spouse", firstName: "Paula", lastName: "NoEmail", email: null },
    { householdId: h.id, role: "dependent", firstName: "Pablo", lastName: "Pct", email: "p_ablo@client.com" },
  ]);
  vi.mocked(listFirmMembers).mockResolvedValue([
    member("user_pam", "Pam Teammate", "pam@firm.com"),
    member(ME, "Pat Me", "me@firm.com"),
    member("user_dup", "Pat Dup", "PAT@client.com"),
  ]);
});

afterAll(async () => {
  const ids = [FIRM, OPEN, FOREIGN];
  await db.delete(clients).where(inArray(clients.firmId, ids));
  await db.delete(crmHouseholds).where(inArray(crmHouseholds.firmId, ids));
  await db.delete(firms).where(inArray(firms.firmId, ids));
});

const suggest = (query: string) =>
  suggestAttendees({ firmId: FIRM, userId: ME, orgRole: "org:admin", query });

describe("suggestAttendees", () => {
  it("returns contacts (client) then teammates (team)", async () => {
    const r = await suggest("pa");
    expect(r[0]).toEqual({ email: "pat@client.com", name: "Pat Client", kind: "client" });
    expect(r.find((s) => s.kind === "team")).toEqual({
      email: "pam@firm.com",
      name: "Pam Teammate",
      kind: "team",
    });
    expect(r.every((s, i) => s.kind === "client" || r.slice(0, i).some((x) => x.kind === "client"))).toBe(true);
  });

  it("skips contacts without an email and dedupes teammates against contacts", async () => {
    const r = await suggest("pa");
    expect(r.map((s) => s.email.toLowerCase())).not.toContain("null");
    expect(r.filter((s) => s.email.toLowerCase() === "pat@client.com")).toHaveLength(1);
    expect(r.some((s) => s.name === "Paula NoEmail")).toBe(false);
  });

  it("returns [] under 2 characters", async () => {
    expect(await suggest("p")).toEqual([]);
    expect(await suggest(" p ")).toEqual([]);
  });

  it("never suggests the caller", async () => {
    const r = await suggest("pat");
    expect(r.some((s) => s.email === "me@firm.com")).toBe(false);
  });

  it("treats % and _ literally", async () => {
    expect(await suggest("%%")).toEqual([]);
    expect((await suggest("p_a")).map((s) => s.email)).toEqual(["p_ablo@client.com"]);
  });

  it("a silo member sees only their own book, live households, in their own firm", async () => {
    const r = await suggestAttendees({ firmId: FIRM, userId: ME, orgRole: "org:member", query: "sco" });
    const clientEmails = r.filter((s) => s.kind === "client").map((s) => s.email);
    expect(clientEmails).toEqual(["pao@own.com"]);
  });

  it("Private rule alone: a non-silo member sees another advisor's public contact, not their Private one", async () => {
    const r = await suggestAttendees({ firmId: OPEN, userId: ME, orgRole: "org:member", query: "sco" });
    expect(r.filter((s) => s.kind === "client").map((s) => s.email)).toEqual(["pav@openpublic.com"]);
  });

  it("an admin sees every live book in the firm", async () => {
    const r = await suggestAttendees({ firmId: FIRM, userId: "user_admin", orgRole: "org:admin", query: "sco" });
    expect(r.filter((s) => s.kind === "client").map((s) => s.email).sort()).toEqual(
      ["pak@otherprivate.com", "pao@own.com", "pax@otherbook.com"],
    );
  });
});
