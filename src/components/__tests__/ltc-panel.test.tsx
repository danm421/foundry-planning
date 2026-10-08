// src/components/__tests__/ltc-panel.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import type { LtcPolicy } from "@/engine/types";
import { LTC_RIDER_DEFAULTS, LTC_STANDALONE_DEFAULTS } from "@/lib/schemas/ltc-policies";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ refresh: vi.fn() }),
  usePathname: () => "/clients/c1/details/insurance",
}));

import LtcPanel, { ltcRowWarning, type LtcPanelProps } from "@/components/ltc-panel";
import { ClientAccessProvider } from "@/components/client-access-provider";

const WHOLE = { id: "a1", name: "Whole Life", insuredPerson: "client" as const, faceValue: 500_000 };
const STANDALONE: LtcPolicy = {
  id: "s1", name: "Genworth LTC", insured: "client", carrier: null, issueYear: 2026,
  ...LTC_STANDALONE_DEFAULTS, annualPremium: 2400, partnership: false, notes: null,
};
const RIDER: LtcPolicy = {
  id: "r1", name: "Care rider", insured: "client", carrier: null, issueYear: 2026,
  ...LTC_RIDER_DEFAULTS, lifePolicyAccountId: "a1", partnership: false, notes: null,
};
const PROPS: LtcPanelProps = {
  clientId: "c1", policies: [STANDALONE, RIDER], lifePolicies: [WHOLE],
  clientFirstName: "Cooper", spouseFirstName: "Jane", spouseDob: "1972-01-01", currentYear: 2026,
};

const renderPanel = (over: Partial<LtcPanelProps> = {}, permission: "edit" | "view" = "edit") =>
  render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <LtcPanel {...PROPS} {...over} />
    </ClientAccessProvider>,
  );

describe("LtcPanel", () => {
  it("shows each policy in the panel's words", () => {
    renderPanel();
    const standalone = screen.getByRole("row", { name: /Genworth LTC/ });
    for (const text of ["Cooper", "Traditional", "$6,000/mo · 3 yrs", "90 days", "3% compound", "$2,400/yr for life"]) {
      expect(within(standalone).getByText(text)).toBeInTheDocument();
    }
    const rider = screen.getByRole("row", { name: /Care rider/ });
    for (const text of ["Rider on Whole Life", "2% of $500,000/mo", "None", "In the life premium"]) {
      expect(within(rider).getByText(text)).toBeInTheDocument();
    }
  });

  // Review Focus 1.
  it("still lists a rider whose life policy is not in this scenario, with a warning", () => {
    renderPanel({ lifePolicies: [] });
    const rider = screen.getByRole("row", { name: /Care rider/ });
    expect(within(rider).getByText("Its life policy isn't in this scenario.")).toBeInTheDocument();
    expect(within(rider).getByText("Rider")).toBeInTheDocument();
  });

  // Review Focus 2.
  it("says why a co-client's premium is missing when there is no date of birth", () => {
    renderPanel({ policies: [{ ...STANDALONE, insured: "spouse" }], spouseDob: null });
    expect(screen.getByText("No date of birth on file, so this premium isn't in the cash flow.")).toBeInTheDocument();
  });

  it("says what is absent when there is no coverage", () => {
    renderPanel({ policies: [] });
    expect(screen.getByText("No long-term care coverage on file")).toBeInTheDocument();
  });

  it("opens the Add dialog", () => {
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Add policy" }));
    expect(screen.getByRole("dialog", { name: "Add long-term care policy" })).toBeInTheDocument();
  });

  it("offers no Add or Edit to a viewer", () => {
    renderPanel({}, "view");
    expect(screen.queryByRole("button", { name: "Add policy" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit / })).toBeNull();
  });
});

// The co-client warning names the one premium `ltcPremiumWindow` would bill
// but can't place. Each row flips one condition, so dropping it goes RED —
// without `insured === "spouse"` every single-client household would warn.
describe("ltcRowWarning", () => {
  const NO_DOB = "No date of birth on file, so this premium isn't in the cash flow.";
  const unplaced: LtcPolicy = { ...STANDALONE, insured: "spouse" };

  it("warns for a co-client's billed standalone premium with no date of birth", () => {
    expect(ltcRowWarning(unplaced, [WHOLE], null)).toBe(NO_DOB);
  });

  it.each<[string, Partial<LtcPolicy>]>([
    ["a rider (its cost is in the life premium)", { kind: "life_rider", lifePolicyAccountId: "a1" }],
    ["a policy on the client", { insured: "client" }],
    ["a $0 premium", { annualPremium: 0 }],
    ["a paid-up policy", { premiumPayMode: "paid_up" }],
  ])("stays quiet for %s", (_, over) => {
    expect(ltcRowWarning({ ...unplaced, ...over }, [WHOLE], null)).toBeNull();
  });

  it("stays quiet once the co-client has a date of birth", () => {
    expect(ltcRowWarning(unplaced, [WHOLE], "1972-01-01")).toBeNull();
  });
});
