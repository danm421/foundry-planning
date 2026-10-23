import { describe, it, expect } from "vitest";
import { buildClientData, sampleAccounts, sampleSavingsRules } from "@/engine/__tests__/fixtures";
import type { Account } from "@/engine/types";
import {
  effectiveMutations,
  isEstateMutation,
  offEntryKeys,
  removeWithDependants,
  switchGroupOf,
} from "../switch-groups";
import { mutationKey, type HeldChangeMutation, type SolverMutation } from "../types";

const SAVE = "00000000-0000-4000-8000-0000000000b1";
const OTHER_SAVE = "00000000-0000-4000-8000-0000000000b2";
const A = "00000000-0000-4000-8000-0000000000a1";
const RULE = "00000000-0000-4000-8000-0000000000d1";
const BOAT = "00000000-0000-4000-8000-0000000000e2";
const source = buildClientData();
const newAccount: Account = { ...sampleAccounts[2], id: A, name: "New brokerage" };

function heldExpense(id: string, saveId = SAVE): HeldChangeMutation {
  return {
    kind: "held-change",
    op: "add",
    targetKind: "expense",
    targetId: id,
    payload: { name: "Boat", type: "other", annualAmount: 5000, startYear: 2030, endYear: 2040, growthRate: 0 },
    saveId,
  };
}
const heldAccount: HeldChangeMutation = {
  kind: "held-change",
  op: "add",
  targetKind: "account",
  targetId: A,
  payload: newAccount,
  saveId: SAVE,
};
const rule: SolverMutation = {
  kind: "savings-rule-upsert",
  id: RULE,
  value: { ...sampleSavingsRules[0], id: RULE, accountId: A },
};

