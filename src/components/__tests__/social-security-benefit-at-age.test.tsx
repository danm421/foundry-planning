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

function open(row: Income = PAUL) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [], text: async () => "" })));
  return render(
    <SocialSecurityDialog clientId="c1" owner="client" existingRow={row} clientInfo={DOUGLAS}
      planSettings={{} as PlanSettings} incomes={[CYNTHIA_RAW]} onClose={() => {}} onSaved={() => {}} />,
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
});
