// src/lib/fact-finder/placement/map/__tests__/accounts-other.test.ts
import { describe, expect, it } from "vitest";
import { findSection } from "../../../schema";
import { bookWith, contextOf, hendricksBook, linkedTo, recordOf, rowOf, stateWith } from "../../__tests__/fixtures";
import { NO_CO_CLIENT_REASON } from "../../refs";
import type { RecordBook } from "../../types";
import { ANNUITY_INCOME_WARNING, ANNUITY_MAP, EQUITY_MAP, NOTES_REC_MAP } from "../accounts-other";
import type { SectionMap } from "../types";
import type { FFRow } from "../../../types";

const client = { ref: "person", role: "client" } as const;
const spouse = { ref: "person", role: "spouse" } as const;
const at = (sectionId: string, rowId: string, columnId: string) => ({ sectionId, rowId, columnId });

/** `removed`: "rowId:columnId" cells the runner took out (they didn't read). */
function place(
  map: SectionMap, rows: FFRow[], book: RecordBook = hendricksBook(), extra: Record<string, FFRow[]> = {}, asOf: string | null = null, removed: string[] = [],
) {
  const { ctx, notices } = contextOf(stateWith({ [map.sectionId]: rows, ...extra }), book, { asOf });
  return { drafts: map.place(rows, { ...ctx, removed: (rowId, columnId) => removed.includes(`${rowId}:${columnId}`) }), notices };
}
const keys = (draft: { fields: { key: string }[] }) => draft.fields.map((f) => f.key);
const valueOf = (draft: { fields: { key: string; value: unknown }[] }, key: string) => draft.fields.find((f) => f.key === key)?.value;

describe("placements", () => {
  it.each([ANNUITY_MAP, EQUITY_MAP, NOTES_REC_MAP])("$sectionId places every column exactly once", (map) => {
    expect(Object.keys(map.placements).sort()).toEqual(findSection(map.sectionId)!.columns.map((c) => c.id).sort());
  });

  it("an annuity's cost basis goes to its contract, never to the account's basis", () => {
    expect(ANNUITY_MAP.placements.costBasis).toEqual({ to: "annuity_contract.costBasis" });
    expect(Object.values(ANNUITY_MAP.placements)).not.toContainEqual({ to: "account.basis" });
  });
});

