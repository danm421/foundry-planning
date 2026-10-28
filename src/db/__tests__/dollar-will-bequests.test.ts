import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  clients,
  crmHouseholds,
  crmHouseholdContacts,
  scenarios,
  familyMembers,
  accounts,
  wills,
  willBequests,
  willBequestRecipients,
} from "@/db/schema";

// Real-write proof for dollar will bequests: the will_bequests_kind_shape_check
// rewrite, the recipient amount/percentage check and the account-delete trigger
// are hand-written SQL, so only real writes prove them.
//
// Runs against the live Neon branch in DATABASE_URL.

const firmId = `test-org-dollar-will-bequests-${crypto.randomUUID()}`;
let clientId: string;
let familyMemberId: string;
let cashId: string;
let realEstateId: string;
let willId: string;
let scenarioId: string;

async function setup() {
  const [household] = await db
    .insert(crmHouseholds)
    .values({ firmId, advisorId: "test-advisor", name: "DollarBequests Smoke" })
    .returning();
  await db.insert(crmHouseholdContacts).values({
    householdId: household.id,
    role: "primary",
    firstName: "DollarTest",
    lastName: "Smoke",
    dateOfBirth: "1970-01-01",
  });
  const [client] = await db
    .insert(clients)
    .values({ firmId, advisorId: "test-advisor", crmHouseholdId: household.id, retirementAge: 65, planEndAge: 95 })
    .returning();
  clientId = client.id;
  const [scenario] = await db
    .insert(scenarios)
    .values({ clientId, name: "Smoke Scenario", isBaseCase: true })
    .returning();
  scenarioId = scenario.id;
  const [fm] = await db
    .insert(familyMembers)
    .values({ clientId, firstName: "Child", relationship: "child", role: "other" })
    .returning();
  familyMemberId = fm.id;
  const [cash] = await db
    .insert(accounts)
    .values({ clientId, scenarioId, name: "Smoke Cash", category: "cash" })
    .returning();
  cashId = cash.id;
  const [re] = await db
    .insert(accounts)
    .values({ clientId, scenarioId, name: "Smoke House", category: "real_estate" })
    .returning();
  realEstateId = re.id;
  const [will] = await db.insert(wills).values({ clientId, grantor: "client" }).returning();
  willId = will.id;
}

// drizzle wraps the driver error; the violated constraint name is on `cause`.
async function rejectsWithConstraint(p: PromiseLike<unknown>, name: string) {
  const err = await Promise.resolve(p).then(
    () => null,
    (e: unknown) => e as { message?: string; cause?: { message?: string; constraint?: string } },
  );
  expect(err, "expected the insert to be rejected").not.toBeNull();
  const text = `${err?.message} ${err?.cause?.message} ${err?.cause?.constraint}`;
  expect(text).toContain(name);
}

type BequestInsert = typeof willBequests.$inferInsert;
function dollar(over: Partial<BequestInsert>): BequestInsert {
  return {
    willId,
    name: "Dollar gift",
    kind: "dollar",
    dollarSource: "estate",
    percentage: "100",
    condition: "always",
    sortOrder: 0,
    ...over,
  };
}

afterAll(async () => {
  if (clientId) await db.delete(clients).where(eq(clients.id, clientId));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, firmId));
});

