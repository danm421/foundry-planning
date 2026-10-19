// src/lib/fact-finder/placement/__tests__/values.test.ts
import { describe, expect, it } from "vitest";
import type { PlacedValue, RecordRef } from "../../change-set";
import { FILING_MAP, INCOME_TYPE_MAP } from "../../enums";
import type { ValueKind } from "../targets";
import { formatValue, isEmptyValue, sameValue, type FormatContext } from "../values";

const PEOPLE = { client: "fm-client", spouse: "fm-spouse" };
const client: RecordRef = { ref: "person", role: "client" };
const spouse: RecordRef = { ref: "person", role: "spouse" };
const fm = (id: string): RecordRef => ({ ref: "record", target: "family_member", id });
const trust: RecordRef = { ref: "record", target: "entity", id: "ent-1" };

const LABELS: Record<string, string> = { "fm-emma": "Emma", "fm-lucas": "Lucas", "ent-1": "Hendricks Family Trust" };
const ctx: FormatContext = {
  labelOf: (ref) => (ref.ref === "person" ? (ref.role === "client" ? "Mark" : "Laura") : ref.ref === "record" ? LABELS[ref.id] : "New trust"),
};
const show = (kind: ValueKind, value: PlacedValue | undefined, options?: FormatContext["options"]) =>
  formatValue(kind, value, { ...ctx, options });

describe("isEmptyValue", () => {
  it.each([[null], [undefined], [""], ["   "], [[]], [{}]])("%j is empty", (value) => {
    expect(isEmptyValue(value as PlacedValue | undefined)).toBe(true);
  });
  it.each([[0], [false], ["x"], [[0]], [client], [{ yearRef: "plan_end" }]])("%j is not", (value) => {
    expect(isEmptyValue(value as PlacedValue)).toBe(false);
  });
});