describe("ANNUITY_MAP", () => {
  it("a new annuity with a blank Owner: blocked when there's a co-client; else the client's alone", () => {
    const row = rowOf("an1", { contractName: "Lincoln Fixed Annuity" });
    expect(place(ANNUITY_MAP, [row]).drafts[0].blocked).toEqual({ reason: "Owner: pick who owns it.", cell: at("annuity", "an1", "owner") });
    const [single] = place(ANNUITY_MAP, [row], bookWith({}, { people: { client: "fm-client", spouse: null } })).drafts;
    expect([single.blocked, valueOf(single, "owners")]).toEqual([undefined, [{ who: client, percent: 1 }]]);
  });

  it("an annuity the plan holds through a business keeps the business's ownership", () => {
    const BUSINESS = { category: "business", subType: "llc", parentAccountId: null, isDefaultChecking: false };
    const ANNUITY = { category: "annuity", subType: "non_qualified", parentAccountId: "b-acme", isDefaultChecking: false };
    const book = hendricksBook({
      business_account: [recordOf("b-acme", "Acme LLC", { name: "Acme LLC" }, BUSINESS)],
      account: [recordOf("a-ann", "Lincoln Fixed Annuity", { name: "Lincoln Fixed Annuity" }, ANNUITY)],
    });
    const row = rowOf("an1", { contractName: "Lincoln Fixed Annuity", owner: "Client", cashValue: 182000 }, { link: linkedTo("a-ann") });
    const [account] = place(ANNUITY_MAP, [row], book).drafts;
    expect(account.blocked).toBeUndefined();
    expect(keys(account)).not.toContain("owners");
    expect(account.warnings).toContain("This annuity is owned through Acme LLC.");
  });

  const full = rowOf("an1", {
    contractName: "Lincoln Fixed Annuity",
    cashValue: 182000,
    costBasis: 150000,
    last4: "xx-7781",
    owner: "Client",
    carrier: "Lincoln Financial",
    taxTreatment: "Non-qualified",
    productType: "Fixed indexed",
    income: "None",
    payoutStructure: "Joint & survivor",
  });

  it("a new annuity is an account and its contract, the contract hanging off the account's line", () => {
    const { drafts } = place(ANNUITY_MAP, [full]);
    const cell = (columnId: string) => [at("annuity", "an1", columnId)];
    expect(drafts).toEqual([
      {
        lineId: "an1/account",
        sectionId: "annuity",
        rowId: "an1",
        target: "account",
        recordId: null,
        label: "Lincoln Fixed Annuity ··7781",
        fixed: { category: "annuity" },
        fields: [
          { key: "name", value: "Lincoln Fixed Annuity", from: cell("contractName") },
          { key: "value", value: 182000, from: cell("cashValue") },
          { key: "accountNumberLast4", value: "7781", from: cell("last4") },
          { key: "custodian", value: "Lincoln Financial", from: cell("carrier") },
          { key: "subType", value: "non_qualified", from: cell("taxTreatment") },
          { key: "owners", value: [{ who: client, percent: 1 }], from: cell("owner") },
        ],
        warnings: [],
      },
      {
        lineId: "an1/annuity_contract",
        sectionId: "annuity",
        rowId: "an1",
        target: "annuity_contract",
        recordId: null,
        label: "Lincoln Fixed Annuity ··7781 — contract",
        fields: [
          { key: "costBasis", value: 150000, from: cell("costBasis") },
          { key: "productType", value: "fixed_indexed", from: cell("productType") },
          { key: "incomeMode", value: "none", from: cell("income") },
          { key: "payoutStructure", value: "joint_survivor", from: cell("payoutStructure") },
        ],
        warnings: [],
        parent: { ref: "line", target: "account", lineId: "an1/account" },
        dependsOn: ["an1/account"],
      },
    ]);
  });

  it("a blank cost basis makes no field (a 0 would make the whole contract taxable); no contract values, no contract line", () => {
    const { drafts } = place(ANNUITY_MAP, [rowOf("an1", { contractName: "Lincoln", cashValue: 182000, productType: "MYGA" })]);
    expect(drafts.map((d) => d.target)).toEqual(["account", "annuity_contract"]);
    expect(keys(drafts[0])).toEqual(["name", "value"]);
    expect(keys(drafts[1])).toEqual(["productType"]);

    const bare = place(ANNUITY_MAP, [rowOf("an1", { contractName: "Lincoln", cashValue: 182000 })]).drafts;
    expect(bare.map((d) => d.target)).toEqual(["account"]);
  });

  it("income from a rider or annuitization isn't placed — a warning says why", () => {
    const rider = place(ANNUITY_MAP, [rowOf("an1", { contractName: "Lincoln", productType: "Variable", income: "Income rider (GLWB)" })]).drafts;
    expect(keys(rider[1])).toEqual(["productType"]);
    expect(rider[1].warnings).toEqual([ANNUITY_INCOME_WARNING]);

    // Nothing else for the contract: the warning moves to the account line, and no empty contract is written.
    const annuitized = place(ANNUITY_MAP, [rowOf("an1", { contractName: "Lincoln", income: "Annuitized" })]).drafts;
    expect(annuitized).toHaveLength(1);
    expect(annuitized[0].warnings).toEqual([ANNUITY_INCOME_WARNING]);
  });

  it("an account on record updates its contract by the account's id, or creates one when it has none", () => {
    const account = recordOf("a-ann", "Lincoln Fixed Annuity", { name: "Lincoln Fixed Annuity" }, { category: "annuity", subType: "non_qualified" });
    const contract = recordOf("a-ann", "Lincoln Fixed Annuity", { costBasis: 140000, productType: "fixed", incomeMode: "none", payoutStructure: null });
    const row = { ...full, link: linkedTo("a-ann") };

    const withContract = place(ANNUITY_MAP, [row], hendricksBook({ account: [account], annuity_contract: [contract] })).drafts;
    expect(withContract.map((d) => [d.target, d.recordId])).toEqual([["account", "a-ann"], ["annuity_contract", "a-ann"]]);
    expect(withContract[1].parent).toEqual({ ref: "record", target: "account", id: "a-ann" });
    expect(withContract[1].dependsOn).toBeUndefined();

    const noContract = place(ANNUITY_MAP, [row], hendricksBook({ account: [account] })).drafts;
    expect(noContract.map((d) => [d.target, d.recordId])).toEqual([["account", "a-ann"], ["annuity_contract", null]]);
    expect(noContract[1].parent).toEqual({ ref: "record", target: "account", id: "a-ann" });
  });

  it("a row linked to a record not in the book never updates it", () => {
    const { drafts } = place(ANNUITY_MAP, [{ ...full, link: linkedTo("a-of-another-client") }]);
    expect(drafts.map((d) => d.recordId)).toEqual([null, null]);
  });

  it("a trust-owned annuity names the trust; a trust that can't be found blocks the account", () => {
    const trusts = { trusts: [rowOf("tr1", { trustName: "Hendricks ILIT", trustType: "ILIT" })] };
    const owned = place(ANNUITY_MAP, [rowOf("an1", { contractName: "Lincoln", owner: "Trust / entity", ownerEntity: "Hendricks ILIT" })], hendricksBook(), trusts).drafts;
    expect(owned[0].fields).toContainEqual({
      key: "owners",
      value: [{ who: { ref: "line", target: "entity", lineId: "tr1/entity" }, percent: 1 }],
      from: [at("annuity", "an1", "owner"), at("annuity", "an1", "ownerEntity")],
    });
    expect(owned[0].dependsOn).toEqual(["tr1/entity"]);

    const blank = place(ANNUITY_MAP, [rowOf("an1", { contractName: "Lincoln", owner: "Trust / entity" })]).drafts;
    expect(blank[0].blocked).toEqual({ reason: "Pick which trust or entity owns it.", cell: at("annuity", "an1", "ownerEntity") });
  });
});

