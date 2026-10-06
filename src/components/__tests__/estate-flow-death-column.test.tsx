// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { EstateFlowDeathColumn } from "@/components/estate-flow-death-column";
import type { DeathSectionData, RecipientGroup } from "@/lib/estate/transfer-report";
import type { EstateTaxResult } from "@/engine/types";
import type { ProjectionResult } from "@/engine/projection";

const NO_DRAINS: RecipientGroup["drainsByKind"] = {
  federal_estate_tax: 0,
  state_estate_tax: 0,
  probate: 0,
  admin_expenses: 0,
  debts_paid: 0,
  ird_tax: 0,
};

function recipient(over: Partial<RecipientGroup> & { assets?: [string, number][] }): RecipientGroup {
  const { assets = [], ...rest } = over;
  const total = assets.reduce((s, [, v]) => s + v, 0);
  return {
    key: "family_member|fm-jane",
    recipientKind: "family_member",
    recipientId: "fm-jane",
    recipientLabel: "Jane Sample",
    total,
    byMechanism: [
      {
        mechanism: "titling",
        mechanismLabel: "Account Titling",
        total,
        assets: assets.map(([label, amount], i) => ({
          sourceAccountId: `acct-${i}`,
          sourceLiabilityId: null,
          label,
          amount,
          basis: 0,
          conflictIds: [],
        })),
      },
    ],
    drainsByKind: NO_DRAINS,
    netTotal: total,
    ...rest,
  };
}

function estateTax(over: Partial<EstateTaxResult> = {}): EstateTaxResult {
  return {
    year: 2026,
    deathOrder: 1,
    deceased: "client",
    grossEstateLines: [],
    grossEstate: 0,
    estateAdminExpenses: 0,
    maritalDeduction: 0,
    charitableDeduction: 0,
    taxableEstate: 0,
    probateEstate: 0,
    probateCost: 0,
    adjustedTaxableGifts: 0,
    giftTaxPayable: 0,
    tentativeTaxBase: 0,
    tentativeTax: 0,
    beaAtDeathYear: 0,
    dsueReceived: 0,
    unifiedCredit: 0,
    federalEstateTax: 0,
    stateEstateTax: 0,
    totalTaxesAndExpenses: 0,
    dsueGenerated: 0,
    drainAttributions: [],
    ...over,
  } as unknown as EstateTaxResult;
}

function section(recipients: RecipientGroup[], tax: EstateTaxResult = estateTax()): DeathSectionData {
  const gross = recipients.reduce((s, r) => s + r.total, 0);
  return {
    decedent: "client",
    decedentName: "Cooper",
    year: 2026,
    taxableEstate: 0,
    grossEstate: 0,
    estateTax: tax,
    assetEstateValue: gross,
    assetCount: 0,
    recipients,
    reductions: [],
    conflicts: [],
    grossEstateDollarsByAccount: {},
    grossEstateDollarsByLiability: {},
    reconciliation: {
      sumLiabilityTransfers: 0,
      sumRecipients: gross,
      sumReductions: 0,
      unattributed: 0,
      reconciles: true,
    },
  };
}

function renderColumn(s: DeathSectionData, isMarried = true) {
  return render(
    <EstateFlowDeathColumn
      section={s}
      deathOrder={1}
      projection={{ years: [] } as unknown as ProjectionResult}
      gifts={[]}
      accountNameById={new Map()}
      isMarried={isMarried}
    />,
  );
}

describe("EstateFlowDeathColumn — recipient boxes", () => {
  it("shows only the recipient's name and net total until the box is expanded", () => {
    const jane = recipient({
      assets: [["Schwab Brokerage", 800_000]],
      drainsByKind: { ...NO_DRAINS, federal_estate_tax: 100_000 },
      netTotal: 700_000,
    });
    renderColumn(section([jane]));

    const toggle = screen.getByRole("button", { name: /Jane Sample/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(toggle).getByText("$700,000")).toBeDefined();
    expect(screen.queryByText("Schwab Brokerage")).toBeNull();
    expect(screen.queryByText("Reductions")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const box = within(toggle.closest("li")!);
    expect(box.getByText("Schwab Brokerage")).toBeDefined();
    expect(box.getByText("Titling")).toBeDefined();
    expect(box.getByText("$800,000")).toBeDefined();
    expect(box.getByText("Reductions")).toBeDefined();
    expect(box.getByText("−$100,000")).toBeDefined();
  });

  it("keeps the No-plan flag on a collapsed default-order box", () => {
    const heirs = recipient({
      key: "system_default|",
      recipientKind: "system_default",
      recipientId: null,
      recipientLabel: "Other heirs",
      assets: [["Checking", 50_000]],
    });
    renderColumn(section([heirs]));

    const toggle = screen.getByRole("button", { name: /Other heirs/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(within(toggle).getByText("No plan")).toBeDefined();
  });

  it("strip shows gross and what recipients net, with no tax figure", () => {
    const jane = recipient({
      assets: [["Schwab Brokerage", 800_000]],
      drainsByKind: { ...NO_DRAINS, federal_estate_tax: 100_000 },
      netTotal: 700_000,
    });
    renderColumn(section([jane]));

    expect(screen.getByText("Gross").textContent).toBe("Gross $800,000");
    expect(screen.getByText("Net $700,000")).toBeDefined();
    expect(screen.queryByText(/taxes/)).toBeNull();
  });
});

describe("EstateFlowDeathColumn — tax box", () => {
  it("lists federal, state and IRD tax under one projected total", () => {
    const tax = estateTax({
      federalEstateTax: 100_000,
      stateEstateTax: 50_000,
      drainAttributions: [
        { recipientKind: "family_member", recipientId: "fm-jane", drainKind: "ird_tax", amount: 25_000 },
      ] as EstateTaxResult["drainAttributions"],
    });
    renderColumn(section([recipient({ assets: [["IRA", 500_000]] })], tax));

    const toggle = screen.getByRole("button", { name: /Projected tax/ });
    expect(within(toggle).getByText("$175,000")).toBeDefined();
    const box = toggle.closest("section")!;
    expect(within(box).getByText("Federal estate tax").nextSibling?.textContent).toBe("$100,000");
    expect(within(box).getByText("State estate tax").nextSibling?.textContent).toBe("$50,000");
    expect(within(box).getByText("Income tax (IRD)").nextSibling?.textContent).toBe("$25,000");
    expect(within(box).queryByText("State inheritance tax")).toBeNull();
  });

  it("expands to the Estate Tax page's calculation for this death", () => {
    renderColumn(section([], estateTax({ taxableEstate: 2_000_000, unifiedCredit: 5_000_000 })));

    const toggle = screen.getByRole("button", { name: /Projected tax/ });
    expect(screen.queryByText("LESS: Unified Credit")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("LESS: Unified Credit")).toBeDefined();
    expect(screen.getAllByText("Taxable Estate").length).toBeGreaterThan(0);
  });

  it("shows the DSUE a first death ports only when there is a surviving spouse", () => {
    const tax = estateTax({ deathOrder: 1, dsueGenerated: 5_000_000 });

    const { unmount } = renderColumn(section([], tax), true);
    fireEvent.click(screen.getByRole("button", { name: /Projected tax/ }));
    expect(screen.getByText(/DSUE generated/)).toBeDefined();
    unmount();

    renderColumn(section([], tax), false);
    fireEvent.click(screen.getByRole("button", { name: /Projected tax/ }));
    expect(screen.queryByText(/DSUE generated/)).toBeNull();
  });
});
