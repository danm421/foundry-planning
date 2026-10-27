// @vitest-environment jsdom
//
// Wizard Setup step (CRT / CLT): the split-interest form reports answers upward,
// defers a typed-in charity, and a CLT also asks who gets what's left.
import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Account, ClientData } from "@/engine/types";
import {
  guidedTrustContext,
  initialAnswers,
  stepBlocker,
  type GuidedTrustAnswers,
} from "@/lib/solver/guided-trust";
import { GuidedTrustSetupStep } from "../guided-trust-setup-step";

const CHARITY = "11111111-1111-4111-8111-111111111111";

function tree(): ClientData {
  return {
    client: {
      firstName: "Alex", lastName: "Rivera", dateOfBirth: "1968-05-01",
      spouseName: "Jordan", spouseDob: "1970-03-02",
    },
    accounts: [
      {
        id: "a-brk", name: "Joint Brokerage", category: "taxable", value: 640_000,
        owners: [{ kind: "family_member", familyMemberId: "fm-c", percent: 1 }],
      } as unknown as Account,
    ],
    planSettings: { planStartYear: 2026, planEndYear: 2060 },
    familyMembers: [
      { id: "fm-c", role: "client", relationship: "other", firstName: "Alex", lastName: "Rivera", dateOfBirth: "1968-05-01" },
      { id: "fm-s", role: "spouse", relationship: "other", firstName: "Jordan", lastName: "Rivera", dateOfBirth: "1970-03-02" },
      { id: "fm-1", role: "child", relationship: "child", firstName: "Sam", lastName: "Rivera" },
    ],
    externalBeneficiaries: [{ id: CHARITY, name: "Red Cross", kind: "charity", charityType: "public" }],
  } as unknown as ClientData;
}

const ctx = guidedTrustContext(tree(), { 2026: 19000 });

function Host({
  kind,
  onEmit,
}: {
  kind: "crt" | "clt";
  onEmit: (a: GuidedTrustAnswers) => void;
}) {
  const [answers, setAnswers] = useState<GuidedTrustAnswers>({ ...initialAnswers("e1"), kind });
  onEmit(answers);
  return <GuidedTrustSetupStep answers={answers} ctx={ctx} onChange={setAnswers} />;
}

const pickFunding = async (user: ReturnType<typeof userEvent.setup>) => {
  const trigger = screen.getAllByRole("button").find((b) => b.getAttribute("aria-haspopup") === "dialog")!;
  await user.click(trigger);
  await user.click(screen.getByRole("checkbox", { name: /joint brokerage/i }));
};

async function completeSplit(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(screen.getByLabelText(/remainder charity|charitable beneficiary/i), CHARITY);
  await pickFunding(user);
}

describe("GuidedTrustSetupStep", () => {
  it("adding a new charity defers it: selected as '(new)', recorded as pending, nothing else emitted", async () => {
    const user = userEvent.setup();
    let last!: GuidedTrustAnswers;
    render(<Host kind="crt" onEmit={(a) => (last = a)} />);
    await user.type(screen.getByLabelText(/new charity/i), "Local Food Bank");
    await user.click(screen.getByRole("button", { name: "Add" }));
    const select = screen.getByLabelText(/remainder charity|charitable beneficiary/i) as HTMLSelectElement;
    expect(screen.getByRole("option", { name: "Local Food Bank (new)" })).toBeTruthy();
    expect(select.selectedOptions[0].textContent).toBe("Local Food Bank (new)");
    // Still blocked on funding, so no answers — but the draft is held locally.
    expect(last.splitInterest).toBeNull();
    await pickFunding(user);
    expect(last.splitInterest?.newCharity).toMatchObject({ name: "Local Food Bank", charityType: "public" });
    expect(last.splitInterest?.snapshot.charityId).toBe(last.splitInterest?.newCharity?.id);
  });

  it("a second new charity replaces the first", async () => {
    const user = userEvent.setup();
    render(<Host kind="crt" onEmit={() => {}} />);
    for (const n of ["First Fund", "Second Fund"]) {
      await user.type(screen.getByLabelText(/new charity/i), n);
      await user.click(screen.getByRole("button", { name: "Add" }));
    }
    expect(screen.queryByRole("option", { name: "First Fund (new)" })).toBeNull();
    expect(screen.getByRole("option", { name: "Second Fund (new)" })).toBeTruthy();
  });

  it("a complete CRT reports answers with the funded accounts", async () => {
    const user = userEvent.setup();
    let last!: GuidedTrustAnswers;
    render(<Host kind="crt" onEmit={(a) => (last = a)} />);
    expect(screen.getByText("Select (or add) a remainder charity.")).toBeTruthy();
    await completeSplit(user);
    expect(last.splitInterest?.fundingAccountIds).toEqual(["a-brk"]);
    expect(last.splitInterest?.snapshot.charityId).toBe(CHARITY);
    expect(last.splitInterest?.newCharity).toBeNull();
    expect(stepBlocker("setup", last, ctx)).toBeNull();
    expect(screen.queryByLabelText(/gets what.s left/i)).toBeNull();
  });

  it("a CLT stays blocked until someone gets what's left", async () => {
    const user = userEvent.setup();
    let last!: GuidedTrustAnswers;
    render(<Host kind="clt" onEmit={(a) => (last = a)} />);
    await completeSplit(user);
    expect(last.splitInterest).not.toBeNull();
    expect(stepBlocker("setup", last, ctx)).toMatch(/who gets what.s left/i);
    await user.click(screen.getByRole("button", { name: /^Sam/ }));
    expect(last.remainder).toHaveLength(1);
    expect(stepBlocker("setup", last, ctx)).toBeNull();
  });

  it("changing the grantor is written to the answers", async () => {
    const user = userEvent.setup();
    let last!: GuidedTrustAnswers;
    render(<Host kind="crt" onEmit={(a) => (last = a)} />);
    await user.selectOptions(screen.getByLabelText(/grantor/i), "spouse");
    expect(last.grantor).toBe("spouse");
  });
});
