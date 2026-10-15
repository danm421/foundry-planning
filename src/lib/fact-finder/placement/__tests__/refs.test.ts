// src/lib/fact-finder/placement/__tests__/refs.test.ts
import { describe, expect, it } from "vitest";
import {
  buildRefIndex,
  findAccount,
  findLiability,
  findLifePolicy,
  findPerson,
  findProperty,
  findTrust,
  hasCoClient,
  householdPerson,
  NO_CO_CLIENT_REASON,
  rowRecordRef,
} from "../refs";
import { sharesOf } from "../map/helpers";
import { bookWith, contextOf, hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "./fixtures";

const account = (id: string, name: string, category: string, values: Record<string, string> = {}) =>
  recordOf(id, name, { name, ...values }, { category, subType: null });
const line = (lineId: string, target: string) => ({ ref: "line", target, lineId });
const record = (id: string, target: string) => ({ ref: "record", target, id });

describe("rowRecordRef — the record a live row stands for", () => {
  const book = bookWith({
    account: [account("a-1", "Joint Checking", "cash")],
    business_account: [recordOf("b-1", "Hendricks Design", { name: "Hendricks Design" })],
  });
  const state = stateWith({
    cash: [
      rowOf("linked", { accountName: "Joint Checking" }, { link: linkedTo("a-1") }),
      rowOf("elsewhere", { accountName: "Their Checking" }, { link: linkedTo("a-of-another-client") }),
      rowOf("guess", { accountName: "Savings" }, { link: { kind: "existing", recordId: "a-1", score: 0.7, confirmed: false, by: "auto" } }),
      rowOf("new", { accountName: "Money market" }, { link: { kind: "new", by: "advisor" } }),
      rowOf("auto-new", { accountName: "CD" }, { link: { kind: "new", by: "auto" } }),
      rowOf("unlinked", { accountName: "Emergency fund" }),
    ],
    business: [rowOf("biz", { businessName: "Hendricks Design" }, { link: linkedTo("b-1") })],
  });
  const index = buildRefIndex(state, book);

  it("is the linked record when the link is confirmed and the book has it", () => {
    expect(rowRecordRef(index, "cash", "linked", "account")).toEqual(record("a-1", "account"));
    expect(rowRecordRef(index, "business", "biz", "business_account")).toEqual(record("b-1", "business_account"));
  });

  it("is the line the row creates when it's New or has no link", () => {
    expect(rowRecordRef(index, "cash", "new", "account")).toEqual(line("new/account", "account"));
    expect(rowRecordRef(index, "cash", "auto-new", "account")).toEqual(line("auto-new/account", "account"));
    expect(rowRecordRef(index, "cash", "unlinked", "account")).toEqual(line("unlinked/account", "account"));
  });

  it("gives no record ref for a link to a record that isn't this client's, nor for an unconfirmed guess", () => {
    expect(rowRecordRef(index, "cash", "elsewhere", "account")).toBeNull();
    expect(rowRecordRef(index, "cash", "guess", "account")).toBeNull();
    // Nothing named after such a row resolves to it either.
    expect(findAccount(index, "Their Checking")).toEqual({
      ok: false,
      reason: 'No account named "Their Checking" in this fact finder or on the plan.',
    });
  });

  it("checks the link against the target asked for, and knows only live rows", () => {
    expect(rowRecordRef(index, "business", "biz", "account")).toBeNull();
    expect(rowRecordRef(index, "cash", "no-such-row", "account")).toBeNull();
  });
});

describe("findAccount", () => {
  const book = bookWith({
    account: [
      account("a-chk", "Joint Checking", "cash"),
      account("a-ira", "Fidelity IRA", "retirement", { accountNumberLast4: "2201", custodian: "Fidelity" }),
      account("a-brk", "Brokerage", "taxable"),
      account("a-lake", "Lake House", "real_estate", { propertyAddress: "9 Shore Rd" }),
    ],
    business_account: [recordOf("b-1", "Hendricks Design", { name: "Hendricks Design" })],
  });
  const state = {
    ...stateWith({
      cash: [
        rowOf("c1", { accountName: "Joint Checking", last4: "1234", custodian: "Chase" }, { link: linkedTo("a-chk") }),
        rowOf("c2", { accountName: "Fidelity Cash", last4: "xxxx-1234", custodian: "Fidelity" }),
      ],
      taxable: [rowOf("t1", { accountName: "Brokerage", custodian: "Schwab" }, { link: { kind: "new", by: "advisor" } })],
      retirement: [rowOf("r1", { accountName: "Fidelity", owner: "Client" }), rowOf("r2", { accountName: "Fidelity", owner: "Co-client" })],
      business: [rowOf("b1", { businessName: "Hendricks Design" }, { link: linkedTo("b-1") })],
    }),
    removed: [{ sectionId: "cash", row: rowOf("gone", { accountName: "Old Savings" }), reason: "Closed", by: "advisor" as const, at: "2026-10-01T00:00:00Z" }],
  };
  const index = buildRefIndex(state, book);

  it("matches a whole name, ignoring case, spacing and punctuation", () => {
    expect(findAccount(index, "joint  checking!")).toEqual({ ok: true, ref: record("a-chk", "account"), label: "Joint Checking ··1234" });
  });

  it("a fact finder row beats the record it links to — one hit, not two", () => {
    expect(findAccount(index, "Joint Checking")).toMatchObject({ ok: true, ref: record("a-chk", "account") });
  });

  it("looks at the fact finder's rows before the plan's records", () => {
    expect(findAccount(index, "Brokerage")).toEqual({ ok: true, ref: line("t1/account", "account"), label: "Brokerage" });
    expect(findAccount(index, "Fidelity IRA")).toEqual({ ok: true, ref: record("a-ira", "account"), label: "Fidelity IRA" });
  });

  it("says when nothing matches, or when two things do", () => {
    expect(findAccount(index, "Fidelity 401(k)")).toEqual({
      ok: false,
      reason: 'No account named "Fidelity 401(k)" in this fact finder or on the plan.',
    });
    expect(findAccount(index, "Fidelity")).toEqual({ ok: false, reason: 'Two accounts match "Fidelity" — use the name or last 4.' });
  });

  it("matches by last 4, telling two accounts with the same last 4 apart by the custodian or name", () => {
    expect(findAccount(index, "…2201")).toMatchObject({ ok: true, ref: record("a-ira", "account") });
    expect(findAccount(index, "2201")).toMatchObject({ ok: true, ref: record("a-ira", "account") });
    expect(findAccount(index, "Fidelity …1234")).toMatchObject({ ok: true, ref: line("c2/account", "account") });
    expect(findAccount(index, "Chase xxxx-1234")).toMatchObject({ ok: true, ref: record("a-chk", "account") });
    expect(findAccount(index, "…1234")).toEqual({ ok: false, reason: 'Two accounts match "…1234" — use the name or last 4.' });
  });

  it("a last 4 alone, or with words like \"acct ending\" or the account's own, is enough; words that name another account match nothing", () => {
    expect(findAccount(index, "acct ending 2201")).toMatchObject({ ok: true, ref: record("a-ira", "account") });
    expect(findAccount(index, "Account # xxxx-2201")).toMatchObject({ ok: true, ref: record("a-ira", "account") });
    expect(findAccount(index, "IRA 2201")).toMatchObject({ ok: true, ref: record("a-ira", "account") });
    expect(findAccount(index, "Chase checking 2201")).toEqual({
      ok: false,
      reason: 'No account named "Chase checking 2201" in this fact finder or on the plan.',
    });
  });

  it("finds a business as a business account, and looks only in the sections asked for", () => {
    expect(findAccount(index, "Hendricks Design")).toMatchObject({ ok: true, ref: record("b-1", "business_account") });
    expect(findAccount(index, "Lake House")).toMatchObject({ ok: true, ref: record("a-lake", "account") });
    expect(findAccount(index, "Lake House", { sections: ["realestate"] })).toMatchObject({ ok: true });
    expect(findAccount(index, "Lake House", { sections: ["cash", "taxable"] })).toMatchObject({ ok: false });
  });

  it("never finds a row in the Removed tray", () => {
    expect(findAccount(index, "Old Savings")).toMatchObject({ ok: false });
  });

  it("a last 4 a row and a plan-only account share is two accounts — never a guess for the row", () => {
    const shared = buildRefIndex(
      stateWith({ cash: [rowOf("c1", { accountName: "Checking", last4: "1234" })] }),
      bookWith({ account: [account("a-sav", "Savings", "cash", { accountNumberLast4: "1234" })] }),
    );
    expect(findAccount(shared, "…1234")).toEqual({ ok: false, reason: 'Two accounts match "…1234" — use the name or last 4.' });
    expect(findAccount(shared, "Checking")).toMatchObject({ ok: true, ref: line("c1/account", "account") });
  });

  it("a confirmed row and its own record answering one last 4 are one account", () => {
    const one = buildRefIndex(
      stateWith({ cash: [rowOf("c1", { accountName: "Checking", last4: "1234" }, { link: linkedTo("a-chk") })] }),
      bookWith({ account: [account("a-chk", "Joint Checking", "cash", { accountNumberLast4: "1234" })] }),
    );
    expect(findAccount(one, "…1234")).toEqual({ ok: true, ref: record("a-chk", "account"), label: "Checking ··1234" });
  });
});

describe("findProperty", () => {
  const book = bookWith({
    account: [account("a-cabin", "Cabin", "real_estate", { propertyAddress: "4 Pine Rd" }), account("a-fund", "Main house fund", "cash")],
  });
  const index = buildRefIndex(
    stateWith({
      realestate: [
        rowOf("h1", { propertyName: "Main house", address: "12 Oak Lane" }),
        rowOf("h2", { propertyName: "Rental" }),
        rowOf("h3", { propertyName: "Rental", address: "8 Elm St" }),
      ],
      cash: [rowOf("c1", { accountName: "Cabin" })],
    }),
    book,
  );

  it("matches a property's name or address, in the fact finder or on the plan", () => {
    expect(findProperty(index, "Main house")).toEqual({ ok: true, ref: line("h1/account", "account"), label: "Main house" });
    expect(findProperty(index, "12 oak lane")).toMatchObject({ ok: true, ref: line("h1/account", "account") });
    expect(findProperty(index, "4 Pine Rd")).toMatchObject({ ok: true, ref: record("a-cabin", "account") });
  });

  it("only real estate counts — a cash account of the same name isn't a property", () => {
    expect(findProperty(index, "Cabin")).toMatchObject({ ok: true, ref: record("a-cabin", "account") });
    expect(findProperty(index, "Main house fund")).toMatchObject({ ok: false });
  });

  it("says when nothing matches, or when two things do", () => {
    expect(findProperty(index, "Beach condo")).toEqual({
      ok: false,
      reason: 'No property named "Beach condo" in this fact finder or on the plan.',
    });
    expect(findProperty(index, "Rental")).toEqual({
      ok: false,
      reason: "Two properties match \"Rental\" — use the property's name or address.",
    });
  });
});

describe("findLiability", () => {
  const index = buildRefIndex(
    stateWith({
      liab: [
        rowOf("l1", { loanName: "Mortgage" }, { link: linkedTo("l-home") }),
        rowOf("l2", { loanName: "Car loan" }),
        rowOf("l3", { loanName: "Auto loan", owner: "Client" }),
        rowOf("l4", { loanName: "Auto loan", owner: "Co-client" }),
      ],
    }),
    bookWith({ liability: [recordOf("l-home", "Home mortgage", { name: "Home mortgage" }), recordOf("l-heloc", "HELOC", { name: "HELOC" })] }),
  );

  it("matches a loan in the fact finder (its link, else its line) or on the plan", () => {
    expect(findLiability(index, "Mortgage")).toEqual({ ok: true, ref: record("l-home", "liability"), label: "Mortgage" });
    expect(findLiability(index, "Home mortgage")).toEqual({ ok: true, ref: record("l-home", "liability"), label: "Home mortgage" });
    expect(findLiability(index, "Car loan")).toMatchObject({ ok: true, ref: line("l2/liability", "liability") });
    expect(findLiability(index, "heloc")).toMatchObject({ ok: true, ref: record("l-heloc", "liability") });
  });

  it("says when nothing matches, or when two things do", () => {
    expect(findLiability(index, "Student loan")).toEqual({
      ok: false,
      reason: 'No loan named "Student loan" in this fact finder or on the plan.',
    });
    expect(findLiability(index, "Auto loan")).toEqual({ ok: false, reason: "Two loans match \"Auto loan\" — use the loan's full name." });
  });
});

describe("findLifePolicy", () => {
  const index = buildRefIndex(
    stateWith({
      life: [
        rowOf("p1", { policyName: "NWM Whole Life", carrier: "Northwestern Mutual", policyNumber: "NW-0045678" }),
        rowOf("p2", { policyName: "Term 20", carrier: "Banner", policyNumber: "B5678" }),
      ],
    }),
    bookWith({
      life_insurance_policy: [recordOf("lp-1", "Prudential ··9012", { name: "Pru UL", carrier: "Prudential", policyNumberLast4: "9012" })],
    }),
  );

  it("matches a policy's name, or its carrier and last 4", () => {
    expect(findLifePolicy(index, "NWM Whole Life")).toEqual({
      ok: true,
      ref: line("p1/life_insurance_policy", "life_insurance_policy"),
      label: "NWM Whole Life",
    });
    expect(findLifePolicy(index, "Northwestern Mutual ··5678")).toMatchObject({ ok: true, ref: line("p1/life_insurance_policy", "life_insurance_policy") });
    expect(findLifePolicy(index, "Banner 5678")).toMatchObject({ ok: true, ref: line("p2/life_insurance_policy", "life_insurance_policy") });
    expect(findLifePolicy(index, "…9012")).toEqual({ ok: true, ref: record("lp-1", "life_insurance_policy"), label: "Prudential ··9012" });
    expect(findLifePolicy(index, "Pru UL")).toMatchObject({ ok: true, ref: record("lp-1", "life_insurance_policy") });
  });

  it("says when nothing matches, or when two things do", () => {
    expect(findLifePolicy(index, "MoneyGuard")).toEqual({
      ok: false,
      reason: 'No life policy named "MoneyGuard" in this fact finder or on the plan.',
    });
    expect(findLifePolicy(index, "5678")).toEqual({
      ok: false,
      reason: 'Two life policies match "5678" — use the policy name, or the carrier and last 4.',
    });
  });
});

describe("findTrust", () => {
  const index = buildRefIndex(
    stateWith({
      trusts: [
        rowOf("tr1", { trustName: "Hendricks ILIT", trustType: "ILIT" }),
        rowOf("tr2", { trustName: "Hendricks Living Trust", trustType: "Revocable living trust" }),
        rowOf("tr3", { trustName: "Dynasty Trust", grantor: "Client" }),
        rowOf("tr4", { trustName: "Dynasty Trust", grantor: "Co-client" }),
      ],
    }),
    bookWith({
      entity: [recordOf("e-1", "Smith Family Trust", { name: "Smith Family Trust" }, { trustSubType: "irrevocable" })],
      revocable_trust: [recordOf("rt-1", "Mark's Revocable Trust", { name: "Mark's Revocable Trust" })],
    }),
  );

  it("matches a trust in the fact finder or on the plan", () => {
    expect(findTrust(index, "Hendricks ILIT")).toEqual({ ok: true, ref: line("tr1/entity", "entity"), label: "Hendricks ILIT" });
    expect(findTrust(index, "Smith Family Trust")).toMatchObject({ ok: true, ref: record("e-1", "entity") });
  });

  it("names a revocable living trust as one, in the fact finder or on the plan — it can't own or receive here", () => {
    expect(findTrust(index, "Hendricks Living Trust")).toEqual({
      ok: false,
      reason: '"Hendricks Living Trust" is a revocable living trust, which can\'t be named here.',
    });
    expect(findTrust(index, "Mark's Revocable Trust")).toMatchObject({ ok: false, reason: expect.stringContaining("revocable living trust") });
  });

  it("says when nothing matches, or when two things do", () => {
    expect(findTrust(index, "Lake Trust")).toEqual({
      ok: false,
      reason: 'No trust or entity named "Lake Trust" in this fact finder or on the plan.',
    });
    expect(findTrust(index, "Dynasty Trust")).toEqual({ ok: false, reason: "Two trusts match \"Dynasty Trust\" — use the trust's full name." });
  });
});

describe("findPerson", () => {
  const everyone = ["household", "family", "external", "trust"] as const;
  const state = stateWith({
    people: [rowOf("people:Client", { firstName: "Mark", lastName: "Hendricks" }), rowOf("people:Co-client", {})],
    family: [
      rowOf("f1", { firstName: "Emma", lastName: "Hendricks" }),
      rowOf("f2", { firstName: "Lucas", lastName: "Hendricks" }, { link: linkedTo("fm-lucas") }),
    ],
    external: [rowOf("x1", { name: "Denver Rescue Mission", kind: "Charity" })],
    trusts: [
      rowOf("tr1", { trustName: "Hendricks ILIT", trustType: "ILIT" }),
      rowOf("tr2", { trustName: "Hendricks Living Trust", trustType: "Revocable living trust" }),
    ],
  });
  const book = hendricksBook({
    family_member: [
      recordOf("fm-lucas", "Lucas Hendricks", { firstName: "Lucas", lastName: "Hendricks" }),
      recordOf("fm-ava", "Ava Stone", { firstName: "Ava", lastName: "Stone" }),
    ],
    external_beneficiary: [recordOf("x-red", "American Red Cross", { name: "American Red Cross" })],
  });
  const index = buildRefIndex(state, book);
  const find = (text: string, allow: readonly ("household" | "family" | "external" | "trust")[] = everyone) => findPerson(index, text, { allow });

  it("reads Client and Co-client, and the client's and co-client's first or full names", () => {
    expect(find("Client")).toEqual({ ok: true, ref: { ref: "person", role: "client" }, label: "Mark Hendricks" });
    expect(find("co-client")).toEqual({ ok: true, ref: { ref: "person", role: "spouse" }, label: "Laura Hendricks" });
    expect(find("Mark")).toMatchObject({ ok: true, ref: { ref: "person", role: "client" } });
    expect(find("mark hendricks")).toMatchObject({ ok: true, ref: { ref: "person", role: "client" } });
    // The Co-client row is blank, so the co-client's names come from the plan.
    expect(find("Laura")).toMatchObject({ ok: true, ref: { ref: "person", role: "spouse" } });
    expect(find("Laura Hendricks")).toMatchObject({ ok: true, ref: { ref: "person", role: "spouse" } });
  });

  it("matches family by full name or a first name no one else has, fact finder rows first", () => {
    expect(find("Emma Hendricks")).toEqual({ ok: true, ref: line("f1/family_member", "family_member"), label: "Emma Hendricks" });
    expect(find("Emma")).toMatchObject({ ok: true, ref: line("f1/family_member", "family_member") });
    expect(find("Lucas")).toEqual({ ok: true, ref: record("fm-lucas", "family_member"), label: "Lucas Hendricks" });
    expect(find("Ava")).toEqual({ ok: true, ref: record("fm-ava", "family_member"), label: "Ava Stone" });
  });

  it("matches charities and trusts by name", () => {
    expect(find("Denver Rescue Mission")).toMatchObject({ ok: true, ref: line("x1/external_beneficiary", "external_beneficiary") });
    expect(find("American Red Cross")).toMatchObject({ ok: true, ref: record("x-red", "external_beneficiary") });
    expect(find("Hendricks ILIT")).toMatchObject({ ok: true, ref: line("tr1/entity", "entity") });
    expect(find("Hendricks Living Trust")).toEqual({
      ok: false,
      reason: '"Hendricks Living Trust" is a revocable living trust, which can\'t be named here.',
    });
  });

  it("looks only where it's allowed — never at the client or co-client unless household is allowed", () => {
    expect(find("Laura", ["family", "external", "trust"])).toEqual({
      ok: false,
      reason: '"Laura" is the co-client, who can\'t be named here.',
    });
    expect(find("Client", ["family", "trust"])).toEqual({ ok: false, reason: "The client can't be named here." });
    expect(find("Lucas", ["family"])).toMatchObject({ ok: true, ref: record("fm-lucas", "family_member") });
    expect(find("Denver Rescue Mission", ["household", "family"])).toMatchObject({ ok: false });
    expect(find("Hendricks ILIT", ["household", "family", "external"])).toEqual({
      ok: false,
      reason: 'No one named "Hendricks ILIT" in this fact finder or on the plan.',
    });
  });

  it("says when a first name is shared, or nobody matches", () => {
    const twoEmmas = buildRefIndex(
      stateWith({ family: [rowOf("f1", { firstName: "Emma", lastName: "Hendricks" }), rowOf("f3", { firstName: "Emma", lastName: "Stone" })] }),
      hendricksBook(),
    );
    expect(findPerson(twoEmmas, "Emma", { allow: everyone })).toEqual({ ok: false, reason: 'Two people match "Emma" — use the full name.' });
    expect(findPerson(twoEmmas, "Emma Stone", { allow: everyone })).toMatchObject({ ok: true, ref: line("f3/family_member", "family_member") });
    expect(find("Uncle Bob")).toEqual({ ok: false, reason: 'No one named "Uncle Bob" in this fact finder or on the plan.' });
  });

  it("a first name a row and a plan-only record share is two people — never a guess for the row", () => {
    const shared = buildRefIndex(
      stateWith({
        family: [
          rowOf("f1", { firstName: "Emma", lastName: "Hendricks" }),
          rowOf("f2", { firstName: "Lucas", lastName: "Hendricks" }, { link: linkedTo("fm-lucas") }),
        ],
      }),
      hendricksBook({
        family_member: [
          recordOf("fm-lucas", "Lucas Hendricks", { firstName: "Lucas", lastName: "Hendricks" }),
          recordOf("fm-emma-stone", "Emma Stone", { firstName: "Emma", lastName: "Stone" }),
        ],
      }),
    );
    const AMBIGUOUS = { ok: false, reason: 'Two people match "Emma" — use the full name.' };
    expect(findPerson(shared, "Emma", { allow: everyone })).toEqual(AMBIGUOUS);
    // "Emma 100%" as a beneficiary reads its name the same way.
    const { ctx } = contextOf(shared.state, shared.book);
    expect(sharesOf("Emma 100%", ctx, everyone)).toEqual(AMBIGUOUS);
    // A whole name still decides, the fact finder's row first.
    expect(findPerson(shared, "Emma Hendricks", { allow: everyone })).toMatchObject({ ok: true, ref: line("f1/family_member", "family_member") });
    expect(findPerson(shared, "Emma Stone", { allow: everyone })).toMatchObject({ ok: true, ref: record("fm-emma-stone", "family_member") });
    // A confirmed row and the record it links to are one person.
    expect(findPerson(shared, "Lucas", { allow: everyone })).toEqual({ ok: true, ref: record("fm-lucas", "family_member"), label: "Lucas Hendricks" });
  });

  it("has no co-client until the plan or the fact finder names one", () => {
    const single = buildRefIndex(stateWith({}), bookWith({}, { people: { client: "fm-client", spouse: null }, names: { client: "Mark", spouse: null } }));
    expect(hasCoClient(single)).toBe(false);
    expect(findPerson(single, "Co-client", { allow: everyone })).toEqual({ ok: false, reason: NO_CO_CLIENT_REASON });
    expect(householdPerson("spouse")).toEqual({ ref: "person", role: "spouse" });

    const namedHere = buildRefIndex(stateWith({ people: [rowOf("people:Client", {}), rowOf("people:Co-client", { firstName: "Laura" })] }), bookWith({}));
    expect(hasCoClient(namedHere)).toBe(true);
    expect(findPerson(namedHere, "Laura", { allow: everyone })).toEqual({ ok: true, ref: { ref: "person", role: "spouse" }, label: "Laura" });
    expect(hasCoClient(index)).toBe(true);
  });
});
