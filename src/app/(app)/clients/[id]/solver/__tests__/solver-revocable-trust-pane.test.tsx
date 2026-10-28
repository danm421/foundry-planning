// @vitest-environment jsdom
//
// Revocable trust pane (Estate planning dialog) and the wizard's Accounts step.
import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Account, ClientData } from "@/engine/types";
import { guidedTrustContext, initialAnswers, type GuidedTrustAnswers } from "@/lib/solver/guided-trust";
import { GuidedTrustAccountsStep } from "../guided-trust-accounts-step";
import { SolverRevocableTrustPane } from "../solver-revocable-trust-pane";

const owner = [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }];
const acct = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, name, category: "taxable", value: 100_000, owners: owner, ...extra }) as unknown as Account;

function tree(): ClientData {
  return {
    client: { firstName: "Alex", lastName: "Rivera", dateOfBirth: "1968-05-01" },
    accounts: [
      acct("a1", "Joint Brokerage", { revocableTrustName: "Rivera RLT" }),
      acct("a2", "Savings", { value: 25_000 }),
      acct("a3", "Other Trust Acct", { revocableTrustName: "Second Trust" }),
      acct("a4", "Held By Entity", { owners: [{ kind: "entity", entityId: "e", percent: 1 }] }),
      acct("a5", "Term Policy", { category: "life_insurance" }),
    ],
    planSettings: { planStartYear: 2026, planEndYear: 2060 },
    familyMembers: [],
  } as unknown as ClientData;
}

const baseRow = { name: "Rivera RLT", isBase: true, accountIds: ["a1"] };
const addedRow = { ...baseRow, isBase: false };

function pane(over: Partial<React.ComponentProps<typeof SolverRevocableTrustPane>> = {}) {
  const props = {
    row: baseRow,
    tree: tree(),
    onSetMembership: vi.fn(),
    onRename: vi.fn(),
    onRemove: vi.fn(),
    ...over,
  };
  render(<SolverRevocableTrustPane {...props} />);
  return props;
}

describe("SolverRevocableTrustPane", () => {
  it("makes a base trust's name read-only with a note", () => {
    pane();
    expect(screen.getByLabelText(/trust name/i)).toHaveProperty("readOnly", true);
    expect(screen.getByText("Rename a base-plan trust from the Estate Planning page.")).toBeTruthy();
  });

  it("lists only eligible accounts, ticked from the row", () => {
    pane();
    expect((screen.getByRole("checkbox", { name: /joint brokerage/i }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /savings/i }) as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("checkbox", { name: /other trust acct/i })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /held by entity/i })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /term policy/i })).toBeNull();
  });

  it("unticking passes the new full set without it; ticking adds", async () => {
    const user = userEvent.setup();
    const p = pane();
    await user.click(screen.getByRole("checkbox", { name: /joint brokerage/i }));
    expect(p.onSetMembership).toHaveBeenLastCalledWith("Rivera RLT", new Set());
    await user.click(screen.getByRole("checkbox", { name: /savings/i }));
    expect(p.onSetMembership).toHaveBeenLastCalledWith("Rivera RLT", new Set(["a1", "a2"]));
  });

  it("Remove trust calls onRemove", async () => {
    const user = userEvent.setup();
    const p = pane();
    await user.click(screen.getByRole("button", { name: /remove trust/i }));
    expect(p.onRemove).toHaveBeenCalledWith("Rivera RLT");
  });

  describe("rename guard", () => {
    const rename = async (text: string) => {
      const user = userEvent.setup();
      const input = screen.getByLabelText(/trust name/i);
      await user.clear(input);
      if (text) await user.type(input, text);
      return { user, input };
    };

    it("commits a valid new name on blur", async () => {
      const p = pane({ row: addedRow });
      const { user } = await rename("Rivera Living Trust");
      await user.tab();
      expect(p.onRename).toHaveBeenCalledWith("Rivera RLT", "Rivera Living Trust");
    });

    it("commits on Enter", async () => {
      const p = pane({ row: addedRow });
      const { user } = await rename("New Name");
      await user.keyboard("{Enter}");
      expect(p.onRename).toHaveBeenCalledWith("Rivera RLT", "New Name");
    });

    it("rejects a blank name, shows the error, reverts on blur", async () => {
      const p = pane({ row: addedRow });
      const { user, input } = await rename("");
      await user.tab();
      expect(p.onRename).not.toHaveBeenCalled();
      expect(screen.getByText("Name the trust.")).toBeTruthy();
      expect((input as HTMLInputElement).value).toBe("Rivera RLT");
    });

    it("rejects another trust's name case-insensitively", async () => {
      const p = pane({ row: addedRow });
      const { user, input } = await rename("  second TRUST ");
      await user.tab();
      expect(p.onRename).not.toHaveBeenCalled();
      expect(screen.getByText("Another trust already uses that name.")).toBeTruthy();
      expect((input as HTMLInputElement).value).toBe("Rivera RLT");
    });

    it("does nothing when the name is unchanged", async () => {
      const p = pane({ row: addedRow });
      const { user } = await rename("Rivera RLT");
      await user.tab();
      expect(p.onRename).not.toHaveBeenCalled();
    });
  });
});

describe("GuidedTrustAccountsStep", () => {
  const ctx = guidedTrustContext(tree(), { 2026: 19000 });
  function Host({ onEmit, start }: { onEmit: (a: GuidedTrustAnswers) => void; start?: Partial<GuidedTrustAnswers> }) {
    const [answers, setAnswers] = useState<GuidedTrustAnswers>({ ...initialAnswers("e1"), kind: "revocable", ...start });
    onEmit(answers);
    return <GuidedTrustAccountsStep answers={answers} ctx={ctx} onChange={setAnswers} />;
  }

  it("lists only untagged eligible accounts and shows the default name", () => {
    render(<Host onEmit={() => {}} />);
    expect(screen.getByRole("checkbox", { name: /savings/i })).toBeTruthy();
    expect(screen.queryByRole("checkbox", { name: /joint brokerage/i })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /held by entity/i })).toBeNull();
    expect((screen.getByLabelText(/trust name/i) as HTMLInputElement).value).toBe("Rivera Family Revocable Trust");
    expect(screen.getByText(/Accounts skip probate\. You keep full control/)).toBeTruthy();
  });

  it("does not emit on render, then writes the default name with the first tick", async () => {
    const user = userEvent.setup();
    const seen: GuidedTrustAnswers[] = [];
    render(<Host onEmit={(a) => seen.push(a)} />);
    expect(seen.every((a) => a.name === "")).toBe(true);
    await user.click(screen.getByRole("checkbox", { name: /savings/i }));
    const last = seen[seen.length - 1];
    expect(last.revocableAccountIds).toEqual(["a2"]);
    expect(last.name).toBe("Rivera Family Revocable Trust");
  });

  it("typing a name keeps what was typed", async () => {
    const user = userEvent.setup();
    const seen: GuidedTrustAnswers[] = [];
    render(<Host onEmit={(a) => seen.push(a)} />);
    await user.type(screen.getByLabelText(/trust name/i), "X");
    expect(seen[seen.length - 1].name.endsWith("X")).toBe(true);
  });
});
