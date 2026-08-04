// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { AccountRailNav, TOTAL_KEY } from "../account-rail-nav";
import { buildAccountRail } from "@/lib/portal/account-rail";

const rail = buildAccountRail({
  assets: [
    { id: "1", name: "Checking", category: "cash", subType: "checking", last4: null, value: 10_000, isPlaidLinked: false },
    { id: "2", name: "401k", category: "retirement", subType: "401k", last4: null, value: 965_186, isPlaidLinked: false },
  ],
  debts: [
    { id: "l1", name: "Mortgage", balance: 125_000, rawBalance: 125_000, liabilityType: "mortgage", aprPercentage: null, statementBalance: null, minimumPayment: null, nextPaymentDueDate: null, isPlaidLinked: false, ownerFmIds: [], ownerEntityIds: [] },
  ],
});

describe("AccountRailNav", () => {
  it("renders the net worth hero and both group subtotals", () => {
    const { container } = render(
      <AccountRailNav rail={rail} selected={TOTAL_KEY} onSelect={vi.fn()} />,
    );
    expect(container.textContent).toContain("Total Net Worth");
    expect(container.textContent).toContain("$850,186");
    expect(container.textContent).toContain("Assets");
    expect(container.textContent).toContain("$975,186");
    expect(container.textContent).toContain("Liabilities");
  });

  it("parenthesises liability row totals and leaves asset totals plain", () => {
    const { getByRole } = render(
      <AccountRailNav rail={rail} selected={TOTAL_KEY} onSelect={vi.fn()} />,
    );
    expect(getByRole("button", { name: /Mortgage/ }).textContent).toContain("($125,000)");
    expect(getByRole("button", { name: /Cash/ }).textContent).toContain("$10,000");
    expect(getByRole("button", { name: /Cash/ }).textContent).not.toContain("(");
  });

  it("marks the selected row with aria-current", () => {
    const { getByRole } = render(
      <AccountRailNav rail={rail} selected="asset:retirement" onSelect={vi.fn()} />,
    );
    expect(getByRole("button", { name: /Retirement/ })).toHaveAttribute("aria-current", "true");
    expect(getByRole("button", { name: /Total Net Worth/ })).not.toHaveAttribute("aria-current");
  });

  it("reports the row key on click", () => {
    const onSelect = vi.fn();
    const { getByRole } = render(
      <AccountRailNav rail={rail} selected={TOTAL_KEY} onSelect={onSelect} />,
    );
    fireEvent.click(getByRole("button", { name: /Mortgage/ }));
    expect(onSelect).toHaveBeenCalledWith("liability:mortgage");
    fireEvent.click(getByRole("button", { name: /Total Net Worth/ }));
    expect(onSelect).toHaveBeenCalledWith(TOTAL_KEY);
  });

  it("gives the hero exactly one background token, and a different one when selected vs. resting", () => {
    const bgTokens = (el: HTMLElement) =>
      el.className.split(/\s+/).filter((c) => c.startsWith("bg-"));

    const selected = render(
      <AccountRailNav rail={rail} selected={TOTAL_KEY} onSelect={vi.fn()} />,
    );
    const selectedHero = selected.getByRole("button", { name: /Total Net Worth/ });
    expect(bgTokens(selectedHero)).toEqual(["bg-card-2"]);
    selected.unmount();

    const resting = render(
      <AccountRailNav rail={rail} selected="asset:cash" onSelect={vi.fn()} />,
    );
    const restingHero = resting.getByRole("button", { name: /Total Net Worth/ });
    expect(bgTokens(restingHero)).toEqual(["bg-card"]);
  });

  it("omits a group entirely when it has no rows", () => {
    const assetsOnly = buildAccountRail({
      assets: [{ id: "1", name: "Checking", category: "cash", subType: "checking", last4: null, value: 10, isPlaidLinked: false }],
      debts: [],
    });
    const { container } = render(
      <AccountRailNav rail={assetsOnly} selected={TOTAL_KEY} onSelect={vi.fn()} />,
    );
    expect(container.textContent).not.toContain("Liabilities");
  });
});
