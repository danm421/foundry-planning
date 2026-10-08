// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { Income, ClientInfo, PlanSettings } from "@/engine/types";

vi.mock("@/hooks/use-scenario-writer", () => ({ useScenarioWriter: () => ({ submit: vi.fn(), scenarioActive: false }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/c1/details/income-expenses",
}));

import { SocialSecurityCard } from "@/components/social-security-card";

afterEach(cleanup);

const DOUGLAS = {
  firstName: "Paul", dateOfBirth: "1958-02-24", spouseName: "Cynthia", spouseDob: "1960-07-16",
  retirementAge: 70, spouseRetirementAge: 65, lifeExpectancy: 95, spouseLifeExpectancy: 95,
} as unknown as ClientInfo;

const ROW = {
  id: "p", type: "social_security", name: "Social Security — Paul", annualAmount: 0,
  startYear: 2028, endYear: 2071, growthRate: 0.02, owner: "client",
  claimingAge: 70, claimingAgeMonths: 0, claimingAgeMode: "years",
} as unknown as Income;

function summary(row: Partial<Income>) {
  render(
    <SocialSecurityCard clientId="c1" clientInfo={DOUGLAS} planSettings={{} as PlanSettings}
      incomes={[{ ...ROW, ...row } as Income]} onSaved={() => {}} canEdit={false} />,
  );
  return screen.getByText(/claim 70y 0mo/).textContent;
}

describe("SocialSecurityCard summary", () => {
  it("shows a benefit stated at an age as typed, with the estimate off its PIA", () => {
    expect(summary({ ssBenefitMode: "manual_amount", annualAmount: 68478 }))
      .toBe("$68,478/yr at 70 · claim 70y 0mo · $68,478/yr est.");
  });

  it("shows a PIA as typed", () => {
    expect(summary({ ssBenefitMode: "pia_at_fra", piaMonthly: 4505 }))
      .toBe("$4,505/mo PIA · claim 70y 0mo · $68,476/yr est.");
  });

  // A raw list-GET row on "Estimate from Salary" stores no PIA; the projection
  // pays the salary estimate ($3,218/mo off $100,000), so the card says so.
  it("shows an unset PIA as the salary estimate the projection pays", () => {
    const salary = { id: "s", type: "salary", owner: "client", annualAmount: "100000.00", endYear: 2099 };
    render(
      <SocialSecurityCard clientId="c1" clientInfo={DOUGLAS} planSettings={{} as PlanSettings}
        incomes={[{ ...ROW, ssBenefitMode: "pia_at_fra", piaMonthly: null }, salary] as unknown as Income[]}
        onSaved={() => {}} canEdit={false} />,
    );
    expect(screen.getByText(/claim 70y 0mo/).textContent)
      .toBe("$3,218/mo PIA · claim 70y 0mo · $48,914/yr est.");
  });
});
