// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import type { ClientMilestones } from "@/lib/milestones";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1",
}));

import AddTransferForm from "../add-transfer-form";
import AddReinvestmentForm from "../add-reinvestment-form";
import AddRothConversionForm from "../add-roth-conversion-form";
import AddAssetTransactionForm from "../add-asset-transaction-form";
import SellToTrustDialog from "../sell-to-trust-dialog";
import type { Entity } from "@/components/family-view";

// "Start the plan next year": in October 2026, a plan that starts in 2027 must
// not default a new one-time item to 2026 — it would be dated in the year the
// plan treats as already done and never run.

const MILESTONES = { planStart: 2027, planEnd: 2060, clientRetirement: 2035, clientEnd: 2060 } as ClientMilestones;
const noop = () => {};
const yearOf = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T15:00:00Z"));
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("new one-time items default to the plan's start year", () => {
  it("a transfer", () => {
    render(<AddTransferForm clientId="c1" accounts={[]} milestones={MILESTONES} onClose={noop} onSaved={noop} />);
    expect(yearOf("transfer-startYear")).toBe("2027");
  });

  it("a reinvestment", () => {
    render(<AddReinvestmentForm clientId="c1" accounts={[]} modelPortfolios={[]} milestones={MILESTONES} onClose={noop} onSaved={noop} />);
    expect(yearOf("reinvestment-year")).toBe("2027");
  });

  it("a Roth conversion", () => {
    render(<AddRothConversionForm clientId="c1" accounts={[]} milestones={MILESTONES} onClose={noop} onSaved={noop} />);
    expect(yearOf("rc-startYear")).toBe("2027");
  });

  it("an asset sale or purchase", () => {
    render(<AddAssetTransactionForm clientId="c1" accounts={[]} liabilities={[]} milestones={MILESTONES} onClose={noop} onSaved={noop} />);
    expect(yearOf("txn-year")).toBe("2027");
  });

  it("a sale to a trust", () => {
    const trust = { id: "t1", name: "IDGT", entityType: "trust", isIrrevocable: true, isGrantor: true, owners: [] } as unknown as Entity;
    render(<SellToTrustDialog clientId="c1" scenarioId="s1" trust={trust} accounts={[]} planStartYear={2027} />);
    fireEvent.click(screen.getByRole("button", { name: "Sell an asset to the trust" }));
    expect(yearOf("sell-start-year")).toBe("2027");
  });

  it("this year when the plan starts this year", () => {
    render(<AddTransferForm clientId="c1" accounts={[]} onClose={noop} onSaved={noop} />);
    expect(screen.getByDisplayValue("2026")).toBeInTheDocument();
  });
});
