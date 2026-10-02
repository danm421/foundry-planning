// @vitest-environment jsdom
/**
 * Base mode: the Net Worth page's Edit Business dialog opens on the business's
 * SAVED type, tax treatment, distribution, flow mode and notes — not the
 * form's blank defaults (llc / qbi / blank) that the old row mapping left.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: vi.fn(), scenarioActive: false }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1/details/net-worth",
}));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));

import BalanceSheetView, { type AccountRow } from "@/components/balance-sheet-view";
import { ClientAccessProvider } from "@/components/client-access-provider";

const CLIENT_OWNS = [{ kind: "family_member" as const, familyMemberId: "fm-client", percent: 1 }];

const BUSINESS: AccountRow = {
  id: "acct-biz",
  name: "Acme Widgets",
  category: "business",
  subType: "s_corp",
  owner: "client",
  value: "500000",
  basis: "100000",
  growthRate: "0.06",
  growthSource: "default",
  owners: CLIENT_OWNS,
  businessType: "s_corp",
  businessTaxTreatment: "non_taxable",
  distributionPolicyPercent: "0.4",
  flowMode: "schedule",
  notes: "Buy-sell signed 2024",
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => [] })));
});
afterEach(() => vi.unstubAllGlobals());

describe("BalanceSheetView — Edit Business loads the saved business", () => {
  it("opens on its type, tax treatment, distribution; growth stays blank for a default rate", async () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <BalanceSheetView
          clientId="c1"
          accounts={[BUSINESS]}
          liabilities={[]}
          entities={[]}
          familyMembers={[{ id: "fm-client", role: "client", firstName: "Alice" }]}
          categoryDefaults={{
            taxable: "0.07", cash: "0.02", retirement: "0.07", annuity: "0.05",
            real_estate: "0.04", business: "0.06", stock_options: "0.07",
            life_insurance: "0.03", notes_receivable: "0.05", education_savings: "0.07",
          }}
          ownerNames={{ clientName: "Alice Test", spouseName: null }}
        />
      </ClientAccessProvider>,
    );

    fireEvent.click(screen.getByText("Business"));
    await act(async () => {
      fireEvent.click(screen.getByText("Acme Widgets"));
    });

    expect((document.getElementById("biz-type") as HTMLSelectElement).value).toBe("s_corp");
    expect((document.getElementById("biz-tax") as HTMLSelectElement).value).toBe("non_taxable");
    expect((document.getElementById("biz-distpct") as HTMLInputElement).value).toBe("40");
    expect((document.getElementById("biz-growth") as HTMLInputElement).value).toBe("");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Notes" }));
    });
    expect((document.getElementById("biz-notes") as HTMLTextAreaElement).value).toBe(
      "Buy-sell signed 2024",
    );
  });
});
