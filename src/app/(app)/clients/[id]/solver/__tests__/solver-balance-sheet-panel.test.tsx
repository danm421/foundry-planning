// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ClientData, ProjectionYear } from "@/engine";

// The household summary panel renders a Chart.js Pie; stub it so jsdom never
// touches <canvas> (same stub as balance-sheet-report.test.tsx).
vi.mock("react-chartjs-2", () => ({ Pie: () => <div data-testid="pie" /> }));

import { SolverBalanceSheetPanel } from "../solver-balance-sheet-panel";

const workingTree = {
  client: { firstName: "Pat", lastName: "Lee" },
  familyMembers: [
    { id: "fm-c", role: "client", relationship: "self", firstName: "Pat", lastName: null, dateOfBirth: null },
  ],
  accounts: [
    {
      id: "a1",
      name: "Checking",
      category: "cash",
      owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
      titlingType: null,
    },
  ],
  liabilities: [],
  entities: [],
  notesReceivable: [],
} as unknown as ClientData;

function makeYear(
  year: number,
  beginning: number,
  ending: number = beginning,
  extra: Record<string, unknown> = {},
): ProjectionYear {
  return {
    year,
    ages: { client: 64 + (year - 2026) },
    portfolioAssets: { cash: {}, taxable: {}, retirement: {}, realEstate: {}, business: {}, lifeInsurance: {}, total: 0 },
    accountLedgers: { a1: { beginningValue: beginning, endingValue: ending } },
    liabilityBalancesBoY: {},
    ...extra,
  } as unknown as ProjectionYear;
}

const years = [makeYear(2026, 90_000, 100_000), makeYear(2031, 150_000)];

describe("SolverBalanceSheetPanel", () => {
  it("renders the balance sheet from the working tree, defaulting to Today", () => {
    render(
      <SolverBalanceSheetPanel workingTree={workingTree} years={years} clientName="Pat" spouseName="Spouse" />,
    );
    expect(screen.getByText("Checking")).toBeInTheDocument();
    // Today = first projection year's beginning-of-year value.
    expect(screen.getAllByText("$90,000").length).toBeGreaterThan(0);
  });

  it("shows future years through the year picker", () => {
    render(
      <SolverBalanceSheetPanel workingTree={workingTree} years={years} clientName="Pat" spouseName="Spouse" />,
    );
    expect(screen.getByRole("option", { name: "2031 · 69" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2031" } });
    expect(screen.getAllByText("$150,000").length).toBeGreaterThan(0);
  });

  it("hides spouse columns when the household has no spouse", () => {
    render(
      <SolverBalanceSheetPanel workingTree={workingTree} years={years} clientName="Pat" spouseName="Spouse" />,
    );
    expect(screen.queryByRole("columnheader", { name: "Spouse" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: "Joint" })).toBeNull();
  });

  it("merges engine-minted synthetic accounts from the projection", () => {
    const synthYears = [
      makeYear(2026, 90_000, 100_000, {
        accountLedgers: {
          a1: { beginningValue: 90_000, endingValue: 100_000 },
          syn1: { beginningValue: 5_000, endingValue: 5_000 },
        },
        syntheticAccounts: [
          {
            id: "syn1",
            name: "Vested Shares",
            category: "taxable",
            owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
          },
        ],
      }),
    ];
    render(
      <SolverBalanceSheetPanel workingTree={workingTree} years={synthYears} clientName="Pat" spouseName="Spouse" />,
    );
    expect(screen.getByText("Vested Shares")).toBeInTheDocument();
  });

  it("renders an empty state instead of crashing when the projection is empty", () => {
    render(
      <SolverBalanceSheetPanel workingTree={workingTree} years={[]} clientName="Pat" spouseName="Spouse" />,
    );
    expect(screen.getByText(/no projection/i)).toBeInTheDocument();
  });
});
