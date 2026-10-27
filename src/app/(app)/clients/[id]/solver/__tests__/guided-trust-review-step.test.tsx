// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ClientData } from "@/engine/types";
import {
  guidedTrustContext,
  initialAnswers,
  type GuidedTrustAnswers,
} from "@/lib/solver/guided-trust";
import { GuidedTrustReviewStep } from "../guided-trust-review-step";
import type { useGuidedTrustImpact } from "../use-guided-trust-impact";

type Impact = ReturnType<typeof useGuidedTrustImpact>;

const tree = {
  client: {
    firstName: "Alex", lastName: "Rivera", dateOfBirth: "1968-05-01",
    spouseName: "Jordan", spouseDob: "1970-03-02",
  },
  accounts: [
    { id: "a1", name: "Joint Brokerage" },
    { id: "a2", name: "Savings" },
  ],
  planSettings: { planStartYear: 2026, planEndYear: 2030 },
  familyMembers: [
    { id: "fm-1", role: "child", relationship: "child", firstName: "Sam", lastName: "Rivera" },
    { id: "fm-2", role: "child", relationship: "child", firstName: "Ava", lastName: "Rivera" },
  ],
  externalBeneficiaries: [{ id: "ch1", name: "Red Cross", kind: "charity", charityType: "public" }],
} as unknown as ClientData;
const ctx = guidedTrustContext(tree, { 2026: 19000 });

const base: GuidedTrustAnswers = {
  ...initialAnswers("e1"),
  name: "Sam Rivera Irrevocable Trust",
  lifetime: [{ person: { kind: "household", role: "spouse" }, percentage: 100 }],
  remainder: [
    { person: { kind: "family_member", id: "fm-1" }, percentage: 50 },
    { person: { kind: "family_member", id: "fm-2" }, percentage: 50 },
  ],
};
const idle: Impact = { status: "idle", before: null, after: null };
const ready: Impact = {
  status: "ready",
  before: { taxesAndCosts: 2_000_000, toHeirs: 8_000_000, finalDeathYear: 2051 },
  after: { taxesAndCosts: 1_500_000, toHeirs: 8_400_000, finalDeathYear: 2051 },
};

function setup(over: Partial<GuidedTrustAnswers> = {}, impact: Impact = idle) {
  const onChange = vi.fn();
  const onEdit = vi.fn();
  render(
    <GuidedTrustReviewStep
      answers={{ ...base, ...over }}
      ctx={ctx}
      onChange={onChange}
      onEdit={onEdit}
      impact={impact}
    />,
  );
  return { onChange, onEdit };
}

describe("GuidedTrustReviewStep", () => {
  it("shows answers.name and typing calls onChange", () => {
    const { onChange } = setup();
    const input = screen.getByLabelText("Name") as HTMLInputElement;
    expect(input.value).toBe("Sam Rivera Irrevocable Trust");
    fireEvent.change(input, { target: { value: "Family Trust" } });
    expect(onChange).toHaveBeenCalledWith({ ...base, name: "Family Trust" });
  });

  it("summarises answers and jumps back with Edit", () => {
    const { onEdit } = setup();
    expect(screen.getByText("Jordan (spouse)")).toBeTruthy();
    expect(screen.getByText("Sam (child) 50% · Ava (child) 50%")).toBeTruthy();
    expect(screen.getByText("Grantor trust · Crummey")).toBeTruthy();
    expect(screen.getByText("Irrevocable gift trust")).toBeTruthy();
    expect(screen.getByText("Not funded yet")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit Benefits now" }));
    expect(onEdit).toHaveBeenCalledWith("people");
    fireEvent.click(screen.getByRole("button", { name: "Edit Type" }));
    expect(onEdit).toHaveBeenCalledWith("type");
    fireEvent.click(screen.getByRole("button", { name: "Edit Powers" }));
    expect(onEdit).toHaveBeenCalledWith("powers");
    fireEvent.click(screen.getByRole("button", { name: "Edit Funding" }));
    expect(onEdit).toHaveBeenCalledWith("funding");
  });

  it("joins powers, names the grantor, and hides Grantor when unmarried", () => {
    setup({ crummeyPowers: true, accessibleToClient: true, grantor: "spouse" });
    expect(screen.getByText("Grantor trust · Crummey · Household can draw on it")).toBeTruthy();
    expect(screen.getByText("Jordan")).toBeTruthy();
  });

  it("hides the Grantor line when unmarried", () => {
    const single = { ...tree, client: { ...tree.client, spouseDob: undefined, spouseName: undefined } } as unknown as ClientData;
    render(
      <GuidedTrustReviewStep answers={base} ctx={guidedTrustContext(single, {})} onChange={vi.fn()} onEdit={vi.fn()} impact={idle} />,
    );
    expect(screen.queryByRole("button", { name: "Edit Grantor" })).toBeNull();
  });

  it("Edit Grantor opens the step that asks it", () => {
    const std = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit Grantor" }));
    expect(std.onEdit).toHaveBeenCalledWith("people");
    cleanup();
    const split = setup({ kind: "crt" });
    fireEvent.click(screen.getByRole("button", { name: "Edit Grantor" }));
    expect(split.onEdit).toHaveBeenCalledWith("setup");
  });

  it("revocable lists accounts", () => {
    const { onEdit } = setup({ kind: "revocable", revocableAccountIds: ["a1", "a2"] });
    expect(screen.getByText("Joint Brokerage, Savings")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit Accounts" }));
    expect(onEdit).toHaveBeenCalledWith("accounts");
    expect(screen.queryByText("Benefits now")).toBeNull();
  });

  it("CRT shows the setup summary", () => {
    const { onEdit } = setup({
      kind: "crt",
      splitInterest: {
        fundingAccountIds: [],
        newCharity: null,
        snapshot: {
          inceptionYear: 2026, inceptionValue: 1, payoutType: "unitrust", payoutPercent: 5,
          payoutAmount: null, irc7520Rate: 0.05, termType: "years", termYears: 20,
          measuringLife1Id: null, measuringLife2Id: null, charityId: "ch1",
          originalIncomeInterest: 0, originalRemainderInterest: 0,
        },
      },
    });
    expect(screen.getByText("5% unitrust · 20 years · Red Cross")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Edit Setup" }));
    expect(onEdit).toHaveBeenCalledWith("setup");
  });

  it("ready impact shows both rows with deltas", () => {
    setup({}, ready);
    expect(screen.getByText("Estimated impact")).toBeTruthy();
    expect(screen.getByText("Estate taxes & costs (both deaths)")).toBeTruthy();
    expect(screen.getByText("$2.0M → $1.5M")).toBeTruthy();
    expect(screen.getByText("-$500K").className).toMatch(/text-good/);
    expect(screen.getByText("Total to heirs · 2051")).toBeTruthy();
    expect(screen.getByText("$8.0M → $8.4M")).toBeTruthy();
    expect(screen.getByText("+$400K").className).toMatch(/text-good/);
  });

  it("shows a skeleton while loading and fallback copy on error", () => {
    const { unmount } = render(
      <GuidedTrustReviewStep answers={base} ctx={ctx} onChange={vi.fn()} onEdit={vi.fn()}
        impact={{ status: "loading", before: null, after: null }} />,
    );
    expect(screen.getByTestId("impact-skeleton")).toBeTruthy();
    unmount();
    setup({}, { status: "error", before: null, after: null });
    expect(
      screen.getByText("Couldn't estimate the impact. Add the trust and check the Total to Heirs tile."),
    ).toBeTruthy();
  });
});
