import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/db";
import { crmHouseholds, intakeForms, clients } from "@/db/schema";
import { eq } from "drizzle-orm";
import { createClientForHousehold } from "@/lib/clients/create-client";
import { newIntakeToken, defaultExpiry } from "../tokens";
import type { IntakePayload } from "../schema";
import { resolveIntakeHousehold, placeholderHouseholdName } from "../documents";

const FIRM = "test-firm-intake-docs-hh-2026";
const ADVISOR = "user_test_intake_docs";

async function seedProspectForm(recipientName: string | null): Promise<string> {
  const [form] = await db
    .insert(intakeForms)
    .values({
      firmId: FIRM,
      clientId: null,
      mode: "blank",
      status: "draft",
      token: newIntakeToken(),
      recipientEmail: "jordan.reyes@example.com",
      recipientName,
      payload: {} as unknown as IntakePayload,
      createdByUserId: ADVISOR,
      expiresAt: defaultExpiry(new Date()),
    })
    .returning({ id: intakeForms.id });
  return form.id;
}

afterAll(async () => {
  const forms = await db
    .select({ id: intakeForms.id })
    .from(intakeForms)
    .where(eq(intakeForms.firmId, FIRM));
  for (const f of forms) await db.delete(intakeForms).where(eq(intakeForms.id, f.id));
  await db.delete(clients).where(eq(clients.firmId, FIRM));
  await db.delete(crmHouseholds).where(eq(crmHouseholds.firmId, FIRM));
});

describe("placeholderHouseholdName", () => {
  it("prefers the recipient name", () => {
    expect(placeholderHouseholdName("Jordan Reyes", "j@example.com")).toBe(
      "Jordan Reyes Household",
    );
  });

  it("falls back to the email local part", () => {
    expect(placeholderHouseholdName(null, "jordan.reyes@example.com")).toBe(
      "jordan.reyes Household",
    );
  });

  it("treats a whitespace-only name as absent", () => {
    expect(placeholderHouseholdName("   ", "jordan@example.com")).toBe("jordan Household");
  });
});

