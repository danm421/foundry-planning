// @vitest-environment jsdom
/**
 * R1 for the debt dialog's Amortization tab, which the Solver's Edit → Debt
 * opens. Extra payments live in `liability_extra_payments`, which has no
 * scenario column: adding or removing one inside a scenario silently changed
 * the base plan for every scenario. Inside a scenario the tab is read-only
 * under the base-only note (the base extra payments every scenario inherits
 * still show); in base mode it still writes.
 *
 * Scenario state is driven through the URL; `use-scenario-writer` is real.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let searchParams = new URLSearchParams("");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/c1/solver",
}));

// Chart.js needs a real canvas; the chart is not what these tests are about.
vi.mock("react-chartjs-2", () => ({ Line: () => null }));

import AddLiabilityDialog from "@/components/add-liability-dialog";
import type { LiabilityFormInitial } from "@/components/forms/add-liability-form";

const YEAR = new Date().getFullYear();

const MORTGAGE: LiabilityFormInitial = {
  id: "liab-1",
  name: "Home Mortgage",
  balance: "300000",
  interestRate: "0.05",
  monthlyPayment: "2500",
  startYear: YEAR - 2,
  startMonth: 1,
  termMonths: 360,
  termUnit: "monthly",
  forgiveAtTermEnd: false,
};

const EXTRA = { id: "ep-1", liabilityId: "liab-1", year: YEAR + 1, type: "lump_sum", amount: "10000" };

let fetchMock: ReturnType<typeof vi.fn>;
const requests = () =>
  fetchMock.mock.calls.map(
    ([url, init]) => `${((init as RequestInit | undefined)?.method ?? "GET").toUpperCase()} ${String(url)}`,
  );

function renderDialog() {
  render(<AddLiabilityDialog clientId="c1" open onOpenChange={vi.fn()} editing={MORTGAGE} />);
  fireEvent.click(screen.getByRole("button", { name: "Amortization" }));
}

beforeEach(() => {
  searchParams = new URLSearchParams("");
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    if (method === "GET") return { ok: true, json: async () => [EXTRA] };
    return { ok: true, json: async () => ({ ...EXTRA, id: "ep-2", year: YEAR + 2 }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Debt dialog → Amortization tab", () => {
  it("inside a scenario: read-only under the base-only note; only the extra-payment read is sent", async () => {
    searchParams = new URLSearchParams("scenario=scn-1");
    renderDialog();

    expect(await screen.findByText("Available on the base plan.")).toBeInTheDocument();
    // The base extra payment the scenario inherits still shows…
    expect(await screen.findAllByText("$10,000")).not.toHaveLength(0);
    // …but nothing can add or remove one.
    expect(screen.queryByRole("button", { name: "+ add" })).toBeNull();
    expect(screen.queryByTitle("Remove extra payment")).toBeNull();
    expect(requests()).toEqual(["GET /api/clients/c1/liabilities/liab-1/extra-payments"]);
  });

  it("on the base plan: + add still POSTs an extra payment", async () => {
    renderDialog();

    const add = (await screen.findAllByRole("button", { name: "+ add" }))[0];
    expect(screen.queryByText("Available on the base plan.")).toBeNull();
    fireEvent.click(add);
    fireEvent.change(screen.getByPlaceholderText("$"), { target: { value: "5000" } });
    fireEvent.click(screen.getByTitle("Save"));

    await waitFor(() =>
      expect(requests()).toContain("POST /api/clients/c1/liabilities/liab-1/extra-payments"),
    );
  });

  it("on the base plan: × still DELETEs an extra payment", async () => {
    renderDialog();

    fireEvent.click(await screen.findByTitle("Remove extra payment"));

    await waitFor(() =>
      expect(requests()).toContain("DELETE /api/clients/c1/liabilities/liab-1/extra-payments/ep-1"),
    );
  });
});