describe("EQUITY_MAP", () => {
  const rsu = rowOf("eq1", {
    company: "Acme Corp",
    ticker: "ACME",
    grantType: "RSU",
    grantNumber: "R-1001",
    grantDate: "2025-03-01",
    sharesGranted: 1000,
    vestingSchedule: "25% a year over 4 years",
    owner: "Client",
  });
  const nqso = rowOf("eq2", {
    company: "ACME corp.",
    grantType: "NQSO",
    grantNumber: "N-2002",
    grantDate: "2024-06-15",
    sharesGranted: 500,
    strikePrice: 42.5,
    expirationDate: "2034-06-15",
    vestingSchedule: "6/15/2025: 250; 6/15/2026: 250",
  });
  const grant = (book: RecordBook, ...rows: FFRow[]) => place(EQUITY_MAP, rows, book).drafts;

  it("one account per company (its first row owns the line) and one grant per row under it", () => {
    const drafts = grant(hendricksBook(), rsu, nqso);
    const cell = (rowId: string, columnId: string) => [at("equity", rowId, columnId)];
    const acct = { ref: "line", target: "stock_option_account", lineId: "eq1/stock_option_account" } as const;
    expect(drafts).toEqual([
      {
        lineId: "eq1/stock_option_account",
        sectionId: "equity",
        rowId: "eq1",
        target: "stock_option_account",
        recordId: null,
        label: "Acme Corp",
        fields: [
          { key: "name", value: "Acme Corp", from: cell("eq1", "company") },
          { key: "ticker", value: "ACME", from: cell("eq1", "ticker") },
          { key: "owner", value: "client", from: cell("eq1", "owner") },
        ],
        warnings: [],
      },
      {
        lineId: "eq1/stock_option_grant",
        sectionId: "equity",
        rowId: "eq1",
        target: "stock_option_grant",
        recordId: null,
        label: "Acme Corp RSU grant #R-1001",
        fields: [
          { key: "grantType", value: "rsu", from: cell("eq1", "grantType") },
          { key: "grantNumber", value: "R-1001", from: cell("eq1", "grantNumber") },
          { key: "grantDate", value: "2025-03-01", from: cell("eq1", "grantDate") },
          { key: "sharesGranted", value: 1000, from: cell("eq1", "sharesGranted") },
          {
            key: "tranches",
            value: [
              { vestDate: "2026-03-01", shares: 250 },
              { vestDate: "2027-03-01", shares: 250 },
              { vestDate: "2028-03-01", shares: 250 },
              { vestDate: "2029-03-01", shares: 250 },
            ],
            from: cell("eq1", "vestingSchedule"),
          },
        ],
        warnings: [],
        parent: acct,
        dependsOn: ["eq1/stock_option_account"],
      },
      {
        lineId: "eq2/stock_option_grant",
        sectionId: "equity",
        rowId: "eq2",
        target: "stock_option_grant",
        recordId: null,
        label: "ACME corp. NQSO grant #N-2002",
        fields: [
          { key: "grantType", value: "nqso", from: cell("eq2", "grantType") },
          { key: "grantNumber", value: "N-2002", from: cell("eq2", "grantNumber") },
          { key: "grantDate", value: "2024-06-15", from: cell("eq2", "grantDate") },
          { key: "sharesGranted", value: 500, from: cell("eq2", "sharesGranted") },
          { key: "strikePrice", value: 42.5, from: cell("eq2", "strikePrice") },
          { key: "expirationDate", value: "2034-06-15", from: cell("eq2", "expirationDate") },
          {
            key: "tranches",
            value: [
              { vestDate: "2025-06-15", shares: 250 },
              { vestDate: "2026-06-15", shares: 250 },
            ],
            from: cell("eq2", "vestingSchedule"),
          },
        ],
        warnings: [],
        parent: acct,
        dependsOn: ["eq1/stock_option_account"],
      },
    ]);
  });

  it("the account is the one a row's linked grant sits in, else the plan's account of that name, else new", () => {
    const acme = recordOf("so-1", "Acme Corp", { name: "Acme Corp", ticker: "ACME", owner: "client" }, { category: "stock_options" });
    const other = recordOf("so-2", "Acme (old plan)", { name: "Acme (old plan)", ticker: null, owner: "client" });
    const grantOnRecord = recordOf("g-9", "Acme RSU", { grantType: "rsu", grantDate: "2025-03-01", sharesGranted: 1000 }, { accountId: "so-2" });

    const byGrant = grant(hendricksBook({ stock_option_account: [acme, other], stock_option_grant: [grantOnRecord] }), rsu, { ...nqso, link: linkedTo("g-9") });
    expect(byGrant.map((d) => [d.lineId, d.recordId])).toEqual([
      ["eq1/stock_option_account", "so-2"],
      ["eq1/stock_option_grant", null],
      ["eq2/stock_option_grant", "g-9"],
    ]);
    expect(byGrant[1].parent).toEqual({ ref: "record", target: "stock_option_account", id: "so-2" });
    expect(byGrant[1].dependsOn).toBeUndefined();

    const byName = grant(hendricksBook({ stock_option_account: [acme] }), rsu);
    expect(byName[0].recordId).toBe("so-1");

    const notInBook = grant(hendricksBook({ stock_option_account: [acme] }), { ...rsu, cells: { ...rsu.cells, company: { value: "Globex", by: "document" } } });
    expect(notInBook[0].recordId).toBeNull();
  });

  it("a row linked to a grant not in the book never updates it", () => {
    const drafts = grant(hendricksBook(), { ...rsu, link: linkedTo("g-of-another-client") });
    expect(drafts.map((d) => d.recordId)).toEqual([null, null]);
  });

  it("Owner: Client → client, Co-client → spouse; a new account needs one; Co-client needs a co-client", () => {
    const laura = rowOf("eq1", { company: "Acme Corp", owner: "Co-client" });
    expect(valueOf(grant(hendricksBook(), laura)[0], "owner")).toBe("spouse");

    const nobody = grant(hendricksBook(), rowOf("eq1", { company: "Acme Corp" }));
    expect(nobody[0].blocked).toEqual({ reason: "Pick who holds these grants.", cell: at("equity", "eq1", "owner") });

    const acme = recordOf("so-1", "Acme Corp", { name: "Acme Corp", ticker: null, owner: "client" });
    const onRecord = grant(hendricksBook({ stock_option_account: [acme] }), rowOf("eq1", { company: "Acme Corp" }));
    expect(onRecord[0]).toMatchObject({ recordId: "so-1", fields: [{ key: "name" }] });
    expect(onRecord[0].blocked).toBeUndefined();

    const single = grant(bookWith({}, { people: { client: "fm-client", spouse: null }, names: { client: "Mark", spouse: null } }), laura);
    expect(single[0].blocked).toEqual({ reason: NO_CO_CLIENT_REASON, cell: at("equity", "eq1", "owner") });
  });

  it("each holder's grants at one company get their own account (an account has one owner); a blank Owner joins the only holder", () => {
    const mark = rowOf("eq1", { company: "Acme Corp", owner: "Client", grantType: "RSU" });
    const laura = rowOf("eq2", { company: "Acme Corp", owner: "Co-client", grantType: "ISO" });
    const split = grant(hendricksBook(), mark, laura);
    expect(split.map((d) => [d.lineId, d.label, valueOf(d, "owner") ?? null])).toEqual([
      ["eq1/stock_option_account", "Acme Corp — Client", "client"],
      ["eq1/stock_option_grant", "Acme Corp RSU grant", null],
      ["eq2/stock_option_account", "Acme Corp — Co-client", "spouse"],
      ["eq2/stock_option_grant", "Acme Corp ISO grant", null],
    ]);
    // On record, the same-name account of the right holder.
    const acmeMark = recordOf("so-1", "Acme Corp", { name: "Acme Corp", ticker: null, owner: "client" });
    const acmeLaura = recordOf("so-2", "Acme Corp", { name: "Acme Corp", ticker: null, owner: "spouse" });
    const matched = grant(hendricksBook({ stock_option_account: [acmeMark, acmeLaura] }), mark, laura);
    expect(matched.filter((d) => d.target === "stock_option_account").map((d) => d.recordId)).toEqual(["so-1", "so-2"]);

    const blankJoins = grant(hendricksBook(), mark, rowOf("eq3", { company: "acme corp", grantType: "RSU" }));
    expect(blankJoins.map((d) => d.lineId)).toEqual(["eq1/stock_option_account", "eq1/stock_option_grant", "eq3/stock_option_grant"]);
    expect(blankJoins[2].parent).toEqual({ ref: "line", target: "stock_option_account", lineId: "eq1/stock_option_account" });
  });

  it("a vesting schedule it can't read blocks the grant, on that cell", () => {
    const drafts = grant(hendricksBook(), { ...rsu, cells: { ...rsu.cells, vestingSchedule: { value: "1-year cliff, then monthly", by: "document" } } });
    expect(drafts[1].blocked).toEqual({
      reason: 'Vesting schedule: list each vest date and shares ("3/1/2027: 250; 3/1/2028: 250") or say "25% a year over 4 years from 3/1/2026".',
      cell: at("equity", "eq1", "vestingSchedule"),
    });
    expect(keys(drafts[1])).not.toContain("tranches");
    expect(drafts[0].blocked).toBeUndefined();
  });

  it("a grant on record spreads its vesting over the grant date and shares on record when the row leaves them blank", () => {
    const acme = recordOf("so-1", "Acme Corp", { name: "Acme Corp", ticker: null, owner: "client" });
    const onRecord = recordOf("g-1", "Acme RSU", { grantType: "rsu", grantDate: "2025-03-01", sharesGranted: 400 }, { accountId: "so-1" });
    const row = rowOf("eq1", { company: "Acme Corp", vestingSchedule: "evenly over 2 years" }, { link: linkedTo("g-1") });
    const drafts = grant(hendricksBook({ stock_option_account: [acme], stock_option_grant: [onRecord] }), row);
    expect(drafts[1]).toMatchObject({ recordId: "g-1", parent: { ref: "record", target: "stock_option_account", id: "so-1" } });
    expect(drafts[1].fields).toEqual([
      {
        key: "tranches",
        value: [
          { vestDate: "2026-03-01", shares: 200 },
          { vestDate: "2027-03-01", shares: 200 },
        ],
        from: [at("equity", "eq1", "vestingSchedule")],
      },
    ]);
  });

  it("a Grant date that didn't read blocks a schedule that counts from it — the date on record never stands in", () => {
    const acme = recordOf("so-1", "Acme Corp", { name: "Acme Corp", ticker: null, owner: "client" });
    const onRecord = recordOf("g-1", "Acme RSU", { grantType: "rsu", grantDate: "2025-03-01", sharesGranted: 400 }, { accountId: "so-1" });
    const book = hendricksBook({ stock_option_account: [acme], stock_option_grant: [onRecord] });
    const unread = (vestingSchedule: string, link = true) =>
      place(EQUITY_MAP, [rowOf("eq1", { company: "Acme Corp", sharesGranted: 400, vestingSchedule }, link ? { link: linkedTo("g-1") } : {})], book, {}, null, ["eq1:grantDate"]).drafts[1];
    const blocked = { reason: "Grant date didn't read — the vesting schedule counts from it; fix the date.", cell: at("equity", "eq1", "grantDate") };

    const relative = unread("evenly over 2 years");
    expect(relative.blocked).toEqual(blocked);
    expect(keys(relative)).not.toContain("tranches");
    expect(unread("evenly over 2 years", false).blocked).toEqual(blocked);   // a new grant too

    // A schedule that names its own dates doesn't count from the grant date.
    expect(unread("3/1/2026: 200; 3/1/2027: 200").blocked).toBeUndefined();
    expect(unread("evenly over 2 years from 3/1/2025").blocked).toBeUndefined();
  });

  it("a grant with no company is blocked — unless it's on record, where it stays under its own account", () => {
    const orphan = grant(hendricksBook(), rowOf("eq1", { grantType: "RSU", sharesGranted: 100 }));
    expect(orphan).toHaveLength(1);
    expect(orphan[0].blocked).toEqual({ reason: "Add the company or plan these grants are from.", cell: at("equity", "eq1", "company") });

    const onRecord = recordOf("g-1", "Acme RSU", { grantType: "rsu", grantDate: "2025-03-01", sharesGranted: 100 }, { accountId: "so-1" });
    const acme = recordOf("so-1", "Acme Corp", { name: "Acme Corp", ticker: null, owner: "client" });
    const kept = grant(hendricksBook({ stock_option_account: [acme], stock_option_grant: [onRecord] }), rowOf("eq1", { grantNumber: "R-1" }, { link: linkedTo("g-1") }));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ recordId: "g-1", parent: { ref: "record", target: "stock_option_account", id: "so-1" } });
    expect(kept[0].blocked).toBeUndefined();
  });

  it("new Shares granted on a grant on record needs a vesting schedule that adds up to it", () => {
    const acme = recordOf("so-1", "Acme Corp", { name: "Acme Corp", ticker: null, owner: "client" });
    const tranches = [{ vestDate: "2026-03-01", shares: 50 }, { vestDate: "2027-03-01", shares: 50 }];
    const onRecord = recordOf("g-1", "Acme RSU", { grantType: "rsu", grantDate: "2025-03-01", sharesGranted: 100, tranches }, { accountId: "so-1" });
    const book = hendricksBook({ stock_option_account: [acme], stock_option_grant: [onRecord] });
    const row = (values: Record<string, string | number>) => rowOf("eq1", { company: "Acme Corp", ...values }, { link: linkedTo("g-1") });

    expect(grant(book, row({ sharesGranted: 120 }))[1].blocked).toEqual({
      reason: "Shares granted changed to 120 — add the vesting schedule so the vest dates add up to it.",
      cell: at("equity", "eq1", "vestingSchedule"),
    });
    expect(grant(book, row({ sharesGranted: 100 }))[1].blocked).toBeUndefined();
    expect(grant(book, row({ sharesGranted: 120, vestingSchedule: "evenly over 2 years" }))[1].blocked).toBeUndefined();
  });
});