describe("resolveIntakeHousehold", () => {
  it("mints a household on first call for a prospect form and parks it on the form", async () => {
    const formId = await seedProspectForm("Jordan Reyes");

    const householdId = await resolveIntakeHousehold(formId);

    const [hh] = await db
      .select()
      .from(crmHouseholds)
      .where(eq(crmHouseholds.id, householdId));
    expect(hh.firmId).toBe(FIRM);
    expect(hh.advisorId).toBe(ADVISOR);
    expect(hh.name).toBe("Jordan Reyes Household");
    // Must stay false so syncHouseholdNameFromContacts can re-derive the real
    // name once applyIntake writes the actual contacts.
    expect(hh.nameIsCustom).toBe(false);
    expect(hh.status).toBe("prospect");

    const [form] = await db
      .select({ crmHouseholdId: intakeForms.crmHouseholdId })
      .from(intakeForms)
      .where(eq(intakeForms.id, formId));
    expect(form.crmHouseholdId).toBe(householdId);
  });

  it("reuses the parked household on a second call", async () => {
    const formId = await seedProspectForm("Jordan Reyes");

    const first = await resolveIntakeHousehold(formId);
    const second = await resolveIntakeHousehold(formId);

    expect(second).toBe(first);
    const rows = await db
      .select({ id: crmHouseholds.id })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.firmId, FIRM));
    expect(rows.filter((r) => r.id === first)).toHaveLength(1);
  });

  it("mints exactly one household under concurrent first uploads (shared client+spouse token)", async () => {
    const formId = await seedProspectForm("Jordan Reyes");

    const results = await Promise.all([
      resolveIntakeHousehold(formId),
      resolveIntakeHousehold(formId),
      resolveIntakeHousehold(formId),
    ]);

    expect(new Set(results).size).toBe(1);
  });

  it("blocks a concurrent resolver until the row-locking winner commits (deterministic interleaving)", async () => {
    // Unlike the Promise.all smoke test above, this forces the exact
    // interleaving the race guard exists for, instead of hoping the scheduler
    // produces it: transaction A takes the row lock and holds the transaction
    // open; only once we know A holds the lock do we start B
    // (resolveIntakeHousehold). With `.for("update")` in place, B's own
    // locking SELECT must block until A commits, so it can only ever observe
    // A's committed `crmHouseholdId` — never mint a second household. Remove
    // the lock and B's plain SELECT reads the still-uncommitted `null`,
    // mints a duplicate, and only overwrites the form's FK after the fact —
    // by then the second household row already exists.
    const formId = await seedProspectForm("Jordan Reyes");

    let markALocked: () => void;
    const aHasLock = new Promise<void>((resolve) => {
      markALocked = resolve;
    });
    let releaseA: () => void;
    const letAProceed = new Promise<void>((resolve) => {
      releaseA = resolve;
    });

    const aPromise = db.transaction(async (tx) => {
      await tx
        .select({ id: intakeForms.id })
        .from(intakeForms)
        .where(eq(intakeForms.id, formId))
        .for("update");

      markALocked();
      await letAProceed;

      const [household] = await tx
        .insert(crmHouseholds)
        .values({
          firmId: FIRM,
          advisorId: ADVISOR,
          name: "Transaction A Household",
          nameIsCustom: false,
        })
        .returning({ id: crmHouseholds.id });

      await tx
        .update(intakeForms)
        .set({ crmHouseholdId: household.id, updatedAt: new Date() })
        .where(eq(intakeForms.id, formId));

      return household.id;
    });

    // Don't start B until A has provably taken the row lock.
    await aHasLock;

    const householdCountBefore = await db
      .select({ id: crmHouseholds.id })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.firmId, FIRM));

    const bPromise = resolveIntakeHousehold(formId);

    // Give B's own SELECT time to actually reach Postgres (and, with the lock
    // in place, register as waiting on A) before we let A finish and commit.
    // Without this pause, A could commit before B's query is even in flight,
    // which would make the unlocked case pass by accident rather than by
    // exercising the race.
    await new Promise((resolve) => setTimeout(resolve, 300));

    releaseA!();

    const [householdAId, householdBId] = await Promise.all([aPromise, bPromise]);

    expect(householdBId).toBe(householdAId);

    const householdCountAfter = await db
      .select({ id: crmHouseholds.id })
      .from(crmHouseholds)
      .where(eq(crmHouseholds.firmId, FIRM));
    expect(householdCountAfter.length - householdCountBefore.length).toBe(1);
  });

  it("resolves an existing client's household without minting", async () => {
    const [hh] = await db
      .insert(crmHouseholds)
      .values({ firmId: FIRM, advisorId: ADVISOR, name: "Existing HH" })
      .returning({ id: crmHouseholds.id });
    const { clientId } = await createClientForHousehold({
      household: { id: hh.id, firmId: FIRM, advisorId: ADVISOR, state: "NJ" },
      primaryContact: { firstName: "Ada", lastName: "Byron", dateOfBirth: "1975-03-02" },
      spouseContact: null,
      retirementAge: 65,
      lifeExpectancy: 95,
      spouseRetirementAge: null,
      filingStatus: "single",
    });

    const [form] = await db
      .insert(intakeForms)
      .values({
        firmId: FIRM,
        clientId,
        mode: "prefilled",
        status: "draft",
        token: newIntakeToken(),
        recipientEmail: "ada@example.com",
        recipientName: "Ada Byron",
        payload: {} as unknown as IntakePayload,
        createdByUserId: ADVISOR,
        expiresAt: defaultExpiry(new Date()),
      })
      .returning({ id: intakeForms.id });

    const resolved = await resolveIntakeHousehold(form.id);
    expect(resolved).toBe(hh.id);

    const [after] = await db
      .select({ crmHouseholdId: intakeForms.crmHouseholdId })
      .from(intakeForms)
      .where(eq(intakeForms.id, form.id));
    expect(after.crmHouseholdId).toBeNull();
  });
});
