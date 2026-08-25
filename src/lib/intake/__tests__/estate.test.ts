import { describe, expect, it } from "vitest";

import {
  FIDUCIARY_SLOTS,
  beneficiaryShareTotal,
  childDisplayName,
  childDistributionLabel,
  estateBeneficiaryOptions,
  formatNameList,
  inheritanceSummaryLine,
  nextOtherBeneficiaryRef,
  predeceasedLabel,
  resolveEstateBeneficiaries,
  sharePercentLabel,
  splitFullName,
  toggleBeneficiary,
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


// ─── Who inherits ────────────────────────────────────────────────────────────

// Pinned rather than `new Date()` — an age assertion against the real clock
// starts failing on somebody's birthday.
const TODAY = new Date("2026-08-25T12:00:00Z");

const FAMILY = {
  primary: { firstName: "Matt", lastName: "Rowan", dateOfBirth: "1984-03-02" },
  spouse: { firstName: "Sarah", lastName: "Rowan", dateOfBirth: "1985-11-20" },
  children: [
    { firstName: "Emma", lastName: "Rowan", dateOfBirth: "2018-04-10" },
    { firstName: "Jack", lastName: "Rowan", dateOfBirth: "2021-01-05" },
  ],
} satisfies NonNullable<IntakeDraft["family"]>;

describe("the beneficiary picklist", () => {
  it("offers the spouse, then the Family step's children, then anyone added by hand", () => {
    const inheritance = {
      beneficiaries: [{ ref: "other:0", name: "Ruth Alvarez", relationship: "my sister" }],
    };
    expect(
      estateBeneficiaryOptions(FAMILY, inheritance, TODAY).map((o) => [o.ref, o.name, o.detail]),
    ).toEqual([
      ["spouse", "Sarah Rowan", "Spouse or partner"],
      ["child:0", "Emma Rowan", "Age 8"],
      ["child:1", "Jack Rowan", "Age 5"],
      ["other:0", "Ruth Alvarez", "my sister"],
    ]);
  });

  it("drops the spouse once the client says everything goes to them first", () => {
    // Otherwise the same fact is stated twice, and an attorney reading both has
    // to ask which one the client meant.
    const refs = estateBeneficiaryOptions(FAMILY, { spouseFirst: true }, TODAY).map((o) => o.ref);
    expect(refs).not.toContain("spouse");
    expect(refs).toEqual(["child:0", "child:1"]);
  });

  it("never offers a Family card the client opened and abandoned", () => {
    const withBlank = {
      ...FAMILY,
      children: [...FAMILY.children, { firstName: "", lastName: "", dateOfBirth: "" }],
    };
    expect(estateBeneficiaryOptions(withBlank, undefined, TODAY)).toHaveLength(3);
  });

  it("marks only the rows the client has ticked", () => {
    const options = estateBeneficiaryOptions(FAMILY, { beneficiaries: [{ ref: "child:1" }] }, TODAY);
    expect(options.map((o) => o.selected)).toEqual([false, false, true]);
  });

  it("ticks and unticks a row", () => {
    const make = (ref: string) => () => ({ ref });
    const once = toggleBeneficiary([], "child:0", make("child:0"));
    expect(once).toEqual([{ ref: "child:0" }]);
    expect(toggleBeneficiary(once, "child:0", make("child:0"))).toEqual([]);
  });

  it("counts a hand-added ref past the highest ever used, not the row count", () => {
    // Reusing a removed row's number would hand the fresh card the name and the
    // share of the person the client just deleted.
    expect(nextOtherBeneficiaryRef([{ ref: "other:0" }, { ref: "other:1" }])).toBe("other:2");
    expect(nextOtherBeneficiaryRef([{ ref: "other:3" }, { ref: "child:0" }])).toBe("other:4");
    expect(nextOtherBeneficiaryRef(undefined)).toBe("other:0");
  });

  it("splits a quick-added full name on the last space", () => {
    expect(splitFullName("Emma Rowan")).toEqual({ firstName: "Emma", lastName: "Rowan" });
    expect(splitFullName("  Mary Anne   Smith ")).toEqual({ firstName: "Mary Anne", lastName: "Smith" });
    expect(splitFullName("Prince")).toEqual({ firstName: "Prince" });
  });

  it("reads a child's display name off the Family step, first name alone if that is all there is", () => {
    expect(childDisplayName({ firstName: "Emma", lastName: "Rowan" })).toBe("Emma Rowan");
    expect(childDisplayName({ firstName: "Emma" })).toBe("Emma");
    expect(childDisplayName({ firstName: "", lastName: "" })).toBeNull();
  });
});

describe("resolving the chosen beneficiaries", () => {
  it("drops a row that names nobody, so the review card and the note agree with the prune", () => {
    const inheritance = {
      beneficiaries: [
        { ref: "child:0" },
        { ref: "child:7" }, // a child removed from the Family step since
        { ref: "other:0", name: "  " }, // a card opened and abandoned
      ],
    };
    expect(resolveEstateBeneficiaries(inheritance, FAMILY, TODAY).map((b) => b.name)).toEqual([
      "Emma Rowan",
    ]);
  });

  it("carries no percentage under an equal split, and the client's own under a custom one", () => {
    const rows = [
      { ref: "child:0", sharePercent: 60 },
      { ref: "child:1", sharePercent: 40 },
    ];
    expect(
      resolveEstateBeneficiaries({ beneficiaries: rows, sharing: "equal" }, FAMILY, TODAY).map(
        (b) => b.sharePercent,
      ),
    ).toEqual([null, null]);
    expect(
      resolveEstateBeneficiaries({ beneficiaries: rows, sharing: "custom" }, FAMILY, TODAY).map(
        (b) => b.sharePercent,
      ),
    ).toEqual([60, 40]);
  });

  it("totals the custom shares, and stays silent about an equal split", () => {
    const rows = [
      { ref: "child:0", sharePercent: 60 },
      { ref: "child:1", sharePercent: 35 },
    ];
    expect(beneficiaryShareTotal({ beneficiaries: rows, sharing: "custom" })).toBe(95);
    expect(beneficiaryShareTotal({ beneficiaries: rows, sharing: "equal" })).toBeNull();
  });

  it("trims a trailing zero off a share", () => {
    expect(sharePercentLabel(60)).toBe("60%");
    expect(sharePercentLabel(33.35)).toBe("33.4%");
    expect(sharePercentLabel(null)).toBeNull();
  });
});

describe("the inheritance summary line", () => {
  const summary = (inheritance: NonNullable<EstateDraft["inheritance"]>) =>
    inheritanceSummaryLine(inheritance, FAMILY, TODAY);

  it("reads the way the will does for the standard married-with-children answer", () => {
    expect(
      summary({
        spouseFirst: true,
        sharing: "equal",
        beneficiaries: [{ ref: "child:0" }, { ref: "child:1" }],
      }),
    ).toBe("Everything to Sarah Rowan first, then in equal shares to Emma Rowan and Jack Rowan");
  });

  it("drops 'in equal shares' when there is only one person to share with", () => {
    expect(summary({ sharing: "equal", beneficiaries: [{ ref: "child:0" }] })).toBe(
      "To Emma Rowan",
    );
  });

  it("spells out a custom split", () => {
    expect(
      summary({
        sharing: "custom",
        beneficiaries: [
          { ref: "child:0", sharePercent: 60 },
          { ref: "other:0", name: "Ruth Alvarez", sharePercent: 40 },
        ],
      }),
    ).toBe("To Emma Rowan (60%) and Ruth Alvarez (40%)");
  });

  it("still says what it knows when only the spouse question was answered", () => {
    expect(summary({ spouseFirst: true, beneficiaries: [] })).toBe(
      "Everything to Sarah Rowan first",
    );
    expect(summary({ beneficiaries: [] })).toBeNull();
  });

  it("never renders an unanswered predeceased question", () => {
    expect(predeceasedLabel(undefined)).toBeNull();
    expect(predeceasedLabel("to_their_children")).toBe("Their share passes to their own children");
  });

  it("joins names the way a sentence does", () => {
    expect(formatNameList(["Emma"])).toBe("Emma");
    expect(formatNameList(["Emma", "Jack"])).toBe("Emma and Jack");
    expect(formatNameList(["Emma", "Jack", "Nora"])).toBe("Emma, Jack and Nora");
    expect(formatNameList([])).toBe("");
  });
});

describe("submit-time pruning of the beneficiary list", () => {
  // The hazard this covers: a "child:<index>" ref is an index into the list AS
  // SUBMITTED, and the prune drops blank cards out of the middle of that list.
  // Without a re-index, every ref after the gap silently points at the wrong
  // sibling — which would send the estate to the wrong child.
  const withBlankSibling = {
    family: {
      primary: { firstName: "Matt", lastName: "Rowan", dateOfBirth: "1984-03-02" },
      children: [
        { firstName: "Emma", lastName: "Rowan", dateOfBirth: "2018-04-10" },
        { firstName: "", lastName: "", dateOfBirth: "" },
        { firstName: "Nora", lastName: "Rowan", dateOfBirth: "2023-06-01" },
      ],
    },
    goals: {
      expenseGoals: [
        { name: "College", type: "education" as const, amount: 30000, years: 4, forWhom: "child:2" },
      ],
      topics: [],
    },
    estate: {
      fiduciaries: [],
      fiduciaryContacts: [],
      inheritance: {
        sharing: "equal" as const,
        beneficiaries: [{ ref: "child:0" }, { ref: "child:2" }],
      },
    },
    accounts: [],
    income: [],
    property: [],
    meta: { completedSections: [] },
  };

  it("re-points every child ref when a blank sibling is dropped from the middle", () => {
    const pruned = pruneIntakeBlankRows(withBlankSibling) as typeof withBlankSibling;
    expect(pruned.family.children.map((c) => c.firstName)).toEqual(["Emma", "Nora"]);
    // Both consumers of the ref move together — the goal and the beneficiary.
    expect(pruned.goals.expenseGoals[0].forWhom).toBe("child:1");
    expect(pruned.estate.inheritance.beneficiaries.map((b) => b.ref)).toEqual([
      "child:0",
      "child:1",
    ]);
    // And the re-pointed ref names the child the client actually chose.
    expect(
      resolveEstateBeneficiaries(
        pruned.estate.inheritance,
        pruned.family,
        TODAY,
      ).map((b) => b.name),
    ).toEqual(["Emma Rowan", "Nora Rowan"]);
  });

  it("removes a beneficiary whose child was dropped, and keeps a goal that pointed at them", () => {
    const orphaned = {
      ...withBlankSibling,
      goals: {
        ...withBlankSibling.goals,
        expenseGoals: [
          { name: "College", type: "education" as const, amount: 30000, years: 4, forWhom: "child:1" },
        ],
      },
      estate: {
        ...withBlankSibling.estate,
        inheritance: { sharing: "equal" as const, beneficiaries: [{ ref: "child:1" }] },
      },
    };
    const pruned = pruneIntakeBlankRows(orphaned) as typeof withBlankSibling;
    // The row was nothing but the pointer, so it goes.
    expect(pruned.estate.inheritance.beneficiaries).toEqual([]);
    // The goal keeps its amount and its year, and loses only the pointer.
    expect(pruned.goals.expenseGoals[0].forWhom).toBeUndefined();
    expect(pruned.goals.expenseGoals[0].amount).toBe(30000);
  });

  it("drops a hand-added card the client never named, and keeps a ticked child", () => {
    const payload = {
      ...withBlankSibling,
      family: { ...withBlankSibling.family, children: [withBlankSibling.family.children[0]] },
      goals: { expenseGoals: [], topics: [] },
      estate: {
        fiduciaries: [],
        fiduciaryContacts: [],
        inheritance: {
          sharing: "equal" as const,
          beneficiaries: [
            { ref: "child:0" },
            { ref: "other:0" },
            { ref: "other:1", name: "Ruth Alvarez" },
          ],
        },
      },
    };
    const pruned = pruneIntakeBlankRows(payload) as typeof payload;
    expect(pruned.estate.inheritance.beneficiaries.map((b) => b.ref)).toEqual([
      "child:0",
      "other:1",
    ]);
  });

  it("leaves a pruned payload that passes the strict submit schema", () => {
    const pruned = pruneIntakeBlankRows(withBlankSibling);
    expect(() =>
      intakeSubmitSchemaFor(["family", "goals", "estate"]).parse(pruned),
    ).not.toThrow();
  });

  it("round-trips a half-answered inheritance through the autosave schema", () => {
    const draft = {
      estate: {
        inheritance: {
          spouseFirst: true,
          beneficiaries: [{ ref: "child:0" }, { ref: "other:0", name: "Ru" }],
        },
      },
    };
    expect(() => intakeDraftSchema.parse(draft)).not.toThrow();
  });

  it("counts a ticked beneficiary as an answered step", () => {
    expect(isEstateEmpty({ inheritance: { beneficiaries: [{ ref: "child:0" }] } })).toBe(false);
    expect(isEstateEmpty({ inheritance: { beneficiaries: [{ ref: "other:0" }] } })).toBe(true);
    expect(isEstateEmpty({ inheritance: { ifPredeceased: "to_survivors" } })).toBe(false);
  });
});

describe("the picklist away from a clock", () => {
  it("names a child without an age when no clock is handed in", () => {
    // The note, the review card and the advisor's diff render names and shares,
    // never ages — so they read this module without a date, and it must stay
    // pure rather than reaching for one of its own.
    expect(estateBeneficiaryOptions(FAMILY, undefined).map((o) => o.detail)).toEqual([
      "Spouse or partner",
      "Child",
      "Child",
    ]);
  });
});
