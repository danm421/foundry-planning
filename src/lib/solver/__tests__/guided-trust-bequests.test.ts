import { describe, it, expect } from "vitest";
import type { Account, ClientData, Will, WillBequest } from "@/engine/types";
import type { FundingItem } from "../guided-trust";
import { bequestableAccounts, buildBequestMutations, willConflictNote } from "../guided-trust-bequests";

type BequestItem = Extract<FundingItem, { kind: "bequest" }>;

const TRUST = { id: "trust-new", name: "Smith Irrevocable Trust" };

function account(id: string, name: string, over: Partial<Account> = {}): Account {
  return {
    id, name, category: "taxable",
    owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
    ...over,
  } as unknown as Account;
}

function tree(over: Partial<ClientData> & { married?: boolean } = {}): ClientData {
  const { married = true, ...rest } = over;
  return {
    client: {
      firstName: "Dan", lastName: "Smith", dateOfBirth: "1970-05-01",
      ...(married ? { spouseName: "Jane", spouseDob: "1972-03-02" } : {}),
    },
    accounts: [account("acct-brk", "Schwab Brokerage"), account("acct-home", "Home")],
    planSettings: { planStartYear: 2026 },
    familyMembers: [
      { id: "fm-c", role: "client", relationship: "other", firstName: "Dan", lastName: "Smith" },
      ...(married
        ? [{ id: "fm-s", role: "spouse", relationship: "other", firstName: "Jane", lastName: "Smith" }]
        : []),
      { id: "fm-1", role: "child", relationship: "child", firstName: "Kid", lastName: "Smith" },
    ],
    externalBeneficiaries: [{ id: "ex-1", name: "Red Cross", kind: "charity", charityType: "public" }],
    entities: [{ id: "ent-old", name: "Old Family Trust", entityType: "trust" }],
    wills: [],
    ...rest,
  } as unknown as ClientData;
}

const toKid = [{ recipientKind: "family_member" as const, recipientId: "fm-1", percentage: 100, sortOrder: 0 }];
const toSpouse = [{ recipientKind: "spouse" as const, recipientId: null, percentage: 100, sortOrder: 0 }];
const spouseAndKid = [
  { recipientKind: "spouse" as const, recipientId: null, percentage: 50, sortOrder: 0 },
  { recipientKind: "family_member" as const, recipientId: "fm-1", percentage: 50, sortOrder: 1 },
];

function clause(over: Partial<WillBequest>): WillBequest {
  return {
    id: "b-old", name: "Estate (what's left at this point)", kind: "asset", assetMode: "all_assets",
    accountId: null, entityId: null, liabilityId: null, percentage: 100,
    condition: "always", sortOrder: 0, recipients: toKid,
    ...over,
  };
}

function will(grantor: "client" | "spouse", over: Partial<Will> = {}): Will {
  return { id: `will-${grantor}`, grantor, bequests: [], ...over };
}

const everything = (
  from: BequestItem["from"],
  condition: WillBequest["condition"] = "if_spouse_survives",
): BequestItem => ({ kind: "bequest", from, what: { mode: "all_assets" }, condition });

const oneAccount = (
  accountId: string,
  percentage: number,
  condition: WillBequest["condition"] = "if_spouse_survives",
): BequestItem => ({
  kind: "bequest", from: "client", what: { mode: "specific", accountId, percentage }, condition,
});

function ids() {
  let n = 0;
  return () => `id-${++n}`;
}

const toTrust = [{ recipientKind: "entity", recipientId: TRUST.id, percentage: 100, sortOrder: 0 }];

