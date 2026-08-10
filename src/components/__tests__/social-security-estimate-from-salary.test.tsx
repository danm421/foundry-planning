// @vitest-environment jsdom
/**
 * "Estimate from Salary" in the Social Security dialog.
 *
 * The mechanic under test: the estimate is a way to FILL the shared Monthly PIA
 * box, not a fourth stored benefit mode. So the assertions that matter are
 *   (a) it is the opening choice for a row that has no PIA yet,
 *   (b) the computed figure survives a switch to "Primary Insurance Amount", and
 *   (c) what SAVES is `pia_at_fra` — no reader ever sees a new mode string.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { Income, ClientInfo, PlanSettings } from "@/engine/types";
import type { SalaryLike } from "@/lib/social-security/estimate-from-salary";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

/** Untyped on purpose: the assertions below read the base-fallback body off
 *  `mock.calls`, and a zero-arg signature types that tuple as empty. */
const submit = vi.fn();

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit, scenarioActive: false }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/c1/details/income-expenses",
}));

import { SocialSecurityDialog } from "@/components/social-security-dialog";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const CLIENT_INFO = {
  firstName: "Cooper",
  dateOfBirth: "1970-04-02",
  spouseName: "Dana",
  spouseDob: "1972-01-15",
  retirementAge: 65,
  spouseRetirementAge: 65,
} as unknown as ClientInfo;

const PLAN_SETTINGS = {} as PlanSettings;

/** The row `create-client` seeds for every new household: PIA mode, no amount. */
const SEEDED_ROW = {
  id: "ss1",
  type: "social_security",
  name: "Social Security — Cooper",
  annualAmount: 0,
  startYear: 2026,
  endYear: 2099,
  growthRate: 0.02,
  owner: "client",
  claimingAge: 67,
  claimingAgeMode: "fra",
  ssBenefitMode: "pia_at_fra",
} as unknown as Income;

const CLIENT_SALARY: SalaryLike[] = [
  { type: "salary", owner: "client", annualAmount: "100000", endYear: 2040 },
];

function renderDialog(
  existingRow: Income | null,
  incomes: SalaryLike[] = [],
  owner: "client" | "spouse" = "client",
) {
  // Only the Medicare tab fetches; the salary arrives as a prop.
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [], text: async () => "" })));
  return render(
    <SocialSecurityDialog
      clientId="c1"
      owner={owner}
      existingRow={existingRow}
      clientInfo={CLIENT_INFO}
      planSettings={PLAN_SETTINGS}
      incomes={incomes}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
}

const piaBox = () => screen.getByPlaceholderText("e.g. 2800") as HTMLInputElement;
const radio = (name: RegExp) => screen.getByRole("radio", { name }) as HTMLInputElement;

beforeEach(() => {
  submit.mockReset();
  submit.mockResolvedValue({ ok: true, text: async () => "" });
});

// ---------------------------------------------------------------------------

describe("Estimate from Salary", () => {
  it("opens as the default for a seeded row and fills the box from the salary", () => {
    // $100,000 -> AIME 8333.33 -> 0.9*1226 + 0.32*(7391-1226) + 0.15*(8333.33-7391)
    renderDialog(SEEDED_ROW, CLIENT_SALARY);

    expect(radio(/Estimate from Salary/i).checked).toBe(true);
    expect(piaBox().value).toBe("3218");
  });

  it("credits only the row owner's salary", () => {
    renderDialog(
      { ...SEEDED_ROW, owner: "spouse" } as Income,
      [
        ...CLIENT_SALARY,
        { type: "salary", owner: "spouse", annualAmount: "60000", endYear: 2040 },
      ],
      "spouse",
    );

    expect(piaBox().value).toBe("2311");
  });

  it("keeps the figure when the advisor switches to PIA, and makes it editable", () => {
    renderDialog(SEEDED_ROW, CLIENT_SALARY);
    expect(piaBox().readOnly).toBe(true);

    fireEvent.click(radio(/Primary Insurance Amount/i));

    expect(piaBox().value).toBe("3218");
    expect(piaBox().readOnly).toBe(false);

    fireEvent.change(piaBox(), { target: { value: "4000" } });
    expect(piaBox().value).toBe("4000");
  });

  it("recomputes when the advisor switches back to the estimate", () => {
    renderDialog(SEEDED_ROW, CLIENT_SALARY);

    fireEvent.click(radio(/Primary Insurance Amount/i));
    fireEvent.change(piaBox(), { target: { value: "4000" } });
    fireEvent.click(radio(/Estimate from Salary/i));

    expect(piaBox().value).toBe("3218");
  });

  it("saves as pia_at_fra — the estimate is never a stored mode", async () => {
    renderDialog(SEEDED_ROW, CLIENT_SALARY);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(submit).toHaveBeenCalled());
    const body = submit.mock.calls[0][1].body;
    expect(body.ssBenefitMode).toBe("pia_at_fra");
    expect(body.piaMonthly).toBe(3218);
  });

  it("never overwrites a PIA already on the row", () => {
    renderDialog({ ...SEEDED_ROW, piaMonthly: 3600 } as Income, CLIENT_SALARY);

    expect(radio(/Primary Insurance Amount/i).checked).toBe(true);
    expect(piaBox().value).toBe("3600");
  });

  it("prompts for a salary instead of showing a bogus $0 estimate", () => {
    renderDialog(SEEDED_ROW, []);

    expect(radio(/Estimate from Salary/i).checked).toBe(true);
    expect(screen.getByText(/No salary entered for Cooper/i)).toBeTruthy();
    expect(piaBox().value).toBe("");
  });

  it("leaves the Annual benefit and No Benefit modes alone", () => {
    renderDialog(
      { ...SEEDED_ROW, ssBenefitMode: "manual_amount", annualAmount: 30_000 } as Income,
      CLIENT_SALARY,
    );

    expect(radio(/Annual benefit amount/i).checked).toBe(true);
    expect(screen.queryByPlaceholderText("e.g. 2800")).toBeNull();
  });
});
