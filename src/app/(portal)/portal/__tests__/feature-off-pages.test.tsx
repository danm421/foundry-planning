// @vitest-environment jsdom
// The client's half of the section switches. These three routes stay reachable
// by bookmark and browser autocomplete long after they leave the rail, so they
// must say the section is not part of this portal — not 404, which reads as a
// broken portal rather than a smaller one.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const featureEnabledMock = vi.fn<() => Promise<boolean>>();
vi.mock("@/lib/portal/load-features", async (importOriginal) => {
  // portalFeatureColumns is a real column map the documents page spreads into
  // its select — only the gate itself is stubbed.
  const actual = await importOriginal<typeof import("@/lib/portal/load-features")>();
  return { ...actual, isPortalFeatureEnabled: () => featureEnabledMock() };
});

vi.mock("@/lib/authz", () => ({
  requireClientPortalAccess: () => Promise.resolve({ clientId: "c1" }),
}));

// The documents page reads its own client row rather than calling the gate.
let documentsEnabled = true;
vi.mock("@/db", () => ({
  db: {
    select: () => {
      const chain: Record<string, unknown> = {};
      chain.from = () => chain;
      chain.where = () => chain;
      chain.limit = () => chain;
      chain.then = (resolve: (v: unknown) => unknown) =>
        resolve([
          {
            portalEditEnabled: true,
            portalInvestmentsEnabled: true,
            portalBudgetEnabled: true,
            portalDocumentsEnabled: documentsEnabled,
            portalCalculatorsEnabled: true,
          },
        ]);
      return chain;
    },
  },
}));
vi.mock("@/db/schema", () => ({ clients: {} }));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));

vi.mock("@/components/portal/portal-investments-screen", () => ({
  PortalInvestmentsScreen: () => <div data-testid="screen-investments" />,
}));
vi.mock("@/components/portal/portal-documents-screen", () => ({
  PortalDocumentsScreen: () => <div data-testid="screen-documents" />,
}));
vi.mock("@/components/portal/budget-tabs", () => ({
  default: () => <div data-testid="budget-tabs" />,
}));
vi.mock("@/components/portal/calculators-screen", () => ({
  CalculatorsScreen: () => <div data-testid="screen-calculators" />,
}));

import InvestmentsPage from "../investments/page";
import DocumentsPage from "../documents/page";
import BudgetLayout from "../budget/layout";
import CalculatorsPage from "../calculators/page";

beforeEach(() => {
  featureEnabledMock.mockReset();
  featureEnabledMock.mockResolvedValue(true);
  documentsEnabled = true;
});

describe("a switched-off portal section", () => {
  it("tells the client instead of rendering Investments", async () => {
    featureEnabledMock.mockResolvedValue(false);
    const { container } = render(await InvestmentsPage());
    expect(container.textContent).toContain("Not part of your portal");
    expect(container.textContent).toContain("Investments");
    expect(container.querySelector("[data-testid='screen-investments']")).toBeNull();
  });

  it("tells the client instead of rendering Documents", async () => {
    documentsEnabled = false;
    const { container } = render(await DocumentsPage());
    expect(container.textContent).toContain("Not part of your portal");
    expect(container.querySelector("[data-testid='screen-documents']")).toBeNull();
  });

  // The gate is in the layout precisely so the tab strip goes with it.
  it("drops the Budget tab strip along with its children", async () => {
    featureEnabledMock.mockResolvedValue(false);
    const { container } = render(
      await BudgetLayout({ children: <div data-testid="budget-child" /> }),
    );
    expect(container.textContent).toContain("Not part of your portal");
    expect(container.querySelector("[data-testid='budget-tabs']")).toBeNull();
    expect(container.querySelector("[data-testid='budget-child']")).toBeNull();
  });

  it("tells the client instead of rendering Calculators", async () => {
    featureEnabledMock.mockResolvedValue(false);
    const { container } = render(await CalculatorsPage());
    expect(container.textContent).toContain("Not part of your portal");
    expect(container.textContent).toContain("Calculators");
    expect(container.querySelector("[data-testid='screen-calculators']")).toBeNull();
  });
});

describe("a switched-on portal section", () => {
  it("renders each section normally", async () => {
    const inv = render(await InvestmentsPage());
    expect(inv.container.querySelector("[data-testid='screen-investments']")).toBeTruthy();

    const docs = render(await DocumentsPage());
    expect(docs.container.querySelector("[data-testid='screen-documents']")).toBeTruthy();

    const budget = render(
      await BudgetLayout({ children: <div data-testid="budget-child" /> }),
    );
    expect(budget.container.querySelector("[data-testid='budget-tabs']")).toBeTruthy();
    expect(budget.container.querySelector("[data-testid='budget-child']")).toBeTruthy();

    const calc = render(await CalculatorsPage());
    expect(calc.container.querySelector("[data-testid='screen-calculators']")).toBeTruthy();
  });
});
