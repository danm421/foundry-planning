/**
 * appendProceedsToWithdrawalStrategy — inserts life-insurance proceeds accounts
 * into the effective withdrawal strategy after a death event. See spec
 * 2026-05-19-life-insurance-proceeds-taxable-routing-design.
 */
import { describe, it, expect } from "vitest";
import { appendProceedsToWithdrawalStrategy } from "../projection";
import type { Account, WithdrawalPriority } from "../types";

const accounts: Array<Pick<Account, "id" | "category">> = [
  { id: "cash-1", category: "cash" },
  { id: "tax-1", category: "taxable" },
  { id: "ret-1", category: "retirement" },
  { id: "pol-1", category: "taxable" }, // transformed proceeds account
];

describe("appendProceedsToWithdrawalStrategy", () => {
  it("inserts a proceeds entry in the taxable tier, after existing liquid accounts", () => {
    const strategy: WithdrawalPriority[] = [
      { accountId: "cash-1", priorityOrder: 1, startYear: 2026, endYear: 2066 },
      { accountId: "tax-1", priorityOrder: 2, startYear: 2026, endYear: 2066 },
      { accountId: "ret-1", priorityOrder: 3, startYear: 2026, endYear: 2066 },
    ];
    appendProceedsToWithdrawalStrategy(strategy, ["pol-1"], accounts, 2030, 2066);
    const entry = strategy.find((s) => s.accountId === "pol-1");
    expect(entry).toBeDefined();
    // strictly after the last taxable (2), strictly before retirement (3)
    expect(entry!.priorityOrder).toBeGreaterThan(2);
    expect(entry!.priorityOrder).toBeLessThan(3);
    expect(entry!.startYear).toBe(2030);
    expect(entry!.endYear).toBe(2066);
  });

  it("is idempotent — a second call does not duplicate the entry", () => {
    const strategy: WithdrawalPriority[] = [
      { accountId: "tax-1", priorityOrder: 2, startYear: 2026, endYear: 2066 },
    ];
    appendProceedsToWithdrawalStrategy(strategy, ["pol-1"], accounts, 2030, 2066);
    appendProceedsToWithdrawalStrategy(strategy, ["pol-1"], accounts, 2030, 2066);
    expect(strategy.filter((s) => s.accountId === "pol-1")).toHaveLength(1);
  });

  it("uses the cash-tier baseline when the strategy has no liquid accounts", () => {
    const strategy: WithdrawalPriority[] = [
      { accountId: "ret-1", priorityOrder: 3, startYear: 2026, endYear: 2066 },
    ];
    appendProceedsToWithdrawalStrategy(strategy, ["pol-1"], accounts, 2030, 2066);
    const entry = strategy.find((s) => s.accountId === "pol-1");
    // baseline 1 (cash tier) + 0.5 — still ahead of retirement
    expect(entry!.priorityOrder).toBe(1.5);
  });
});
