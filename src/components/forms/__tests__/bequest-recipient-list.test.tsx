// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BequestRecipientList, { type BequestRecipient } from "../bequest-recipient-list";
import type {
  WillsPanelEntity,
  WillsPanelExternal,
  WillsPanelFamilyMember,
  WillsPanelPrimary,
} from "@/components/wills-panel";

const primary: WillsPanelPrimary = {
  firstName: "Cooper",
  lastName: "Smith",
  spouseName: "Sarah",
  spouseLastName: "Smith",
};
const noSpouse: WillsPanelPrimary = {
  firstName: "Cooper",
  lastName: "Smith",
  spouseName: null,
  spouseLastName: null,
};
const familyMembers: WillsPanelFamilyMember[] = [
  { id: "f1", firstName: "Sophia", lastName: "Smith" },
  { id: "f2", firstName: "Marcus", lastName: null },
];
const externals: WillsPanelExternal[] = [{ id: "e1", name: "Stanford" }];
const entities: WillsPanelEntity[] = [{ id: "t1", name: "Family Trust" }];

describe("BequestRecipientList — asset mode", () => {
  it("renders Household, Family, External, and Entity optgroups with real names", () => {
    const rows: BequestRecipient[] = [
      { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
    ];
    render(
      <BequestRecipientList
        mode="asset"
        rows={rows}
        onChange={() => {}}
        primary={primary}
        familyMembers={familyMembers}
        externalBeneficiaries={externals}
        entities={entities}
      />,
    );
    const select = screen.getByRole("combobox", { name: /Recipient 1/i });
    const optgroups = Array.from(select.querySelectorAll("optgroup")).map(
      (g) => (g as HTMLOptGroupElement).label,
    );
    expect(optgroups).toEqual(["Household", "Family", "External", "Entity"]);

    const optionLabels = Array.from(select.querySelectorAll("option")).map(
      (o) => (o as HTMLOptionElement).textContent ?? "",
    );
    expect(optionLabels.some((l) => l.includes("Sarah"))).toBe(true);
    expect(optionLabels.some((l) => l.includes("Sophia Smith"))).toBe(true);
    expect(optionLabels.some((l) => l.includes("Marcus"))).toBe(true);
    expect(optionLabels.some((l) => l.includes("Stanford"))).toBe(true);
    expect(optionLabels.some((l) => l.includes("Family Trust"))).toBe(true);
  });

  it("hides the Household optgroup when no spouse is on file (asset mode)", () => {
    render(
      <BequestRecipientList
        mode="asset"
        rows={[{ recipientKind: "family_member", recipientId: "f1", percentage: 100, sortOrder: 0 }]}
        onChange={() => {}}
        primary={noSpouse}
        familyMembers={familyMembers}
        externalBeneficiaries={externals}
        entities={entities}
      />,
    );
    const select = screen.getByRole("combobox", { name: /Recipient 1/i });
    const optgroups = Array.from(select.querySelectorAll("optgroup")).map(
      (g) => (g as HTMLOptGroupElement).label,
    );
    expect(optgroups).not.toContain("Household");
  });
});

describe("BequestRecipientList — debt mode", () => {
  it("only shows Family and Entity optgroups (no Household, no External)", () => {
    const rows: BequestRecipient[] = [
      { recipientKind: "family_member", recipientId: "f1", percentage: 100, sortOrder: 0 },
    ];
    render(
      <BequestRecipientList
        mode="debt"
        rows={rows}
        onChange={() => {}}
        primary={primary}
        familyMembers={familyMembers}
        externalBeneficiaries={externals}
        entities={entities}
      />,
    );
    const select = screen.getByRole("combobox", { name: /Recipient 1/i });
    const optgroups = Array.from(select.querySelectorAll("optgroup")).map(
      (g) => (g as HTMLOptGroupElement).label,
    );
    expect(optgroups).toEqual(["Family", "Entity"]);
  });
});

describe("BequestRecipientList — onChange", () => {
  it("emits a recipientKind/recipientId pair when an option is selected (parses fm: prefix)", () => {
    const onChange = vi.fn();
    const rows: BequestRecipient[] = [
      { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
    ];
    render(
      <BequestRecipientList
        mode="asset"
        rows={rows}
        onChange={onChange}
        primary={primary}
        familyMembers={familyMembers}
        externalBeneficiaries={externals}
        entities={entities}
      />,
    );
    const select = screen.getByRole("combobox", { name: /Recipient 1/i });
    fireEvent.change(select, { target: { value: "fm:f1" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ recipientKind: "family_member", recipientId: "f1" }),
    ]);
  });

  it("parses ent: prefix into entity recipientKind", () => {
    const onChange = vi.fn();
    const rows: BequestRecipient[] = [
      { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
    ];
    render(
      <BequestRecipientList
        mode="asset"
        rows={rows}
        onChange={onChange}
        primary={primary}
        familyMembers={familyMembers}
        externalBeneficiaries={externals}
        entities={entities}
      />,
    );
    const select = screen.getByRole("combobox", { name: /Recipient 1/i });
    fireEvent.change(select, { target: { value: "ent:t1" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ recipientKind: "entity", recipientId: "t1" }),
    ]);
  });

  it("first add seeds the row at 100% (auto-default)", () => {
    const onChange = vi.fn();
    render(
      <BequestRecipientList
        mode="asset"
        rows={[]}
        onChange={onChange}
        primary={primary}
        familyMembers={familyMembers}
        externalBeneficiaries={externals}
        entities={entities}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add recipient/i }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ recipientKind: "spouse", percentage: 100, sortOrder: 0 }),
    ]);
  });

  it("second add splits 50/50 across unlocked rows", () => {
    const onChange = vi.fn();
    const rows: BequestRecipient[] = [
      { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
    ];
    render(
      <BequestRecipientList
        mode="asset"
        rows={rows}
        onChange={onChange}
        primary={primary}
        familyMembers={familyMembers}
        externalBeneficiaries={externals}
        entities={entities}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add recipient/i }));
    const next = onChange.mock.calls[0][0] as BequestRecipient[];
    expect(next).toHaveLength(2);
    expect(next.map((r) => r.percentage).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
    expect(next[0].percentage).toBe(50);
    expect(next[1].percentage).toBe(50);
  });

  it("appends a family-member default in debt mode (spouse not allowed)", () => {
    const onChange = vi.fn();
    render(
      <BequestRecipientList
        mode="debt"
        rows={[]}
        onChange={onChange}
        primary={primary}
        familyMembers={familyMembers}
        externalBeneficiaries={externals}
        entities={entities}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Add recipient/i }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ recipientKind: "family_member", recipientId: "f1" }),
    ]);
  });

  it("removes a recipient and reindexes sortOrder", () => {
    const onChange = vi.fn();
    const rows: BequestRecipient[] = [
      { recipientKind: "family_member", recipientId: "f1", percentage: 50, sortOrder: 0 },
      { recipientKind: "family_member", recipientId: "f2", percentage: 50, sortOrder: 1 },
    ];
    render(
      <BequestRecipientList
        mode="asset"
        rows={rows}
        onChange={onChange}
        primary={primary}
        familyMembers={familyMembers}
        externalBeneficiaries={externals}
        entities={entities}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove recipient 1/i }));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ recipientId: "f2", sortOrder: 0 }),
    ]);
  });
});

describe("BequestRecipientList — sum indicator", () => {
  it("colors the sum amber when not 100", () => {
    render(
      <BequestRecipientList
        mode="asset"
        rows={[{ recipientKind: "family_member", recipientId: "f1", percentage: 60, sortOrder: 0 }]}
        onChange={() => {}}
        primary={primary}
        familyMembers={familyMembers}
        externalBeneficiaries={externals}
        entities={entities}
      />,
    );
    const sumNode = screen.getByText(/sum: 60\.00%/);
    expect(sumNode.className).toMatch(/amber/);
  });

  it("colors the sum emerald when at 100", () => {
    render(
      <BequestRecipientList
        mode="asset"
        rows={[{ recipientKind: "family_member", recipientId: "f1", percentage: 100, sortOrder: 0 }]}
        onChange={() => {}}
        primary={primary}
        familyMembers={familyMembers}
        externalBeneficiaries={externals}
        entities={entities}
      />,
    );
    const sumNode = screen.getByText(/sum: 100\.00%/);
    expect(sumNode.className).toMatch(/emerald/);
  });
});
