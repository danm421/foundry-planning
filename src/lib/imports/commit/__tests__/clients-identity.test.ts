import { describe, it, expect } from "vitest";
import { commitClientsIdentity } from "../clients-identity";
import { clients, crmHouseholdContacts, crmHouseholds, planSettings } from "@/db/schema";

/**
 * Fake tx for the identity commit. `commitClientsIdentity` runs several real
 * helpers on the handle it is given — `upsertPrimaryAndSpouseContacts` (which
 * SELECTs the contacts, then UPDATEs or INSERTs per role) and
 * `syncHouseholdNameFromContacts` (which SELECTs the household + contacts and
 * may UPDATE the name) — so the fake has to satisfy select / update / insert.
 *
 * Reads are seeded by table identity (all selects from a table return the same
 * rows, exactly like plan-basics.test.ts's fake). Writes are recorded in call
 * order as `{ table, patch }`; inserts as `{ table, values }`. `.where()`
 * resolves to undefined but also exposes `.returning()` for the legacy
 * clients dual-write, and `.values()` exposes `.onConflictDoNothing()` for the
 * spouse-contact insert.
 */
type Seed = {
  client: {
    crmHouseholdId: string;
    lifeExpectancy: number;
    spouseLifeExpectancy: number | null;
    spouseRetirementAge: number | null;
    spouseRetirementMonth: number | null;
  };
  contacts: {
    id: string;
    role: string;
    firstName: string | null;
    lastName: string | null;
    dateOfBirth: string | null;
  }[];
  household?: { name: string; nameIsCustom: boolean };
};

function fakeTx(seed: Seed) {
  const updates: { table: unknown; patch: Record<string, unknown> }[] = [];
  const inserts: { table: unknown; values: Record<string, unknown> }[] = [];

  const tx = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () => {
          if (table === clients) return [seed.client];
          if (table === crmHouseholdContacts) return seed.contacts;
          if (table === crmHouseholds) {
            return [seed.household ?? { name: "Seed Household", nameIsCustom: false }];
          }
          return [];
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => {
        updates.push({ table, patch });
        return {
          where: () => {
            const p: Promise<undefined> & { returning?: () => Promise<unknown[]> } =
              Promise.resolve(undefined);
            p.returning = async () => [{ id: "c1" }];
            return p;
          },
        };
      },
    }),
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        const p: Promise<undefined> & { onConflictDoNothing?: () => Promise<undefined> } =
          Promise.resolve(undefined);
        p.onConflictDoNothing = () => Promise.resolve(undefined);
        return p;
      },
    }),
  };

  return { tx, updates, inserts };
}

const CTX = { clientId: "c1", scenarioId: "s1", orgId: "f1", userId: "u1" } as never;

// A single-person household: one primary contact, no spouse row, and the
// null spouse-planning columns create-client leaves on a client created single.
function singleSeed(): Seed {
  return {
    client: {
      crmHouseholdId: "hh1",
      lifeExpectancy: 90,
      spouseLifeExpectancy: null,
      spouseRetirementAge: null,
      spouseRetirementMonth: null,
    },
    contacts: [
      {
        id: "p1",
        role: "primary",
        firstName: "Bob",
        lastName: "Smith",
        dateOfBirth: "1970-06-15",
      },
    ],
    household: { name: "Smith Household", nameIsCustom: false },
  };
}

// Import payload that adds a spouse (name + DOB only — the extractor never
// carries retirement age / life expectancy).
const SPOUSE = { firstName: "Carol", lastName: "Smith", dateOfBirth: "1978-04-10" };
const ADDS_SPOUSE = { spouse: SPOUSE } as never;

const clientUpdatesWith = (
  updates: { table: unknown; patch: Record<string, unknown> }[],
  key: string,
) => updates.filter((u) => u.table === clients && key in u.patch).map((u) => u.patch);