describe("buildBequestMutations", () => {
  it("creates the grantor's will when there is none — no residuary key", () => {
    const muts = buildBequestMutations([everything("client")], TRUST, tree(), ids());
    expect(muts).toEqual([
      {
        kind: "will-upsert",
        id: "id-1",
        value: {
          id: "id-1",
          grantor: "client",
          bequests: [
            {
              id: "id-2", name: "Estate (what's left at this point)", kind: "asset", assetMode: "all_assets",
              accountId: null, entityId: null, liabilityId: null, percentage: 100,
              condition: "if_spouse_survives", sortOrder: 0, recipients: toTrust,
            },
          ],
        },
      },
    ]);
    const value = (muts[0] as { value: Will }).value;
    expect("residuaryRecipients" in value).toBe(false);
  });

  it("keeps a dollar gift and its position when it appends a bequest", () => {
    const dollar: WillBequest = {
      id: "b-dollar", name: "Grandchildren", kind: "dollar", dollarSource: "estate", fallbackToEstate: false,
      assetMode: null, accountId: null, entityId: null, liabilityId: null, percentage: 100,
      condition: "always", sortOrder: 0,
      recipients: [
        { recipientKind: "family_member", recipientId: "fm-1", percentage: 0, amount: 20000, sortOrder: 0 },
        { recipientKind: "family_member", recipientId: "fm-1", percentage: 0, amount: 20000, sortOrder: 1 },
      ],
    };
    const pct = clause({ id: "b-pct", assetMode: "specific", accountId: "acct-home", name: "Home", sortOrder: 1 });
    const t = tree({ wills: [will("client", { bequests: [dollar, pct] })] });
    const muts = buildBequestMutations([oneAccount("acct-brk", 40)], TRUST, t, ids());
    const value = (muts[0] as { value: Will }).value;
    expect(value.bequests[0]).toEqual(dollar);
    expect(value.bequests[0]).toMatchObject({
      kind: "dollar", dollarSource: "estate", sortOrder: 0,
      recipients: [{ amount: 20000 }, { amount: 20000 }],
    });
    expect(value.bequests[2].sortOrder).toBe(2);
  });

  it("appends to an existing will, keeping its other bequests and residuary heirs", () => {
    const existing = will("client", {
      bequests: [clause({ id: "b-home", assetMode: "specific", accountId: "acct-home", name: "Home", sortOrder: 3 })],
      residuaryRecipients: [{ recipientKind: "family_member", recipientId: "fm-1", percentage: 100, sortOrder: 0 }],
    });
    const t = tree({ wills: [existing] });
    const muts = buildBequestMutations([oneAccount("acct-brk", 40)], TRUST, t, ids());
    expect(muts).toHaveLength(1);
    expect(muts[0]).toMatchObject({ kind: "will-upsert", id: "will-client" });
    const value = (muts[0] as { value: Will }).value;
    expect(value.residuaryRecipients).toEqual(existing.residuaryRecipients);
    expect(value.bequests[0]).toEqual(existing.bequests[0]);
    expect(value.bequests[1]).toEqual({
      id: "id-1", name: "Schwab Brokerage", kind: "asset", assetMode: "specific",
      accountId: "acct-brk", entityId: null, liabilityId: null, percentage: 40,
      condition: "if_spouse_survives", sortOrder: 4, recipients: toTrust,
    });
  });

  it("leaves the residuary key absent on an existing will that has none", () => {
    const t = tree({ wills: [will("client")] });
    const [m] = buildBequestMutations([everything("client")], TRUST, t, ids());
    expect("residuaryRecipients" in (m as { value: Will }).value).toBe(false);
  });

  it("a second-death bequest goes in both wills, only if the other spouse died first", () => {
    const t = tree({ wills: [will("spouse", { bequests: [clause({ sortOrder: 0 })] })] });
    const muts = buildBequestMutations([everything("second_death", "always")], TRUST, t, ids());
    expect(muts).toHaveLength(2);
    const byGrantor = Object.fromEntries(
      muts.map((m) => [(m as { value: Will }).value.grantor, (m as { value: Will }).value]),
    );
    expect(byGrantor.client.bequests).toHaveLength(1);
    expect(byGrantor.client.bequests[0].condition).toBe("if_spouse_predeceased");
    expect(byGrantor.spouse.id).toBe("will-spouse");
    expect(byGrantor.spouse.bequests).toHaveLength(2);
    expect(byGrantor.spouse.bequests[1]).toMatchObject({
      condition: "if_spouse_predeceased", sortOrder: 1, recipients: toTrust,
    });
    // Each will gets its own bequest row.
    expect(byGrantor.client.bequests[0].id).not.toBe(byGrantor.spouse.bequests[1].id);
  });

  it("merges every item aimed at one will into ONE upsert", () => {
    const t = tree({ wills: [will("client")] });
    const muts = buildBequestMutations(
      [oneAccount("acct-brk", 50), everything("second_death"), oneAccount("acct-home", 100, "always")],
      TRUST, t, ids(),
    );
    expect(muts).toHaveLength(2);
    const client = muts.find((m) => m.kind === "will-upsert" && m.id === "will-client") as { value: Will };
    expect(client.value.bequests.map((b) => [b.name, b.condition, b.sortOrder])).toEqual([
      ["Schwab Brokerage", "if_spouse_survives", 0],
      ["Estate (what's left at this point)", "if_spouse_predeceased", 1],
      ["Home", "always", 2],
    ]);
  });

  it("an unmarried client's bequest is written as 'always'", () => {
    const t = tree({ married: false });
    const [m] = buildBequestMutations([everything("client", "always")], TRUST, t, ids());
    const value = (m as { value: Will }).value;
    expect(value.grantor).toBe("client");
    expect(value.bequests[0].condition).toBe("always");
  });
});

