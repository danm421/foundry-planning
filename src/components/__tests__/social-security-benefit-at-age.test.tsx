// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Income, ClientInfo, PlanSettings } from "@/engine/types";

const submit = vi.fn();
vi.mock("@/hooks/use-scenario-writer", () => ({ useScenarioWriter: () => ({ submit, scenarioActive: false }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/c1/details/income-expenses",
}));

import { SocialSecurityDialog } from "@/components/social-security-dialog";

const DOUGLAS = {
  firstName: "Paul", dateOfBirth: "1958-02-24", spouseName: "Cynthia", spouseDob: "1960-07-16",
  retirementAge: 70, spouseRetirementAge: 65, lifeExpectancy: 95, spouseLifeExpectancy: 95,
} as unknown as ClientInfo;

// Exactly as prod stores Paul today (legacy: no stated age).
const PAUL = {
  id: "p", type: "social_security", name: "Social Security — Paul", annualAmount: 68478,
  startYear: 2028, endYear: 2071, growthRate: 0.02, inflationStartYear: 2026, owner: "client",
  claimingAge: 70, claimingAgeMonths: 0, claimingAgeMode: "years", ssBenefitMode: "manual_amount",
} as unknown as Income;
// As the list-GET hands it over: string decimals.
const CYNTHIA_RAW = {
  id: "c", type: "social_security", owner: "spouse", annualAmount: "0", piaMonthly: "0.00",
  growthRate: "0.0200", ssBenefitMode: "pia_at_fra", claimingAge: 67, claimingAgeMode: "fra", endYear: 2071,
};

function open(row: Income | null = PAUL, incomes: readonly object[] = [CYNTHIA_RAW]) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [], text: async () => "" })));
  return render(
    <SocialSecurityDialog clientId="c1" owner="client" existingRow={row} clientInfo={DOUGLAS}
      planSettings={{} as PlanSettings} incomes={incomes as typeof CYNTHIA_RAW[]} onClose={() => {}} onSaved={() => {}} />,
  );
}

const amountBox = () => screen.getByLabelText(/^(Benefit amount|PIA)$/i) as HTMLInputElement;
const statedYears = () => screen.getByLabelText(/Age this benefit is quoted at/i) as HTMLSelectElement;
const claimYears = () => screen.getByLabelText(/^Claim age$/i) as HTMLSelectElement;
const unitBtn = (u: "/mo" | "/yr") => screen.getByRole("button", { name: u });
async function saved() {
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(submit).toHaveBeenCalled());
  return submit.mock.calls[0][1].body;
}

beforeEach(() => {
  submit.mockReset();
  submit.mockResolvedValue({ ok: true, text: async () => "" });
});

