import { describe, it, expect } from "vitest";
import {
  emptyTaxReturnFacts,
  emptyScheduleE,
  emptyBusiness,
  emptyK1,
} from "@/lib/schemas/tax-return-facts";
import { buildActivityDetail, activityDetailRows } from "../activity-detail";

/** Dan Mueller's filed 2025 Schedule E — the case this block exists for: a
 *  $19,600 rental that nets to a LOSS but throws off positive cash. */
function rentalFacts() {
  const f = emptyTaxReturnFacts(2025);
  f.income.scheduleENet = -6141;
  f.income.scheduleE = {
    ...emptyScheduleE(),
    grossRents: 19600,
    totalExpenses: 25741,
    depreciation: 8413,
    mortgageInterest: 6210,
    propertyTaxes: 5024,
    suspendedPassiveLoss: 0,
  };
  return f;
}

describe("buildActivityDetail — Schedule E rentals", () => {
  it("shows rent received, expenses and the filed net so a loss no longer hides the gross", () => {
    const [rental] = buildActivityDetail(rentalFacts())!;
    expect(rental.title).toBe("Rental real estate");
    expect(rental.subtitle).toBe("Schedule E");
    const byLabel = Object.fromEntries(rental.lines.map((l) => [l.label, l.amount]));
    expect(byLabel["Rents received"]).toBe(19600);
    expect(byLabel["Total expenses"]).toBe(-25741);
    expect(byLabel["Depreciation (non-cash)"]).toBe(-8413);
    expect(byLabel["Mortgage interest"]).toBe(-6210);
    expect(byLabel["Property taxes"]).toBe(-5024);
    expect(byLabel["Net taxable"]).toBe(-6141);
  });

  it("adds depreciation back to the net for the cash-flow memo (loss on paper, cash in pocket)", () => {
    const [rental] = buildActivityDetail(rentalFacts())!;
    expect(rental.cashFlow).toBe(2272); // -6141 + 8413
  });

  it("orders lines gross -> component expenses -> net, with the net marked total", () => {
    const [rental] = buildActivityDetail(rentalFacts())!;
    expect(rental.lines.map((l) => l.variant)).toEqual([
      "primary", // rents
      "primary", // total expenses
      "detail", // depreciation
      "detail", // mortgage interest
      "detail", // property taxes
      "total", // net
    ]);
  });

  it("takes the net from the FILED scheduleENet, never gross minus expenses", () => {
    const f = rentalFacts();
    f.income.scheduleENet = -9000; // vacation-home limits can break the identity
    expect(buildActivityDetail(f)![0].lines.at(-1)!.amount).toBe(-9000);
  });

  it("omits the net row entirely when Schedule 1 line 5 was not extracted", () => {
    const f = rentalFacts();
    f.income.scheduleENet = null;
    const [rental] = buildActivityDetail(f)!;
    expect(rental.lines.some((l) => l.variant === "total")).toBe(false);
    expect(rental.cashFlow).toBeNull();
  });

  it("skips null components rather than printing zeros", () => {
    const f = rentalFacts();
    f.income.scheduleE!.propertyTaxes = null;
    f.income.scheduleE!.mortgageInterest = null;
    const labels = buildActivityDetail(f)![0].lines.map((l) => l.label);
    expect(labels).not.toContain("Property taxes");
    expect(labels).not.toContain("Mortgage interest");
    expect(labels).toContain("Depreciation (non-cash)");
  });

  it("surfaces a suspended passive loss as a carryforward memo, but not a zero one", () => {
    const f = rentalFacts();
    f.income.scheduleE!.suspendedPassiveLoss = 4200;
    expect(buildActivityDetail(f)![0].suspendedPassiveLoss).toBe(4200);
    expect(buildActivityDetail(rentalFacts())![0].suspendedPassiveLoss).toBeNull();
  });

  it("emits nothing when Schedule E carries a net but no Part I detail block", () => {
    const f = emptyTaxReturnFacts(2025);
    f.income.scheduleENet = -6141;
    expect(buildActivityDetail(f)).toBeNull();
  });
});

describe("buildActivityDetail — Schedule C businesses", () => {
  function businessFacts() {
    const f = emptyTaxReturnFacts(2025);
    f.businesses = [
      {
        ...emptyBusiness(),
        name: "Acme Consulting",
        grossReceipts: 240000,
        totalExpenses: 85000,
        depreciation: 12000,
        netProfit: 155000,
      },
    ];
    return f;
  }

  it("shows gross receipts, expenses and net profit per business", () => {
    const [biz] = buildActivityDetail(businessFacts())!;
    expect(biz.title).toBe("Acme Consulting");
    expect(biz.subtitle).toBe("Schedule C");
    const byLabel = Object.fromEntries(biz.lines.map((l) => [l.label, l.amount]));
    expect(byLabel["Gross receipts"]).toBe(240000);
    expect(byLabel["Total expenses"]).toBe(-85000);
    expect(byLabel["Depreciation (non-cash)"]).toBe(-12000);
    expect(byLabel["Net profit"]).toBe(155000);
    expect(biz.cashFlow).toBe(167000);
  });

  it("names an unnamed business by its schedule rather than rendering a blank heading", () => {
    const f = businessFacts();
    f.businesses[0].name = null;
    expect(buildActivityDetail(f)![0].title).toBe("Schedule C business");
  });

  it("keeps each business separate so a profitable one cannot mask a losing one", () => {
    const f = businessFacts();
    f.businesses.push({ ...emptyBusiness(), name: "Side LLC", netProfit: -20000 });
    const out = buildActivityDetail(f)!;
    expect(out.map((a) => a.title)).toEqual(["Acme Consulting", "Side LLC"]);
  });
});