describe("willConflictNote", () => {
  const ABOVE = "Gifts listed above this one in Dan's will are paid first";
  const dollar = (over: Partial<WillBequest> = {}): WillBequest =>
    clause({
      id: "b-dollar", name: "Grandchildren", kind: "dollar", dollarSource: "estate", fallbackToEstate: false,
      assetMode: null, percentage: 100,
      recipients: [{ recipientKind: "family_member", recipientId: "fm-1", percentage: 0, amount: 20000, sortOrder: 0 }],
      ...over,
    });

  it("is null when the will has nothing in the way", () => {
    expect(willConflictNote(everything("client"), tree())).toBeNull();
    const t = tree({ wills: [will("client", { bequests: [clause({ assetMode: "specific", accountId: "acct-home" })] })] });
    expect(willConflictNote(oneAccount("acct-brk", 100), t)).toBeNull();
  });

  describe("one account", () => {
    const brk = (percentage: number, over: Partial<WillBequest> = {}) =>
      clause({ assetMode: "specific", accountId: "acct-brk", name: "Schwab Brokerage", percentage, ...over });
    const spec = (b: WillBequest[]) => tree({ wills: [will("client", { bequests: b })] });
    const note = (pct: number) =>
      `${ABOVE}, so this trust gets ${pct}% of what's left of Schwab Brokerage.`;

    it("notes a specific gift of the same account above it", () => {
      expect(willConflictNote(oneAccount("acct-brk", 50), spec([brk(60)]))).toBe(note(50));
    });

    it("notes an estate-percentage gift above it", () => {
      expect(willConflictNote(oneAccount("acct-brk", 100), spec([clause({})]))).toBe(note(100));
    });

    it("notes a dollar gift above a specific cash bequest", () => {
      const cash = tree({
        accounts: [account("acct-brk", "Schwab Brokerage", { category: "cash" } as Partial<Account>)],
        wills: [will("client", { bequests: [dollar()] })],
      });
      expect(willConflictNote(oneAccount("acct-brk", 100), cash)).toBe(note(100));
      expect(willConflictNote(oneAccount("acct-brk", 30), spec([dollar()]))).toBe(note(30));
    });

    it("a dollar gift estate-wide does not touch a non-cash account", () => {
      const home = tree({
        accounts: [account("acct-home", "Home", { category: "real_estate" } as Partial<Account>)],
        wills: [will("client", { bequests: [dollar()] })],
      });
      expect(willConflictNote(oneAccount("acct-home", 100), home)).toBeNull();
    });

    it("notes a dollar gift that names the account, and one that may fall back to the estate", () => {
      const named = dollar({ dollarSource: "account", accountId: "acct-home" });
      expect(willConflictNote(oneAccount("acct-home", 100), spec([named]))).toBe(
        `${ABOVE}, so this trust gets 100% of what's left of Home.`,
      );
      expect(willConflictNote(oneAccount("acct-brk", 100), spec([named]))).toBeNull();
      const fallback = dollar({ dollarSource: "account", accountId: "acct-home", fallbackToEstate: true });
      expect(willConflictNote(oneAccount("acct-brk", 100), spec([fallback]))).toBe(note(100));
    });

    it("no note when nothing above draws on the account", () => {
      const home = clause({ assetMode: "specific", accountId: "acct-home", name: "Home" });
      expect(willConflictNote(oneAccount("acct-brk", 100), spec([home]))).toBeNull();
      const liab = clause({ kind: "liability", assetMode: null, liabilityId: "l-1" });
      expect(willConflictNote(oneAccount("acct-brk", 100), spec([liab]))).toBeNull();
    });

    it("ignores gifts that fire at a different death", () => {
      const later = brk(60, { condition: "if_spouse_predeceased" });
      expect(willConflictNote(oneAccount("acct-brk", 50, "if_spouse_survives"), spec([later]))).toBeNull();
      expect(willConflictNote(oneAccount("acct-brk", 50, "if_spouse_predeceased"), spec([later]))).toBe(note(50));
    });
  });

  describe("everything", () => {
    const AFTER = `${ABOVE}; this trust gets everything left after them`;
    const residuary = [
      { recipientKind: "family_member" as const, recipientId: "fm-1", percentage: 50, sortOrder: 0 },
      { recipientKind: "external_beneficiary" as const, recipientId: "ex-1", percentage: 50, sortOrder: 1 },
    ];

    it("notes the gifts above it", () => {
      const t = tree({ wills: [will("client", { bequests: [clause({})] })] });
      expect(willConflictNote(everything("client"), t)).toBe(`${AFTER}.`);
      const d = tree({ wills: [will("client", { bequests: [dollar()] })] });
      expect(willConflictNote(everything("client"), d)).toBe(`${AFTER}.`);
    });

    it("everything mode names residuary heirs who get nothing", () => {
      const t = tree({ wills: [will("client", { residuaryRecipients: residuary })] });
      expect(willConflictNote(everything("client"), t)).toBe(
        "This trust gets everything left, so Dan's residuary heirs (Kid and Red Cross) get nothing at that death.",
      );
      const above = tree({ wills: [will("client", { bequests: [clause({})], residuaryRecipients: residuary })] });
      expect(willConflictNote(everything("client"), above)).toBe(
        `${AFTER}, so Dan's residuary heirs (Kid and Red Cross) get nothing at that death.`,
      );
    });

    it("a partly-claimed account no longer saves the residuary — the last gift sweeps it", () => {
      const partial = clause({ assetMode: "specific", accountId: "acct-home", percentage: 60 });
      const t = tree({ wills: [will("client", { bequests: [partial], residuaryRecipients: residuary })] });
      expect(willConflictNote(everything("client"), t)).toMatch(/residuary heirs \(Kid and Red Cross\) get nothing/);
    });

    it("reads the tier that governs that death (first = primary, final = contingent)", () => {
      const contingent = [
        { recipientKind: "other_heirs" as const, recipientId: null, tier: "contingent" as const, percentage: 100, sortOrder: 0 },
      ];
      const t = tree({ wills: [will("client", { residuaryRecipients: [...residuary, ...contingent] })] });
      expect(willConflictNote(everything("client", "if_spouse_predeceased"), t)).toMatch(/residuary heirs \(other heirs\)/);
      const primaryOnly = tree({ wills: [will("client", { residuaryRecipients: residuary })] });
      expect(willConflictNote(everything("client", "if_spouse_predeceased"), primaryOnly)).toBeNull();
    });

    it("an unmarried client's final death reads the primary tier", () => {
      const t = tree({ married: false, wills: [will("client", { residuaryRecipients: residuary })] });
      expect(willConflictNote(everything("client", "always"), t)).toMatch(/residuary heirs \(Kid and Red Cross\)/);
    });

    it("never names a residuary heir who has died", () => {
      const contingent = (rs: typeof spouseAndKid) => rs.map((r) => ({ ...r, tier: "contingent" as const }));
      const both = tree({ wills: [will("client", { residuaryRecipients: contingent(spouseAndKid) })] });
      expect(willConflictNote(everything("client", "if_spouse_predeceased"), both)).toMatch(/residuary heirs \(Kid\)/);
      const spouseOnly = tree({ wills: [will("client", { residuaryRecipients: contingent(toSpouse) })] });
      expect(willConflictNote(everything("client", "if_spouse_predeceased"), spouseOnly)).toBeNull();
    });

    it("leaves the residuary out when the grantor holds a business the will doesn't name", () => {
      const biz = account("acct-biz", "Smith LLC", { category: "business" });
      const t = tree({
        accounts: [account("acct-brk", "Schwab Brokerage"), biz],
        wills: [will("client", { residuaryRecipients: residuary })],
      });
      expect(willConflictNote(everything("client"), t)).toBeNull();
      const named = clause({ assetMode: "specific", entityId: "acct-biz", name: "Smith LLC" });
      const t2 = tree({
        accounts: [account("acct-brk", "Schwab Brokerage"), biz],
        wills: [will("client", { bequests: [named], residuaryRecipients: residuary })],
      });
      expect(willConflictNote(everything("client"), t2)).toMatch(/residuary heirs/);
    });

    it("stays quiet when the gifts above fire at a different death", () => {
      const t = tree({ wills: [will("client", { bequests: [clause({ condition: "if_spouse_predeceased" })] })] });
      expect(willConflictNote(everything("client", "if_spouse_survives"), t)).toBeNull();
    });

    it("for an unmarried client, a spouse-survives clause never fires — nothing above", () => {
      const t = tree({
        married: false,
        wills: [will("client", { bequests: [clause({ condition: "if_spouse_survives" })] })],
      });
      expect(willConflictNote(everything("client", "always"), t)).toBeNull();
    });
  });

  it("a second-death bequest checks both wills and returns the first note", () => {
    const t = tree({
      wills: [
        will("client"),
        will("spouse", { bequests: [clause({ condition: "if_spouse_predeceased" })] }),
      ],
    });
    expect(willConflictNote(everything("second_death", "always"), t)).toBe(
      "Gifts listed above this one in Jane's will are paid first; this trust gets everything left after them.",
    );
  });
});