describe("dollar will bequests", () => {
  it("setup fixtures", async () => {
    await setup();
    expect(cashId).toBeTruthy();
    expect(realEstateId).toBeTruthy();
    expect(willId).toBeTruthy();
  });

  it("inserts an estate-wide dollar gift", async () => {
    const [b] = await db
      .insert(willBequests)
      .values(dollar({ dollarSource: "estate", accountId: null, fallbackToEstate: false }))
      .returning();
    await expect(
      db.insert(willBequestRecipients).values({
        bequestId: b.id,
        recipientKind: "family_member",
        recipientId: familyMemberId,
        amount: "20000.00",
        percentage: null,
        sortOrder: 0,
      }),
    ).resolves.toBeDefined();
  });

  it("inserts a named-account dollar gift with and without the fallback", async () => {
    await expect(
      db.insert(willBequests).values(dollar({ dollarSource: "account", accountId: cashId, fallbackToEstate: true, sortOrder: 1 })),
    ).resolves.toBeDefined();
    await expect(
      db.insert(willBequests).values(dollar({ dollarSource: "account", accountId: cashId, fallbackToEstate: false, sortOrder: 2 })),
    ).resolves.toBeDefined();
  });

  it("rejects an estate-wide dollar gift that names an account", async () => {
    await rejectsWithConstraint(
      db.insert(willBequests).values(dollar({ dollarSource: "estate", accountId: cashId, sortOrder: 3 })),
      "will_bequests_kind_shape_check",
    );
  });

  it("rejects a dollar gift with no source", async () => {
    await rejectsWithConstraint(
      db.insert(willBequests).values(dollar({ dollarSource: null, accountId: null, sortOrder: 10 })),
      "will_bequests_kind_shape_check",
    );
  });

  async function freshBequest(sortOrder: number) {
    const [b] = await db.insert(willBequests).values(dollar({ sortOrder })).returning();
    return b.id;
  }

  it("rejects a recipient with both percentage and amount", async () => {
    const bequestId = await freshBequest(4);
    await rejectsWithConstraint(
      db.insert(willBequestRecipients).values({
        bequestId, recipientKind: "family_member", recipientId: familyMemberId,
        percentage: "50", amount: "100.00", sortOrder: 0,
      }),
      "will_bequest_recipients_amount_or_percentage",
    );
  });

  it("rejects a recipient with neither", async () => {
    const bequestId = await freshBequest(5);
    await rejectsWithConstraint(
      db.insert(willBequestRecipients).values({
        bequestId, recipientKind: "family_member", recipientId: familyMemberId,
        percentage: null, amount: null, sortOrder: 0,
      }),
      "will_bequest_recipients_amount_or_percentage",
    );
  });

  it("rejects a zero amount", async () => {
    const bequestId = await freshBequest(6);
    await rejectsWithConstraint(
      db.insert(willBequestRecipients).values({
        bequestId, recipientKind: "family_member", recipientId: familyMemberId,
        percentage: null, amount: "0.00", sortOrder: 0,
      }),
      "will_bequest_recipients_amount_or_percentage",
    );
  });

  it("deleting the named account keeps the dollar gift and drops the percentage gift", async () => {
    const [acct] = await db
      .insert(accounts)
      .values({ clientId, scenarioId, name: "Doomed Cash", category: "cash" })
      .returning();
    const [pct] = await db
      .insert(willBequests)
      .values({
        willId, name: "Pct gift", kind: "asset", assetMode: "specific", accountId: acct.id,
        percentage: "100", condition: "always", sortOrder: 7,
      })
      .returning();
    const [dol] = await db
      .insert(willBequests)
      .values(dollar({ dollarSource: "account", accountId: acct.id, sortOrder: 8 }))
      .returning();

    await db.delete(accounts).where(eq(accounts.id, acct.id));

    const pctRows = await db.select().from(willBequests).where(eq(willBequests.id, pct.id));
    expect(pctRows).toHaveLength(0);
    const dolRows = await db.select().from(willBequests).where(eq(willBequests.id, dol.id));
    expect(dolRows).toHaveLength(1);
    expect(dolRows[0].accountId).toBeNull();
    expect(dolRows[0].dollarSource).toBe("account");
  });

  it("deleting the client cascades a will holding both gift kinds", async () => {
    await db.insert(willBequests).values({
      willId, name: "Pct gift 2", kind: "asset", assetMode: "specific", accountId: realEstateId,
      percentage: "100", condition: "always", sortOrder: 9,
    });
    await expect(db.delete(clients).where(eq(clients.id, clientId))).resolves.toBeDefined();
    const rows = await db.select().from(willBequests).where(eq(willBequests.willId, willId));
    expect(rows).toHaveLength(0);
  });
});