describe("NOTES_REC_MAP", () => {
  const full = rowOf("n1", {
    borrower: "Loan to Emma",
    originalAmount: 50000,
    currentBalance: 42000,
    balanceAsOf: "2026-01",
    interestRate: 4.35,
    paymentType: "Amortizing",
    monthlyPayment: 510.25,
    start: "2023-06",
    termMonths: 120,
    owner: "Joint",
  });

  it("a new note takes every column, interest as a fraction, and its basis from the original amount", () => {
    const { drafts } = place(NOTES_REC_MAP, [full]);
    const cell = (columnId: string) => [at("notes_rec", "n1", columnId)];
    expect(drafts).toEqual([
      {
        lineId: "n1/note_receivable",
        sectionId: "notes_rec",
        rowId: "n1",
        target: "note_receivable",
        recordId: null,
        label: "Loan to Emma",
        fields: [
          { key: "name", value: "Loan to Emma", from: cell("borrower") },
          { key: "faceValue", value: 50000, from: cell("originalAmount") },
          { key: "basis", value: 50000, from: cell("originalAmount") },
          { key: "asOfBalance", value: 42000, from: cell("currentBalance") },
          { key: "balanceAsOf", value: "2026-01", from: cell("balanceAsOf") },
          { key: "interestRate", value: 0.0435, from: cell("interestRate") },
          { key: "paymentType", value: "amortizing", from: cell("paymentType") },
          { key: "monthlyPayment", value: 510.25, from: cell("monthlyPayment") },
          { key: "start", value: "2023-06", from: cell("start") },
          { key: "termMonths", value: 120, from: cell("termMonths") },
          { key: "owners", value: [{ who: client, percent: 0.5 }, { who: spouse, percent: 0.5 }], from: cell("owner") },
        ],
        warnings: [],
      },
    ]);
  });

  const note = recordOf("nr-1", "Loan to Emma", { name: "Loan to Emma", faceValue: 50000, basis: 30000, asOfBalance: 42000 });

  it("a note on record keeps its basis, and a blank cell makes no field", () => {
    const row = rowOf("n1", { borrower: "Loan to Emma", originalAmount: 50000, interestRate: 5 }, { link: linkedTo("nr-1") });
    const { drafts } = place(NOTES_REC_MAP, [row], hendricksBook({ note_receivable: [note] }));
    expect(drafts[0].recordId).toBe("nr-1");
    expect(keys(drafts[0])).toEqual(["name", "faceValue", "interestRate"]);
    expect(drafts[0].blocked).toBeUndefined();
  });

  it("a balance with no date is as of its statement, else the date the fact finder was completed — unless it's the balance on record", () => {
    const undated = rowOf("n1", { borrower: "Loan to Emma", currentBalance: 41000, owner: "Client" });
    expect(valueOf(place(NOTES_REC_MAP, [{ ...undated, statementDate: "2026-02-28" }], hendricksBook(), {}, "2026-03-15").drafts[0], "balanceAsOf")).toBe("2026-02");
    const fromMeta = place(NOTES_REC_MAP, [undated], hendricksBook(), {}, "2026-03-15").drafts[0];
    expect(fromMeta.fields.find((f) => f.key === "balanceAsOf")).toEqual({ key: "balanceAsOf", value: "2026-03", from: [] });
    expect(keys(place(NOTES_REC_MAP, [undated]).drafts[0])).not.toContain("balanceAsOf");

    const same = rowOf("n1", { borrower: "Loan to Emma", currentBalance: 42000 }, { link: linkedTo("nr-1") });
    expect(keys(place(NOTES_REC_MAP, [same], hendricksBook({ note_receivable: [note] }), {}, "2026-03-15").drafts[0])).toEqual(["name", "asOfBalance"]);
  });

  it("a new note needs an owner; an owner it can't place blocks it", () => {
    const { drafts } = place(NOTES_REC_MAP, [rowOf("n1", { borrower: "Loan to Emma", originalAmount: 50000 })]);
    expect(drafts[0].blocked).toEqual({ reason: "Pick who the note belongs to.", cell: at("notes_rec", "n1", "owner") });

    const trust = place(
      NOTES_REC_MAP,
      [rowOf("n1", { borrower: "Loan to Emma", owner: "Trust / entity", ownerEntity: "Smith Family Trust" })],
      hendricksBook({ entity: [recordOf("e-1", "Smith Family Trust", { name: "Smith Family Trust" })] }),
    ).drafts;
    expect(valueOf(trust[0], "owners")).toEqual([{ who: { ref: "record", target: "entity", id: "e-1" }, percent: 1 }]);

    const single = place(NOTES_REC_MAP, [rowOf("n1", { borrower: "Loan to Emma", owner: "Joint" })], bookWith({})).drafts;
    expect(single[0].blocked).toEqual({ reason: NO_CO_CLIENT_REASON, cell: at("notes_rec", "n1", "owner") });
  });

  it("a row linked to a record not in the book never updates it", () => {
    const { drafts } = place(NOTES_REC_MAP, [{ ...full, link: linkedTo("nr-of-another-client") }], hendricksBook({ note_receivable: [note] }));
    expect(drafts[0].recordId).toBeNull();
    expect(keys(drafts[0])).toContain("basis");
  });
});