describe("sameValue", () => {
  const same = (kind: ValueKind, a: PlacedValue | undefined, b: PlacedValue | undefined) => sameValue(kind, a, b, PEOPLE);

  it("two empties are the same; an empty and a value are not", () => {
    expect(same("text", null, "")).toBe(true);
    expect(same("owners", [], undefined)).toBe(true);
    expect(same("money", 0, null)).toBe(false);
    expect(same("text", "Laura", null)).toBe(false);
  });

  it("money within half a cent, rates within 0.005 points, numbers within 1e-6", () => {
    expect(same("money", 412330, 412330.004)).toBe(true);
    expect(same("money", 412330, 412330.01)).toBe(false);
    expect(same("rate", 0.065, "0.0650")).toBe(true);
    expect(same("rate", 0.065, 0.06504)).toBe(true);
    expect(same("rate", 0.065, 0.0651)).toBe(false);
    expect(same("number", 12.5, 12.5000001)).toBe(true);
    expect(same("integer", 65, 66)).toBe(false);
    expect(same("percent", 50, 50.004)).toBe(true);
  });

  it("text ignores outer and repeated spaces, and letter case — a statement alone never re-cases a record", () => {
    expect(same("text", " Fidelity  401(k) ", "Fidelity 401(k)")).toBe(true);
    expect(same("text", "FIDELITY INVESTMENTS", "Fidelity Investments")).toBe(true);
    expect(same("text", "Fidelity 401(k)", "Fidelity 403(b)")).toBe(false);
  });

  it("choices, dates and booleans compare exactly", () => {
    expect(same("choice", "married_joint", "married_joint")).toBe(true);
    expect(same("choice", "married_joint", "single")).toBe(false);
    expect(same("date", "1961-04-12", "1961-04-21")).toBe(false);
    expect(same("boolean", true, false)).toBe(false);
  });

  it("a person ref is the same as the household's family member record", () => {
    expect(same("ref", client, fm("fm-client"))).toBe(true);
    expect(same("ref", client, fm("fm-spouse"))).toBe(false);
    expect(same("policyOwner", spouse, fm("fm-spouse"))).toBe(true);
    expect(same("policyOwner", "joint", "joint")).toBe(true);
    expect(same("personOrName", "Emma", fm("fm-emma"))).toBe(false);
    expect(same("ref", { ref: "line", target: "account", lineId: "r1/account" }, fm("fm-client"))).toBe(false);
  });

  it("owners compare as a set of people with shares", () => {
    const record = [{ who: fm("fm-spouse"), percent: 0.5 }, { who: fm("fm-client"), percent: 0.5 }];
    expect(same("owners", [{ who: client, percent: 0.5 }, { who: spouse, percent: 0.5 }], record)).toBe(true);
    expect(same("owners", [{ who: client, percent: 0.6 }, { who: spouse, percent: 0.4 }], record)).toBe(false);
    expect(same("owners", [{ who: client, percent: 1 }], record)).toBe(false);
    expect(same("owners", [{ who: trust, percent: 1 }], [{ who: { ref: "record", target: "entity", id: "ent-1" }, percent: 1 }])).toBe(true);
  });

  it("beneficiaries compare by tier and person; recipients by person", () => {
    const record = [
      { tier: "primary", who: fm("fm-spouse"), percentage: 100 },
      { tier: "contingent", who: fm("fm-emma"), percentage: 50 },
      { tier: "contingent", who: fm("fm-lucas"), percentage: 50 },
    ];
    const placed = [
      { tier: "contingent", who: fm("fm-lucas"), percentage: 50 },
      { tier: "primary", who: spouse, percentage: 100 },
      { tier: "contingent", who: fm("fm-emma"), percentage: 50 },
    ];
    expect(same("beneficiaries", placed, record)).toBe(true);
    expect(same("beneficiaries", placed.map((b) => ({ ...b, tier: "primary" })), record)).toBe(false);
    expect(same("recipients", [{ who: fm("fm-emma"), percentage: 50 }, { who: fm("fm-lucas"), percentage: 50 }],
      [{ who: fm("fm-lucas"), percentage: 50 }, { who: fm("fm-emma"), percentage: 50 }])).toBe(true);
    expect(same("recipients", [{ who: fm("fm-emma"), percentage: 100 }], [{ who: fm("fm-lucas"), percentage: 100 }])).toBe(false);
  });

  describe("holdings", () => {
    const h = (ticker: string | null, name: string | null, shares: number | null, marketValue: number | null, price: number | null = null) =>
      ({ ticker, name, shares, price, marketValue, costBasis: null });
    const apple = h("AAPL", "Apple Inc", 100, 19500);
    const fund = h(null, "Growth Fund", null, 5000);
    const sameAsRecord = (placed: PlacedValue) => same("holdings", placed, [apple, fund]);

    it("pair up by ticker, else by name, in any order", () => {
      expect(sameAsRecord([h(null, "growth  fund", null, 5000), h("aapl", "Apple", 100, 19500, 195)])).toBe(true);
      expect(sameAsRecord([apple])).toBe(false);
      expect(sameAsRecord([apple, fund, h("MSFT", null, 10, 4200)])).toBe(false);
      expect(sameAsRecord([h("VTI", "Apple Inc", 100, 19500), fund])).toBe(false);
    });

    it("shares differ beyond 1e-6", () => {
      expect(sameAsRecord([h("AAPL", null, 100.0000005, 19500), fund])).toBe(true);
      expect(sameAsRecord([h("AAPL", null, 120, 19500), fund])).toBe(false);
    });

    it("a ticker's value moves with the nightly price, so only its shares compare", () => {
      expect(sameAsRecord([h("AAPL", null, 100, 23150, 231.5), fund])).toBe(true);
    });

    it("a position with no ticker compares its value", () => {
      expect(sameAsRecord([apple, h(null, "Growth Fund", null, 5200)])).toBe(false);
      expect(sameAsRecord([apple, h(null, "Growth Fund", null, 5000.004)])).toBe(true);
    });

    it("a blank on either side is not a difference", () => {
      expect(sameAsRecord([h("AAPL", null, null, 19500), fund])).toBe(true);
      expect(sameAsRecord([apple, h(null, "Growth Fund", 40, null)])).toBe(true);
      expect(same("holdings", [h(null, "Growth Fund", 40, 5000)], [h(null, "Growth Fund", null, null)])).toBe(true);
    });
  });

  it("timing, living items and tranches", () => {
    expect(same("timing", 2030, 2030)).toBe(true);
    expect(same("timing", 2030, { yearRef: "client_retirement" })).toBe(false);
    expect(same("timing", { yearRef: "client_retirement" }, { yearRef: "client_retirement" })).toBe(true);
    const items = [{ name: "Groceries", amount: 800, frequency: "monthly" }, { name: "Travel", amount: 5000, frequency: "annual" }];
    expect(same("items", [...items].reverse(), items)).toBe(true);
    expect(same("items", [{ ...items[0], amount: 900 }, items[1]], items)).toBe(false);
    const tranches = [{ vestDate: "2027-03-01", shares: 250 }, { vestDate: "2028-03-01", shares: 250 }];
    expect(same("tranches", [...tranches].reverse(), tranches)).toBe(true);
    expect(same("tranches", [tranches[0], { vestDate: "2028-06-01", shares: 250 }], tranches)).toBe(false);
  });
});