describe("bequestableAccounts", () => {
  const own = (fmId: string, percent = 1) => ({ kind: "family_member", familyMemberId: fmId, percent });
  const t = tree({
    accounts: [
      account("dan", "Dan Brokerage"),
      account("jane", "Jane Savings", { owners: [own("fm-s")] } as Partial<Account>),
      account("joint", "Joint Checking", { category: "cash", owners: [own("fm-c", 0.5), own("fm-s", 0.5)] } as Partial<Account>),
      account("ira", "Dan IRA", { category: "retirement" }),
      account("pol", "Dan Term Life", { category: "life_insurance" }),
      account("biz", "Dan LLC", { category: "business" }),
      account("held", "Trust Cash", { owners: [{ kind: "entity", entityId: "ent-old", percent: 1 }] } as Partial<Account>),
      account("half", "Half Gifted", {
        owners: [own("fm-c", 0.5), { kind: "gifted_away", recipient: { kind: "entity", id: "ent-old" }, percent: 0.5 }],
      } as Partial<Account>),
      account("later", "Gifted Later"),
      account("moved", "Moved In"),
    ],
    giftEvents: [
      { kind: "asset", year: 2030, accountId: "later", percent: 1, grantor: "client", recipientEntityId: "ent-old" },
    ],
  } as Partial<ClientData>);
  const names = (from: BequestItem["from"], excluded: string[] = []) =>
    bequestableAccounts(t, from, new Set(excluded)).map((a) => a.id);

  it("a will offers only what that person owns, alone or jointly — never a beneficiary-designation, business or trust-held account", () => {
    expect(names("client")).toEqual(["dan", "joint", "moved"]);
    expect(names("spouse")).toEqual(["jane", "joint"]);
  });
  it("whoever dies second can leave either spouse's accounts or a joint one", () => {
    expect(names("second_death")).toEqual(["dan", "jane", "joint", "moved"]);
  });
  it("skips accounts this trust is already being funded with", () => {
    expect(names("client", ["moved", "joint"])).toEqual(["dan"]);
  });
});
