// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import WizardAssumptionsForm from "../wizard-assumptions-form";
import { ClientAccessProvider } from "@/components/client-access-provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
}));

const SETTINGS = {
  residenceState: null,
  defaultGrowthTaxable: "0.06",
  defaultGrowthRetirement: "0.07",
  defaultGrowthCash: "0.02",
  growthSourceTaxable: "custom",
  growthSourceRetirement: "custom",
  growthSourceCash: "custom",
  modelPortfolioIdTaxable: null,
  modelPortfolioIdRetirement: null,
  modelPortfolioIdCash: null,
  surplusSpendPct: "0",
  surplusSaveAccountId: null,
} as const;

function renderForm(permission: "edit" | "view" = "edit") {
  return render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <WizardAssumptionsForm
        clientId="client-1"
        settings={{ ...SETTINGS }}
        modelPortfolios={[{ id: "mp-1", name: "Balanced", blendedReturn: 0.055 }]}
        householdAccounts={[{ id: "acct-1", name: "Joint Checking" }]}
        resolvedInflationRate={0.03}
      />
    </ClientAccessProvider>,
  );
}

/** Bodies sent to a given endpoint, in call order. */
function bodiesFor(path: string) {
  const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
  return calls
    .filter(([url]) => String(url) === path)
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}

beforeEach(() => {
  global.fetch = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
  })) as unknown as typeof fetch;
});

describe("WizardAssumptionsForm", () => {
  it("renders exactly the three groups", () => {
    renderForm();
    expect(screen.getByRole("heading", { name: /state of residence/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /growth rates/i })).toBeTruthy();
    expect(screen.getByRole("heading", { name: /surplus cash flow/i })).toBeTruthy();
  });

  it("shows only Taxable, Retirement, and Cash growth rows, in that order", () => {
    renderForm();
    const rows = screen.getAllByTestId("growth-row").map((el) => el.dataset.category);
    expect(rows).toEqual(["taxable", "retirement", "cash"]);
  });

  it("offers Asset mix on Taxable and Retirement but not Cash", () => {
    renderForm();
    const optionsFor = (cat: string) =>
      Array.from(
        screen.getByTestId(`growth-source-${cat}`).querySelectorAll("option"),
      ).map((o) => (o as HTMLOptionElement).value);
    expect(optionsFor("taxable")).toContain("asset_mix");
    expect(optionsFor("retirement")).toContain("asset_mix");
    expect(optionsFor("cash")).not.toContain("asset_mix");
  });

  // Asserted against controls and tabs rather than raw text: prose matching
  // trips over the form's own tooltip copy (the residence tooltip legitimately
  // says "brackets and deductions") and would pass or fail for the wrong reason.
  it("omits every input that belongs only to the details page", () => {
    renderForm();
    for (const gone of [
      /federal rate/i,
      /state rate/i,
      /probate/i,
      /IRD tax rate/i,
      /lifetime exemption/i,
      /administrative expenses/i,
      /capital loss/i,
      /out-of-household/i,
      /covered by workplace plan/i,
    ]) {
      expect(screen.queryByLabelText(gone)).toBeNull();
    }
  });

  it("renders no tab bar — the five-tab surface stays on the details page", () => {
    renderForm();
    for (const tab of [
      /^tax rates$/i,
      /^growth & inflation$/i,
      /^savings & withdrawals$/i,
      /^deductions$/i,
      /^account groups$/i,
      /reset all accounts/i,
    ]) {
      expect(screen.queryByRole("button", { name: tab })).toBeNull();
    }
  });

  it("notes the state estate tax for a state that levies one", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByLabelText(/state of residence/i), "NY");
    expect(screen.getByTestId("estate-note").textContent).toMatch(/estate tax/i);
  });

  it("says nothing extra for a state with neither tax", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByLabelText(/state of residence/i), "TX");
    expect(screen.queryByTestId("estate-note")).toBeNull();
  });

  it("saves the plan settings, then marks the step reviewed", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.selectOptions(screen.getByLabelText(/state of residence/i), "NY");
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() =>
      expect(bodiesFor("/api/clients/client-1/plan-settings")).toHaveLength(1),
    );
    const put = bodiesFor("/api/clients/client-1/plan-settings")[0];
    expect(put.residenceState).toBe("NY");
    expect(put.growthSourceTaxable).toBe("custom");
    expect(put.defaultGrowthRetirement).toBe("0.07");
    expect(put.surplusSpendPct).toBe("0");
    // Details-page-only keys must not ride along and clobber stored values.
    expect(put).not.toHaveProperty("flatFederalRate");
    expect(put).not.toHaveProperty("probateCostRate");
    expect(put).not.toHaveProperty("defaultGrowthRealEstate");

    await waitFor(() =>
      expect(bodiesFor("/api/clients/client-1/onboarding")).toEqual([
        { assumptionsReviewed: true },
      ]),
    );
  });

  it("does not mark the step reviewed when the save fails", async () => {
    const user = userEvent.setup();
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "boom" }),
    })) as unknown as typeof fetch;
    renderForm();
    await user.click(screen.getByRole("button", { name: /save/i }));

    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/boom/i));
    expect(bodiesFor("/api/clients/client-1/onboarding")).toHaveLength(0);
  });

  it("hides Save from a viewer", () => {
    renderForm("view");
    expect(screen.queryByRole("button", { name: /save/i })).toBeNull();
  });
});