describe("switch-groups", () => {
  it("held entries from one save share a group", () => {
    const a = heldExpense(BOAT);
    const b = heldAccount;
    const c = heldExpense("x", OTHER_SAVE);
    const all = [a, b, c];
    expect(switchGroupOf(a, all, source)).toBe(`save:${SAVE}`);
    expect(switchGroupOf(b, all, source)).toBe(switchGroupOf(a, all, source));
    expect(switchGroupOf(c, all, source)).toBe(`save:${OTHER_SAVE}`);
  });

  it("ss claim age and its mode share a group", () => {
    const age: SolverMutation = { kind: "ss-claim-age", person: "client", age: 70 };
    const mode: SolverMutation = { kind: "ss-claim-age-mode", person: "client", mode: "years" };
    const spouse: SolverMutation = { kind: "ss-claim-age", person: "spouse", age: 68 };
    expect(switchGroupOf(age, [age, mode, spouse], source)).toBe("ss-claim:client");
    expect(switchGroupOf(mode, [age, mode, spouse], source)).toBe("ss-claim:client");
    expect(switchGroupOf(spouse, [age, mode, spouse], source)).toBe("ss-claim:spouse");
  });

  it("a trust removal's retitle (removedRefId) is in estate", () => {
    const retitle: SolverMutation = { kind: "account-upsert", id: "acct-x", value: null, removedRefId: "trust-1" };
    const plain: SolverMutation = { kind: "account-upsert", id: "acct-x", value: null };
    const entity: SolverMutation = { kind: "entity-upsert", id: "trust-1", value: null };
    expect(switchGroupOf(retitle, [retitle], source)).toBe("estate");
    expect(switchGroupOf(entity, [entity], source)).toBe("estate");
    expect(switchGroupOf(plain, [plain], source)).toBe(`key:${mutationKey(plain)}`);
    expect(isEstateMutation(retitle, [retitle])).toBe(true);
    expect(isEstateMutation(plain, [plain])).toBe(false);
  });

  it("an entity-owned account and a note's source account are in estate", () => {
    const owned: SolverMutation = {
      kind: "account-upsert",
      id: A,
      value: { ...newAccount, owners: [{ kind: "entity", entityId: "trust-1", percent: 1 }] },
    };
    expect(switchGroupOf(owned, [owned], source)).toBe("estate");
    const sold: SolverMutation = { kind: "account-upsert", id: "acct-sold", value: newAccount };
    const note = { kind: "note-receivable-upsert", id: "n1", value: null, sourceAccountId: "acct-sold" } as SolverMutation;
    expect(isEstateMutation(sold, [sold])).toBe(false);
    expect(isEstateMutation(sold, [sold, note])).toBe(true);
  });

  it("a solved savings account and its rule share a group", () => {
    const account: SolverMutation = { kind: "account-upsert", id: A, value: newAccount };
    const all = [account, rule];
    expect(switchGroupOf(account, all, source)).toBe(`key:account-upsert:${A}`);
    expect(switchGroupOf(rule, all, source)).toBe(`key:account-upsert:${A}`);
  });

  it("a rule on a base account keeps its own group", () => {
    const base = source.accounts[0].id;
    const r: SolverMutation = {
      kind: "savings-rule-upsert",
      id: RULE,
      value: { ...sampleSavingsRules[0], id: RULE, accountId: base },
    };
    expect(switchGroupOf(r, [r], source)).toBe(`key:${mutationKey(r)}`);
  });

  it("dependency closure: switching off a held add account turns off a rule naming it", () => {
    const other = heldExpense(BOAT, OTHER_SAVE);
    const all = [heldAccount, rule, other];
    expect(switchGroupOf(rule, all, source)).toBe(`key:${mutationKey(rule)}`);
    const off = offEntryKeys(all, new Set([`save:${SAVE}`]), source);
    expect(off).toEqual(new Set([mutationKey(heldAccount), mutationKey(rule)]));
    expect(effectiveMutations(all, new Set([`save:${SAVE}`]), source)).toEqual([other]);
  });

  it("effectiveMutations keeps order and returns the same array when nothing is off", () => {
    const a = heldExpense(BOAT);
    const b: SolverMutation = { kind: "living-expense-scale", multiplier: 1.1 };
    const c = heldExpense("x", OTHER_SAVE);
    const all = [a, b, c];
    expect(effectiveMutations(all, new Set(), source)).toBe(all);
    expect(offEntryKeys(all, new Set(), source).size).toBe(0);
    expect(effectiveMutations(all, new Set([`save:${SAVE}`]), source)).toEqual([b, c]);
  });

  it("removeWithDependants takes the rule with the account", () => {
    const other = heldExpense(BOAT);
    const all = [heldAccount, rule, other];
    expect(removeWithDependants(all, mutationKey(heldAccount), source)).toEqual([
      mutationKey(heldAccount),
      mutationKey(rule),
    ]);
    expect(removeWithDependants(all, mutationKey(other), source)).toEqual([mutationKey(other)]);
    expect(removeWithDependants(all, "missing:key" as never, source)).toEqual(["missing:key"]);
  });

  // X → Y → Z: a family member added in one save, an account owned by it added
  // in another, a savings rule on that account. Z names Y's id, never X's.
  describe("a second hop", () => {
    const F = "00000000-0000-4000-8000-0000000000f1";
    const heldMember: HeldChangeMutation = {
      kind: "held-change",
      op: "add",
      targetKind: "family_member",
      targetId: F,
      payload: { id: F, firstName: "Kim", relationship: "child" },
      saveId: "00000000-0000-4000-8000-0000000000b3",
    };
    const ownedAccount: HeldChangeMutation = {
      ...heldAccount,
      payload: { ...newAccount, owners: [{ kind: "family_member", familyMemberId: F, percent: 1 }] },
    };
    const all = [heldMember, ownedAccount, rule, heldExpense(BOAT, OTHER_SAVE)];

    it("switching off X turns off Y and Z", () => {
      expect(offEntryKeys(all, new Set([`save:${heldMember.saveId}`]), source)).toEqual(
        new Set([mutationKey(heldMember), mutationKey(ownedAccount), mutationKey(rule)]),
      );
    });

    it("discarding X takes Y and Z", () => {
      expect(removeWithDependants(all, mutationKey(heldMember), source)).toEqual([
        mutationKey(heldMember),
        mutationKey(ownedAccount),
        mutationKey(rule),
      ]);
    });
  });
});