describe("formatValue", () => {
  it("prints an empty value as a dash", () => {
    for (const value of [null, undefined, "", []]) expect(show("money", value)).toBe("—");
  });

  it("money, rates, percents and numbers", () => {
    expect(show("money", 412330)).toBe("$412,330");
    expect(show("money", 1234.5)).toBe("$1,234.50");
    expect(show("rate", 0.065)).toBe("6.5%");
    expect(show("rate", 0.06875)).toBe("6.875%");
    expect(show("rate", 0.0435)).toBe("4.35%");
    expect(show("percent", 50)).toBe("50%");
    expect(show("number", 1000)).toBe("1,000");
    expect(show("number", 12.5)).toBe("12.5");
    expect(show("integer", 65)).toBe("65");
    expect(show("year", 2026)).toBe("2026");
  });

  it("dates, months and yes/no", () => {
    expect(show("date", "2026-03-04")).toBe("Mar 4, 2026");
    expect(show("monthYear", "2026-03")).toBe("Mar 2026");
    expect(show("month", 9)).toBe("September");
    expect(show("boolean", true)).toBe("Yes");
    expect(show("boolean", false)).toBe("No");
  });

  it("a choice prints its option label, else the value in words", () => {
    expect(show("choice", "married_joint", FILING_MAP)).toBe("Married filing jointly");
    expect(show("choice", "social_security", INCOME_TYPE_MAP)).toBe("Social security");
  });

  it("references print the referenced name", () => {
    expect(show("ref", trust)).toBe("Hendricks Family Trust");
    expect(show("ref", { ref: "line", target: "entity", lineId: "t1/entity" })).toBe("New trust");
    expect(show("personOrName", fm("fm-emma"))).toBe("Emma");
    expect(show("personOrName", "Olivia Park")).toBe("Olivia Park");
    expect(show("policyOwner", "joint")).toBe("Joint");
    expect(show("policyOwner", client)).toBe("Mark");
  });

  it("owners: joint, one owner, or each with a share", () => {
    expect(show("owners", [{ who: client, percent: 0.5 }, { who: spouse, percent: 0.5 }])).toBe("Joint (50% / 50%)");
    expect(show("owners", [{ who: spouse, percent: 0.4 }, { who: client, percent: 0.6 }])).toBe("Joint (60% / 40%)");
    expect(show("owners", [{ who: client, percent: 1 }])).toBe("Mark");
    expect(show("owners", [{ who: trust, percent: 1 }])).toBe("Hendricks Family Trust");
    expect(show("owners", [{ who: client, percent: 0.6 }, { who: fm("fm-emma"), percent: 0.4 }])).toBe("Mark 60%, Emma 40%");
  });

  it("recipients and beneficiaries list each share", () => {
    const kids = [{ who: fm("fm-emma"), percentage: 50 }, { who: fm("fm-lucas"), percentage: 50 }];
    expect(show("recipients", kids)).toBe("Emma 50%, Lucas 50%");
    expect(show("beneficiaries", kids.map((k) => ({ ...k, tier: "primary" })))).toBe("Emma 50%, Lucas 50%");
    expect(show("beneficiaries", [
      { tier: "contingent", who: fm("fm-emma"), percentage: 50 },
      { tier: "primary", who: spouse, percentage: 100 },
      { tier: "contingent", who: fm("fm-lucas"), percentage: 50 },
    ])).toBe("Primary: Laura 100% · Contingent: Emma 50%, Lucas 50%");
  });

  it("timing prints a year or the milestone, as the Details year picker names it", () => {
    expect(show("timing", 2030)).toBe("2030");
    expect(show("timing", { yearRef: "client_retirement" })).toBe("Mark Retirement");
    expect(show("timing", { yearRef: "spouse_retirement" })).toBe("Laura Retirement");
    expect(show("timing", { yearRef: "plan_end" })).toBe("Last Year");
    expect(show("timing", { yearRef: "client_ss_fra" })).toBe("Client FRA");
  });

  it("living items, holdings and a vesting schedule", () => {
    expect(show("items", [{ name: "Groceries", amount: 800, frequency: "monthly" }, { name: "Travel", amount: 5000, frequency: "annual" }]))
      .toBe("Groceries: $800/mo, Travel: $5,000/yr");
    expect(show("holdings", [
      { ticker: "AAPL", name: null, shares: 100, price: 195, marketValue: 19500, costBasis: null },
      { ticker: null, name: "Growth Fund", shares: null, price: null, marketValue: 5000, costBasis: null },
    ])).toBe("2 holdings · $24,500");
    expect(show("holdings", [{ ticker: "AAPL", name: null, shares: 100, price: null, marketValue: null, costBasis: null }])).toBe("1 holding");
    expect(show("tranches", [{ vestDate: "2027-03-01", shares: 250 }, { vestDate: "2028-03-01", shares: 1250 }]))
      .toBe("Mar 1, 2027: 250 shares; Mar 1, 2028: 1,250 shares");
  });
});
