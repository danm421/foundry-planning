import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmHouseholdContacts, crmHouseholds } from "@/db/schema";

vi.mock("@/lib/crm-tasks/members", () => ({ listFirmMembers: vi.fn() }));
import { listFirmMembers } from "@/lib/crm-tasks/members";
import { suggestAttendees } from "./attendee-suggestions";

const FIRM = `org_wssuggest_${Date.now().toString(36)}`;
const ME = "user_me";

const member = (userId: string, displayName: string, email: string | null) => ({
  userId,
  displayName,
  email,
  imageUrl: null,
  role: "Member",
  roleKey: "org:member",
});

beforeAll(async () => {
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
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
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
});
