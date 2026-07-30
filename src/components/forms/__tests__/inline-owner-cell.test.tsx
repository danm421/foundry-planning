// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import InlineOwnerCell from "../inline-owner-cell";
import type { AccountOwner } from "@/engine/ownership";

const FAMILY = [
  { id: "fm-c", role: "client" as const, firstName: "Cooper" },
  { id: "fm-s", role: "spouse" as const, firstName: "Jane" },
  { id: "fm-k", role: "child" as const, firstName: "Riley" },
];
const ENTITIES = [{ id: "e1", name: "Acme LLC" }];

const soleClient: AccountOwner[] = [
  { kind: "family_member", familyMemberId: "fm-c", percent: 1 },
];
const split: AccountOwner[] = [
  { kind: "family_member", familyMemberId: "fm-c", percent: 0.7 },
  { kind: "family_member", familyMemberId: "fm-s", percent: 0.3 },
];

function setup(overrides: Partial<React.ComponentProps<typeof InlineOwnerCell>> = {}) {
  const onSave = vi.fn().mockResolvedValue(true);
  render(
    <InlineOwnerCell
      owners={soleClient}
      titlingType="jtwros"
      familyMembers={FAMILY}
      entities={ENTITIES}
      display="Cooper"
      label="owner for Schwab"
      canEdit
      onSave={onSave}
      {...overrides}
    />,
  );
  return { onSave };
}

describe("InlineOwnerCell", () => {
  it("offers a dropdown for a preset owner", () => {
    setup();
    expect(screen.getByRole("button", { name: "Change owner for Schwab" }))
      .toHaveTextContent("Cooper");
  });

  it("renders a read-only label for a percentage split — no dropdown", () => {
    setup({ owners: split, display: "70% Cooper / 30% Jane" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("70% Cooper / 30% Jane")).toBeInTheDocument();
  });

  it("renders a read-only label for a business sub-asset", () => {
    setup({ parentAccountId: "acct-biz", display: "Acme LLC" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders a read-only label when owners is undefined", () => {
    setup({ owners: undefined, display: "—" });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("offers Joint and Community Property for a normal account", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button"));
    const values = [...screen.getByRole("combobox").querySelectorAll("option")]
      .map((o) => o.value);
    expect(values).toContain("joint");
    expect(values).toContain("community_property");
  });

  it("suppresses both multi-owner options in retirementMode", async () => {
    const user = userEvent.setup();
    setup({ retirementMode: true });
    await user.click(screen.getByRole("button"));
    const values = [...screen.getByRole("combobox").querySelectorAll("option")]
      .map((o) => o.value);
    expect(values).not.toContain("joint");
    expect(values).not.toContain("community_property");
    expect(values).toContain("client");
  });

  it("saves owners and titlingType together when Community Property is picked", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    await user.click(screen.getByRole("button"));
    await user.selectOptions(screen.getByRole("combobox"), "community_property");
    expect(onSave).toHaveBeenCalledWith({
      owners: [
        { kind: "family_member", familyMemberId: "fm-c", percent: 0.5 },
        { kind: "family_member", familyMemberId: "fm-s", percent: 0.5 },
      ],
      titlingType: "community_property",
    });
  });

  it("saves a 100% entity owner", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    await user.click(screen.getByRole("button"));
    await user.selectOptions(screen.getByRole("combobox"), "ent:e1");
    expect(onSave).toHaveBeenCalledWith({
      owners: [{ kind: "entity", entityId: "e1", percent: 1 }],
      titlingType: "jtwros",
    });
  });

  it("lists non-principal family members but not the client or spouse twice", async () => {
    const user = userEvent.setup();
    setup();
    await user.click(screen.getByRole("button"));
    const values = [...screen.getByRole("combobox").querySelectorAll("option")]
      .map((o) => o.value);
    expect(values).toContain("fm:fm-k");
    expect(values).not.toContain("fm:fm-c");
    expect(values).not.toContain("fm:fm-s");
  });

  it("renders plain text when canEdit is false", () => {
    setup({ canEdit: false });
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Cooper")).toBeInTheDocument();
  });
});