describe("commitClientsIdentity — single → married planning seed", () => {
  it("inserts the spouse contact AND seeds spouse planning fields + extends the horizon", async () => {
    const { tx, updates, inserts } = fakeTx(singleSeed());

    await commitClientsIdentity(tx as never, ADDS_SPOUSE, CTX);

    // Parent fix: the spouse CRM contact is INSERTED (source of truth).
    const spouseInsert = inserts.find(
      (i) => i.table === crmHouseholdContacts && i.values.role === "spouse",
    );
    expect(spouseInsert).toBeTruthy();
    expect(spouseInsert?.values).toMatchObject({ firstName: "Carol" });

    // New behavior: the null spouse-planning columns are defaulted 65 / 1 / 95.
    const [seedPatch] = clientUpdatesWith(updates, "spouseLifeExpectancy");
    expect(seedPatch).toMatchObject({
      spouseRetirementAge: 65,
      spouseRetirementMonth: 1,
      spouseLifeExpectancy: 95,
    });

    // Horizon moves to the later spouse death year, in the PRIMARY's years:
    // spouse dies 1978 + 95 = 2073; client would die 1970 + 90 = 2060.
    // planEndAge = 2073 - 1970 = 103; planEndYear = 2073.
    expect(seedPatch).toMatchObject({ planEndAge: 103 });
    const settingsCall = updates.find((u) => u.table === planSettings);
    expect(settingsCall?.patch).toMatchObject({ planEndYear: 2073 });
    expect(settingsCall?.patch.updatedAt).toBeInstanceOf(Date);
  });

  it("falls back to the stored primary DOB when the payload omits it", async () => {
    // Payload renames the primary but carries no DOB; the horizon must still
    // derive from the CRM primary contact's stored DOB (1970-06-15).
    const { tx, updates } = fakeTx(singleSeed());
    await commitClientsIdentity(
      tx as never,
      { primary: { firstName: "Robert" }, spouse: SPOUSE } as never,
      CTX,
    );
    const [seedPatch] = clientUpdatesWith(updates, "planEndAge");
    expect(seedPatch).toMatchObject({ planEndAge: 103 });
  });

  it("does NOT clobber advisor-set spouse life expectancy (gate is spouseLifeExpectancy IS NULL)", async () => {
    const seed = singleSeed();
    seed.client.spouseLifeExpectancy = 90; // advisor already set it
    seed.client.spouseRetirementAge = 62;
    seed.contacts.push({
      id: "s1c",
      role: "spouse",
      firstName: "Carol",
      lastName: "Smith",
      dateOfBirth: "1978-04-10",
    });
    const { tx, updates } = fakeTx(seed);

    await commitClientsIdentity(tx as never, ADDS_SPOUSE, CTX);

    // No planning-seed update and no horizon propagation.
    expect(clientUpdatesWith(updates, "spouseLifeExpectancy")).toHaveLength(0);
    expect(clientUpdatesWith(updates, "planEndAge")).toHaveLength(0);
    expect(updates.filter((u) => u.table === planSettings)).toHaveLength(0);
  });

  it("is a no-op on planning fields for a married → married import (spouse LE already set)", async () => {
    const seed = singleSeed();
    seed.client.spouseLifeExpectancy = 95;
    seed.client.spouseRetirementAge = 65;
    seed.contacts.push({
      id: "s1c",
      role: "spouse",
      firstName: "Carol",
      lastName: "Smith",
      dateOfBirth: "1978-04-10",
    });
    const { tx, updates } = fakeTx(seed);

    await commitClientsIdentity(tx as never, ADDS_SPOUSE, CTX);

    expect(clientUpdatesWith(updates, "spouseLifeExpectancy")).toHaveLength(0);
    expect(updates.filter((u) => u.table === planSettings)).toHaveLength(0);
  });

  it("does not seed spouse fields when the import carries no spouse", async () => {
    const { tx, updates } = fakeTx(singleSeed());
    await commitClientsIdentity(
      tx as never,
      { primary: { firstName: "Bob", lastName: "Smith" } } as never,
      CTX,
    );
    expect(clientUpdatesWith(updates, "spouseLifeExpectancy")).toHaveLength(0);
    expect(updates.filter((u) => u.table === planSettings)).toHaveLength(0);
  });

  it("seeds spouse planning defaults but warns (never fails) when the primary has no DOB", async () => {
    const seed = singleSeed();
    seed.contacts[0].dateOfBirth = null; // primary DOB missing
    const { tx, updates } = fakeTx(seed);

    const res = await commitClientsIdentity(tx as never, ADDS_SPOUSE, CTX);

    // Spouse defaults still land (they don't need a DOB)...
    const [seedPatch] = clientUpdatesWith(updates, "spouseLifeExpectancy");
    expect(seedPatch).toMatchObject({ spouseLifeExpectancy: 95 });
    // ...but the horizon is skipped and flagged rather than throwing.
    expect(seedPatch).not.toHaveProperty("planEndAge");
    expect(updates.filter((u) => u.table === planSettings)).toHaveLength(0);
    expect(res.warnings).toContain(
      "Life expectancy saved, but the plan horizon could not be recomputed — " +
        "no date of birth on file for the primary client.",
    );
  });
});
