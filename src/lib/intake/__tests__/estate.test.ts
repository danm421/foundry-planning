import { describe, expect, it } from "vitest";

import {
  FIDUCIARY_SLOTS,
  childDistributionLabel,
  estateHousehold,
  estateSlotsFor,
  fiduciaryContactLine,
  fiduciarySlotLabel,
  findContact,
  findFiduciary,
  formatEstateAddress,
  isEstateEmpty,
  legalResidenceLabel,
  namedFiduciaries,
  rolesForName,
  setContact,
  setFiduciary,
} from "@/lib/intake/estate";
import {
  intakeDraftSchema,
  intakeSubmitSchemaFor,
  pruneIntakeBlankRows,
  type IntakeDraft,
} from "@/lib/intake/schema";

type EstateDraft = NonNullable<IntakeDraft["estate"]>;

const GUARDIAN_1 = { role: "guardian", priority: "primary" } as const;
const GUARDIAN_2 = { role: "guardian", priority: "backup" } as const;
const TRUSTEE_1 = { role: "trustee", priority: "primary" } as const;
const EXECUTOR_1 = { role: "executor", priority: "primary" } as const;

describe("fiduciary slots", () => {
  it("offers a first choice and a backup for every role", () => {
    expect(FIDUCIARY_SLOTS.map(fiduciarySlotLabel)).toEqual([
      "Guardian · First choice",
      "Guardian · Backup",
      "Trustee · First choice",
      "Trustee · Backup",
      "Executor · First choice",
      "Executor · Backup",
    ]);
  });

  it("drops guardianship for a household the Family step says has no children", () => {
    const noKids = estateHousehold({
      primary: { firstName: "Matt" },
      children: [],
    });
    expect(estateSlotsFor(noKids).map((s) => s.role)).not.toContain("guardian");
    // The other two roles are unaffected — an estate still needs an executor.
    expect(estateSlotsFor(noKids)).toHaveLength(4);
  });

  it("keeps guardianship when the form never collected Family", () => {
    // The unknown case must ASK. Hiding the question on a form that simply
    // doesn't collect Family would silently collect half a questionnaire.
    const unknown = estateHousehold(undefined);
    expect(unknown.hasChildren).toBe(true);
    expect(unknown.hasSpouse).toBe(true);
    expect(estateSlotsFor(unknown)).toHaveLength(6);
  });

  it("reads names, spouse and children off the Family step", () => {
    const household = estateHousehold({
      primary: { firstName: "Matt" },
      spouse: { firstName: "Bre" },
      children: [{ firstName: "Emma" }, { firstName: "" }, { firstName: "Jack" }],
    });
    expect(household.primaryName).toBe("Matt");
    expect(household.spouseName).toBe("Bre");
    // An unnamed child row is still a child — it just has no name to show.
    expect(household.hasChildren).toBe(true);
    expect(household.childNames).toEqual(["Emma", "Jack"]);
  });

  it("upserts one row per slot rather than appending a second", () => {
    let rows = setFiduciary<EstateDraft["fiduciaries"] extends (infer R)[] | undefined ? R : never>(
      [],
      GUARDIAN_1,
      { ...GUARDIAN_1, name: "Sara" },
    );
    rows = setFiduciary(rows, GUARDIAN_1, { ...GUARDIAN_1, name: "Sarah Klein" });
    rows = setFiduciary(rows, GUARDIAN_2, { ...GUARDIAN_2, name: "Tom Klein" });

    expect(rows).toHaveLength(2);
    expect(findFiduciary(rows, GUARDIAN_1)?.name).toBe("Sarah Klein");
    expect(findFiduciary(rows, GUARDIAN_2)?.name).toBe("Tom Klein");
  });
});

describe("contact details asked once per person", () => {
  const rows = [
    { ...TRUSTEE_1, name: "Sarah Klein" },
    { ...EXECUTOR_1, name: "sarah klein" },
    { ...GUARDIAN_1, name: "Tom Klein" },
  ];

  it("de-duplicates the same person across roles, keeping the first spelling", () => {
    // Fill order, not slot order — a card must not jump while it is being
    // typed into. "sarah klein" is the same person as "Sarah Klein".
    expect(namedFiduciaries(rows)).toEqual(["Sarah Klein", "Tom Klein"]);
  });

  it("lists every role one person is named for", () => {
    expect(rolesForName(rows, "SARAH KLEIN")).toEqual([
      "Trustee · First choice",
      "Executor · First choice",
    ]);
  });

  it("matches a contact card to its person regardless of case or padding", () => {
    const contacts = setContact([], "Sarah Klein", {
      name: "Sarah Klein",
      city: "Ann Arbor, MI",
    });
    expect(findContact(contacts, "  sarah klein ")?.city).toBe("Ann Arbor, MI");
    // Editing the same person's card updates it in place.
    expect(setContact(contacts, "sarah klein", { name: "Sarah Klein", city: "Detroit" })).toHaveLength(1);
  });

  it("renders a contact card as one line, dropping what was left blank", () => {
    expect(
      fiduciaryContactLine({ relationship: "sister", city: "Ann Arbor, MI", phone: "734-555-0100" }),
    ).toBe("sister · Ann Arbor, MI · 734-555-0100");
    expect(fiduciaryContactLine({ city: "  " })).toBeNull();
    expect(fiduciaryContactLine(undefined)).toBeNull();
  });
});

