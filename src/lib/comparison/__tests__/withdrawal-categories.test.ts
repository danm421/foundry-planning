import { describe, it, expect } from "vitest";
import {
  buildAccountSourceMap,
  type WithdrawalSourceCategory,
} from "../withdrawal-categories";
import type { Account } from "@/engine/types";

const acct = (
  id: string,
  category: Account["category"],
  subType: string,
): Account =>
  ({
    id,
    name: id,
    category,
    subType,
    value: 0,
    basis: 0,
    growthRate: 0,
    rmdEnabled: false,
  }) as Account;

describe("buildAccountSourceMap", () => {
  it("maps roth_ira → roth-withdrawal", () => {
    const map = buildAccountSourceMap([acct("a", "retirement", "roth_ira")]);
    expect(map.a).toBe<WithdrawalSourceCategory>("roth-withdrawal");
  });

  it("maps traditional_ira, 401k, 403b → ira-rmd", () => {
    const map = buildAccountSourceMap([
      acct("a", "retirement", "traditional_ira"),
      acct("b", "retirement", "401k"),
      acct("c", "retirement", "403b"),
    ]);
    expect(map.a).toBe<WithdrawalSourceCategory>("ira-rmd");
    expect(map.b).toBe<WithdrawalSourceCategory>("ira-rmd");
    expect(map.c).toBe<WithdrawalSourceCategory>("ira-rmd");
  });

  it("maps taxable → taxable-withdrawal", () => {
    const map = buildAccountSourceMap([acct("a", "taxable", "brokerage")]);
    expect(map.a).toBe<WithdrawalSourceCategory>("taxable-withdrawal");
  });

  it("maps cash → taxable-withdrawal (groups with brokerage for source view)", () => {
    const map = buildAccountSourceMap([acct("a", "cash", "checking")]);
    expect(map.a).toBe<WithdrawalSourceCategory>("taxable-withdrawal");
  });

  it("maps real_estate, business, life_insurance → other", () => {
    const map = buildAccountSourceMap([
      acct("a", "real_estate", "primary_residence"),
      acct("b", "business", "llc"),
      acct("c", "life_insurance", "term"),
    ]);
    expect(map.a).toBe<WithdrawalSourceCategory>("other");
    expect(map.b).toBe<WithdrawalSourceCategory>("other");
    expect(map.c).toBe<WithdrawalSourceCategory>("other");
  });
});