describe("buildActivityDetail — Schedule K-1 entities", () => {
  function k1Facts() {
    const f = emptyTaxReturnFacts(2025);
    f.k1s = [
      {
        ...emptyK1(),
        entityName: "Harbor Partners LP",
        ein: "12-3456789",
        entityType: "partnership",
        ordinaryBusinessIncome: 48000,
        rentalIncome: 6000,
        guaranteedPayments: 30000,
        section179: 5000,
      },
    ];
    return f;
  }

  it("lists each K-1 box that carries a figure, titled by entity and type", () => {
    const [k1] = buildActivityDetail(k1Facts())!;
    expect(k1.title).toBe("Harbor Partners LP");
    expect(k1.subtitle).toBe("Partnership K-1 · EIN 12-3456789");
    const byLabel = Object.fromEntries(k1.lines.map((l) => [l.label, l.amount]));
    expect(byLabel["Ordinary business income"]).toBe(48000);
    expect(byLabel["Rental income"]).toBe(6000);
    expect(byLabel["Guaranteed payments"]).toBe(30000);
    expect(byLabel["Section 179 deduction"]).toBe(-5000);
  });

  it("labels an S-corp and an estate/trust distinctly — the advice differs by type", () => {
    const f = k1Facts();
    f.k1s[0].entityType = "s_corp";
    expect(buildActivityDetail(f)![0].subtitle).toContain("S-corp K-1");
    f.k1s[0].entityType = "estate_trust";
    expect(buildActivityDetail(f)![0].subtitle).toContain("Estate/trust K-1");
    f.k1s[0].entityType = null;
    expect(buildActivityDetail(f)![0].subtitle).toBe("Schedule K-1 · EIN 12-3456789");
  });

  it("has no cash-flow memo — a K-1 box is already an allocated net", () => {
    expect(buildActivityDetail(k1Facts())![0].cashFlow).toBeNull();
  });

  it("drops a K-1 that carries no figures at all", () => {
    const f = emptyTaxReturnFacts(2025);
    f.k1s = [{ ...emptyK1(), entityName: "Empty LLC" }];
    expect(buildActivityDetail(f)).toBeNull();
  });
});

describe("buildActivityDetail — ordering and absence", () => {
  it("orders Schedule C, then Schedule E, then K-1s (Schedule 1 line order)", () => {
    const f = rentalFacts();
    f.businesses = [{ ...emptyBusiness(), name: "Acme", netProfit: 1000 }];
    f.k1s = [{ ...emptyK1(), entityName: "Harbor", ordinaryBusinessIncome: 500 }];
    expect(buildActivityDetail(f)!.map((a) => a.title)).toEqual([
      "Acme",
      "Rental real estate",
      "Harbor",
    ]);
  });

  it("returns null for a return with no business, rental or passthrough activity", () => {
    expect(buildActivityDetail(emptyTaxReturnFacts(2025))).toBeNull();
  });
});

describe("activityDetailRows — shared formatting for the report and the PDF", () => {
  it("formats every line and appends the cash-flow memo below the net", () => {
    const rows = activityDetailRows(buildActivityDetail(rentalFacts())![0]);
    expect(rows).toEqual([
      { label: "Rents received", value: "$19,600", variant: "primary" },
      { label: "Total expenses", value: "-$25,741", variant: "primary" },
      { label: "Depreciation (non-cash)", value: "-$8,413", variant: "detail" },
      { label: "Mortgage interest", value: "-$6,210", variant: "detail" },
      { label: "Property taxes", value: "-$5,024", variant: "detail" },
      { label: "Net taxable", value: "-$6,141", variant: "total" },
      { label: "Cash flow before depreciation", value: "$2,272", variant: "memo" },
    ]);
  });

  it("appends the suspended-loss memo when the return carries one", () => {
    const f = rentalFacts();
    f.income.scheduleE!.suspendedPassiveLoss = 4200;
    const rows = activityDetailRows(buildActivityDetail(f)![0]);
    expect(rows.at(-1)).toEqual({
      label: "Suspended passive loss carried forward",
      value: "$4,200",
      variant: "memo",
    });
  });
});