describe("one-line renderings", () => {
  it("formats a partial address without stray commas", () => {
    expect(
      formatEstateAddress({
        addressLine1: "1200 Maple St",
        addressLine2: "Apt 4",
        city: "Ann Arbor",
        state: "MI",
        postalCode: "48104",
      }),
    ).toBe("1200 Maple St, Apt 4, Ann Arbor, MI 48104");
    expect(formatEstateAddress({ city: "Ann Arbor", state: "MI" })).toBe("Ann Arbor, MI");
    expect(formatEstateAddress({})).toBeNull();
    expect(formatEstateAddress(undefined)).toBeNull();
  });

  it("never renders an unanswered legal-residence question as a No", () => {
    expect(legalResidenceLabel({})).toBeNull();
    expect(legalResidenceLabel({ isLegalResidence: true })).toBe("Yes");
    expect(legalResidenceLabel({ isLegalResidence: false })).toBe("No");
    expect(
      legalResidenceLabel({ isLegalResidence: false, legalResidenceNote: "Florida" }),
    ).toBe("No — Florida");
  });

  it("spells out the suggested schedule rather than naming it", () => {
    const label = childDistributionLabel({ plan: "suggested" });
    // The terms themselves have to survive into the record: "chose the
    // suggested schedule" with no schedule attached is not a record of anything.
    expect(label).toContain("25");
    expect(label).toContain("30");
    expect(label).toContain("35");
    expect(childDistributionLabel({ plan: "custom" })).toBe("Their own instructions");
    expect(childDistributionLabel(undefined)).toBeNull();
  });
});

describe("isEstateEmpty", () => {
  it("is true for an untouched step and for an abandoned slot card", () => {
    expect(isEstateEmpty(undefined)).toBe(true);
    expect(isEstateEmpty({})).toBe(true);
    expect(
      isEstateEmpty({
        fiduciaries: [{ ...GUARDIAN_1, name: "   " }],
        fiduciaryContacts: [{ name: "Sarah" }],
      }),
    ).toBe(true);
  });

  it.each([
    ["a mobile number", { contact: { primary: { mobile: "734-555-0100" } } }],
    ["an address", { residence: { city: "Ann Arbor" } }],
    ["a legal-residence answer of No", { residence: { isLegalResidence: false } }],
    ["a nomination", { fiduciaries: [{ ...GUARDIAN_1, name: "Sarah Klein" }] }],
    ["a distribution choice", { childrenDistribution: { plan: "suggested" as const } }],
  ])("is false once the client has given %s", (_label, slice) => {
    expect(isEstateEmpty(slice as EstateDraft)).toBe(false);
  });
});

describe("submit-time pruning", () => {
  const draft = {
    estate: {
      fiduciaries: [
        { ...GUARDIAN_1, name: "Sarah Klein" },
        // Opened and abandoned — must not 422 the submit on `name.min(1)`.
        { ...GUARDIAN_2, name: "" },
      ],
      fiduciaryContacts: [
        { name: "Sarah Klein", city: "Ann Arbor, MI" },
        // Left behind by a client who typed "Sara", filled in her city, then
        // corrected the spelling: referenced by nobody.
        { name: "Sara", city: "Ypsilanti" },
        // Referenced, but nothing was typed into it.
        { name: "Tom Klein" },
      ],
    },
  };

  it("drops unnamed slots, blank cards and cards nobody is named on", () => {
    const pruned = pruneIntakeBlankRows(draft) as typeof draft;
    expect(pruned.estate.fiduciaries).toHaveLength(1);
    expect(pruned.estate.fiduciaryContacts).toEqual([
      { name: "Sarah Klein", city: "Ann Arbor, MI" },
    ]);
  });

  it("leaves a pruned payload that passes the strict submit schema", () => {
    const pruned = pruneIntakeBlankRows({ ...draft, accounts: [], income: [], property: [] });
    const parsed = intakeSubmitSchemaFor(["estate"]).safeParse(pruned);
    expect(parsed.success).toBe(true);
  });

  it("round-trips a half-typed slot through the autosave schema", () => {
    // The draft variant has to accept the empty name a freshly-opened slot
    // carries, or every keystroke on this step would 422 the autosave.
    const parsed = intakeDraftSchema.safeParse({
      estate: {
        fiduciaries: [{ ...TRUSTEE_1, name: "" }],
        residence: { state: "M" },
      },
    });
    expect(parsed.success).toBe(true);
  });
});