describe("Benefit at a specific age", () => {
  it("opens a legacy annual row as 'Benefit at a specific age', $68,478 /yr at 70", () => {
    open();
    expect((screen.getByRole("radio", { name: /Benefit at a specific age/i }) as HTMLInputElement).checked).toBe(true);
    expect(amountBox().value).toBe("68478");
    expect(unitBtn("/yr").getAttribute("aria-pressed")).toBe("true");
    expect(statedYears().value).toBe("70");
  });

  it("flipping to /mo re-expresses the amount", () => {
    open();
    fireEvent.click(unitBtn("/mo"));
    expect(amountBox().value).toBe("5706.5");
  });

  it("saves canonical annual + the typed unit + the pinned stated age", async () => {
    open();
    fireEvent.click(unitBtn("/mo"));
    const body = await saved();
    expect(body.ssBenefitMode).toBe("manual_amount");
    expect(body.annualAmount).toBe(68478);
    expect(body.ssAmountUnit).toBe("monthly");
    expect(body.ssStatedAge).toBe(70);
    expect(body.ssStatedAgeMonths).toBe(0);
    expect(body.piaMonthly).toBeNull();
  });

  it("REVIEW FOCUS 1 — a saved $5,706.50/mo reopens as 5706.5 with /mo selected", () => {
    open({ ...PAUL, ssAmountUnit: "monthly", ssStatedAge: 70, ssStatedAgeMonths: 0 } as Income);
    expect(amountBox().value).toBe("5706.5");
    expect(unitBtn("/mo").getAttribute("aria-pressed")).toBe("true");
  });

  it("REVIEW FOCUS 2a — the claim age follows the stated age while they match", async () => {
    open({ ...PAUL, claimingAge: 67, ssStatedAge: 67 } as Income);
    fireEvent.change(statedYears(), { target: { value: "70" } });
    expect(claimYears().value).toBe("70");
  });

  it("REVIEW FOCUS 2b — a deliberately different claim age is left alone", async () => {
    open({ ...PAUL, claimingAge: 67, ssStatedAge: 70 } as Income);
    fireEvent.change(statedYears(), { target: { value: "68" } });
    expect(claimYears().value).toBe("67");
    const body = await saved();
    expect(body.ssStatedAge).toBe(68);
    expect(body.claimingAge).toBe(67);
  });

  it("a PIA typed per year saves monthly", async () => {
    open({ ...PAUL, ssBenefitMode: "pia_at_fra", piaMonthly: 4500 } as Income);
    fireEvent.click(unitBtn("/yr"));
    expect(amountBox().value).toBe("54000");
    const body = await saved();
    expect(body.piaMonthly).toBe(4500);
    expect(body.ssAmountUnit).toBe("annual");
    expect(body.ssStatedAge).toBeNull();
  });

  it("previews the PIA, the benefit at the claim age, and Cynthia's spousal top-up", () => {
    open();
    expect(screen.getByText(/PIA \$4,505\/mo/)).toBeTruthy();
    expect(screen.getByText(/At 70: \$68,478\/yr/)).toBeTruthy();
    expect(screen.getByText(/Cynthia's spousal top-up: \$2,253\/mo/)).toBeTruthy();
  });

  it("a brand-new entry opens its PIA monthly and saves monthly", async () => {
    open(null);
    expect(unitBtn("/mo").getAttribute("aria-pressed")).toBe("true");
    const body = await saved();
    expect(body.ssBenefitMode).toBe("pia_at_fra");
    expect(body.ssAmountUnit).toBe("monthly");
  });

  it("a legacy row with no stored mode but a PIA opens as a monthly PIA, showing the PIA", async () => {
    const { ssBenefitMode: _mode, ...legacy } = { ...PAUL, piaMonthly: 4500, annualAmount: 68478 } as Income;
    void _mode;
    open(legacy as Income);
    expect(amountBox().value).toBe("4500");
    expect(unitBtn("/mo").getAttribute("aria-pressed")).toBe("true");
    const body = await saved();
    expect(body.piaMonthly).toBe(4500);
  });

  it("a no-mode row with only an annual amount shows it in the selected unit once switched to a specific age", async () => {
    const { ssBenefitMode: _mode, ...legacy } = PAUL as Income;
    void _mode;
    open(legacy as Income);
    fireEvent.click(screen.getByRole("radio", { name: /Benefit at a specific age/i }));
    expect(amountBox().value).toBe("5706.5");
    expect(unitBtn("/mo").getAttribute("aria-pressed")).toBe("true");
    const body = await saved();
    expect(body.annualAmount).toBe(68478);
  });
});

describe("the live preview agrees with the projection", () => {
  const NO_TOP_UP = /No spousal top-up/;

  // After a save the list holds raw rows, so a spouse on "Estimate from Salary"
  // arrives with no PIA. The projection pays her the salary estimate ($1,778
  // off $40,000), so the preview must price her off it too: $2,253 − $1,778.
  it("prices a raw Estimate-from-Salary spouse off her salary, as the projection does", () => {
    const salary = { id: "s", type: "salary", owner: "spouse", annualAmount: "40000.00", endYear: 2099 };
    open(PAUL, [{ ...CYNTHIA_RAW, piaMonthly: null }, salary]);
    expect(screen.getByText(/Cynthia's spousal top-up: \$475\/mo/)).toBeTruthy();
    expect(screen.queryByText(NO_TOP_UP)).toBeNull();
  });

  it("says why there is no top-up only when both PIAs are above $0", () => {
    open(PAUL, [{ ...CYNTHIA_RAW, piaMonthly: "3000.00" }]);
    expect(screen.getByText(NO_TOP_UP)).toBeTruthy();
  });

  it("gives no reason when both PIAs are $0", () => {
    open({ ...PAUL, ssBenefitMode: "pia_at_fra", piaMonthly: 0 } as Income);
    fireEvent.click(screen.getByRole("radio", { name: /Primary Insurance Amount/i }));
    fireEvent.change(amountBox(), { target: { value: "0" } });
    expect(screen.getByText(/PIA \$0\/mo/)).toBeTruthy();
    expect(screen.queryByText(NO_TOP_UP)).toBeNull();
  });

  it("previews nothing while the benefit-at-age box is blank", () => {
    open();
    fireEvent.change(amountBox(), { target: { value: "" } });
    expect(screen.queryByText(/PIA \$/)).toBeNull();
    expect(screen.queryByText(NO_TOP_UP)).toBeNull();
  });
});

describe("flipping the unit under Estimate from Salary", () => {
  it("keeps the advisor's own figure for when they switch to a specific age", async () => {
    // No stored mode and no PIA opens on the estimate, holding $68,478/yr.
    const { ssBenefitMode: _mode, ...legacy } = PAUL as Income;
    void _mode;
    const salary = { id: "s", type: "salary", owner: "client", annualAmount: "100000.00", endYear: 2099 };
    open(legacy as Income, [CYNTHIA_RAW, salary]);
    expect((screen.getByRole("radio", { name: /Estimate from Salary/i }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(unitBtn("/yr"));
    expect(amountBox().value).toBe("38616"); // the estimate, $3,218/mo, shown per year
    fireEvent.click(screen.getByRole("radio", { name: /Benefit at a specific age/i }));
    expect(amountBox().value).toBe("68478");
    const body = await saved();
    expect(body.annualAmount).toBe(68478);
    expect(body.ssAmountUnit).toBe("annual");
  });
});
