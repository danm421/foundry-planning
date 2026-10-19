// src/lib/fact-finder/save/__tests__/writers-index.test.ts
import { describe, expect, it } from "vitest";
import { TARGET_KINDS, type TargetKind } from "../../change-set";
import { SaveLineError, type SaveContext, type SaveInput, type SaveWriter } from "../types";
import { SAVE_WRITERS } from "../writers";
import { ACCOUNT_WRITERS } from "../writers/accounts";
import { ANNUITY_STOCK_WRITERS } from "../writers/annuities-stock-options";
import { CASH_FLOW_WRITERS } from "../writers/cash-flow";
import { DESIGNATION_WRITERS } from "../writers/designations";
import { DISABILITY_LTC_WRITERS } from "../writers/disability-ltc";
import { GIFT_WRITERS } from "../writers/gifts";
import { HOUSEHOLD_WRITERS } from "../writers/household";
import { LIABILITY_WRITERS } from "../writers/liabilities";
import { LIFE_WRITERS } from "../writers/life-insurance";
import { NOTE_WRITERS } from "../writers/notes-receivable";
import { PEOPLE_NOTE_WRITERS } from "../writers/people-notes";
import { TRUST_WRITERS } from "../writers/trusts";
import { WILL_WRITERS } from "../writers/wills";

const AREAS: Partial<Record<TargetKind, SaveWriter>>[] = [
  HOUSEHOLD_WRITERS, PEOPLE_NOTE_WRITERS, TRUST_WRITERS, ACCOUNT_WRITERS, ANNUITY_STOCK_WRITERS, NOTE_WRITERS,
  LIABILITY_WRITERS, CASH_FLOW_WRITERS, LIFE_WRITERS, DISABILITY_LTC_WRITERS, DESIGNATION_WRITERS, WILL_WRITERS, GIFT_WRITERS,
];

describe("SAVE_WRITERS", () => {
  it("has a writer for every change-set target, and nothing else", () => {
    expect(Object.keys(SAVE_WRITERS).sort()).toEqual([...TARGET_KINDS].sort());
    for (const target of TARGET_KINDS) {
      expect(typeof SAVE_WRITERS[target].create, target).toBe("function");
      expect(typeof SAVE_WRITERS[target].update, target).toBe("function");
    }
  });

  it("each target's writer is its area's, and no two areas write one target", () => {
    const owners = new Map<string, number>();
    for (const area of AREAS) {
      for (const [target, writer] of Object.entries(area)) {
        owners.set(target, (owners.get(target) ?? 0) + 1);
        expect(SAVE_WRITERS[target as TargetKind], target).toBe(writer);
      }
    }
    expect([...owners.keys()].sort()).toEqual([...TARGET_KINDS].sort());
    expect([...owners.values()].every((n) => n === 1)).toBe(true);
  });
});

describe("ANNUITY_STOCK_WRITERS", () => {
  // Before any write: the line is refused in plain words, which the save answers 422 naming the line.
  const ctx = {} as SaveContext;
  const input = (over: Partial<SaveInput>) => ({ line: {}, values: {}, body: {}, recordId: null, parentId: null, ...over }) as SaveInput;

  it("refuses a line that names no record or parent as a line the save can't write, not a crash", async () => {
    await expect(ANNUITY_STOCK_WRITERS.annuity_contract.create(ctx, input({}))).rejects.toThrow(new SaveLineError("This line names no annuity account."));
    await expect(ANNUITY_STOCK_WRITERS.stock_option_account.update(ctx, input({}))).rejects.toThrow(new SaveLineError("This line names no account."));
    await expect(ANNUITY_STOCK_WRITERS.stock_option_grant.update(ctx, input({ parentId: "acct-1" }))).rejects.toThrow(new SaveLineError("This line names no grant."));
  });
});
