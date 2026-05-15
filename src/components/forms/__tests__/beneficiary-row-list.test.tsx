// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import BeneficiaryRowList, { BeneficiaryRow } from "../beneficiary-row-list";

const householdProps = { client: { firstName: "John" }, spouse: { firstName: "Jane" } };
const members = [{ id: "m1", firstName: "Kid", lastName: "One", relationship: "child" as const, dateOfBirth: null, notes: null }];
const externals = [{ id: "e1", name: "Charity", kind: "charity" as const, notes: null }];
const entities: { id: string; name: string }[] = [{ id: "ent1", name: "Other Trust" }];

describe("BeneficiaryRowList", () => {
  it("first add seeds the row at 100% (auto-default)", () => {
    const rows: BeneficiaryRow[] = [];
    const onChange = vi.fn();
    render(
      <BeneficiaryRowList
        tier="income"
        allowEntities={false}
        rows={rows}
        onChange={onChange}
        members={members}
        externals={externals}
        entities={[]}
        household={householdProps}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /add beneficiary/i }));
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ source: { kind: "empty" }, percentage: 100 }),
    ]));
  });

  it("second add splits the list 50/50 (unlocked rows split evenly)", () => {
    const rows: BeneficiaryRow[] = [
      { id: "r1", source: { kind: "household", role: "client" }, percentage: 100 },
    ];
    const onChange = vi.fn();
    render(
      <BeneficiaryRowList
        tier="income"
        allowEntities={false}
        rows={rows}
        onChange={onChange}
        members={members}
        externals={externals}
        entities={[]}
        household={householdProps}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /add beneficiary/i }));
    const next = onChange.mock.calls[0][0] as BeneficiaryRow[];
    expect(next).toHaveLength(2);
    expect(next.map((r) => r.percentage).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
    expect(next[0].percentage).toBe(50);
    expect(next[1].percentage).toBe(50);
  });

  it("Split among children replaces rows with one per child, evenly split", () => {
    const childMembers = [
      { id: "c1", firstName: "Sophia", lastName: null, relationship: "child" as const, dateOfBirth: null, notes: null },
      { id: "c2", firstName: "Marcus", lastName: null, relationship: "child" as const, dateOfBirth: null, notes: null },
      { id: "p1", firstName: "Mom", lastName: null, relationship: "parent" as const, dateOfBirth: null, notes: null },
    ];
    const onChange = vi.fn();
    render(
      <BeneficiaryRowList
        tier="income"
        allowEntities={false}
        rows={[{ id: "r1", source: { kind: "household", role: "client" }, percentage: 100 }]}
        onChange={onChange}
        members={childMembers}
        externals={externals}
        entities={[]}
        household={householdProps}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /split among children/i }));
    const next = onChange.mock.calls[0][0] as BeneficiaryRow[];
    expect(next).toHaveLength(2);
    expect(next.map((r) => r.percentage).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 2);
    // Both child source kinds present
    expect(next.every((r) => r.source.kind === "family")).toBe(true);
  });

  it("Split among children button is hidden when there are no children", () => {
    const noChildMembers = [
      { id: "p1", firstName: "Mom", lastName: null, relationship: "parent" as const, dateOfBirth: null, notes: null },
    ];
    render(
      <BeneficiaryRowList
        tier="income"
        allowEntities={false}
        rows={[]}
        onChange={() => {}}
        members={noChildMembers}
        externals={externals}
        entities={[]}
        household={householdProps}
      />
    );
    expect(screen.queryByRole("button", { name: /split among children/i })).not.toBeInTheDocument();
  });

  it("amber sum indicator when sum != 100", () => {
    const rows: BeneficiaryRow[] = [
      { id: "r1", source: { kind: "household", role: "client" }, percentage: 50 },
    ];
    render(
      <BeneficiaryRowList
        tier="income"
        allowEntities={false}
        rows={rows}
        onChange={() => {}}
        members={members}
        externals={externals}
        entities={[]}
        household={householdProps}
      />
    );
    const sumNode = screen.getByText(/50/);
    expect(sumNode.className).toMatch(/amber/);
  });

  it("does not show entity options when allowEntities=false", () => {
    render(
      <BeneficiaryRowList
        tier="income"
        allowEntities={false}
        rows={[{ id: "r1", source: { kind: "empty" }, percentage: 0 }]}
        onChange={() => {}}
        members={members}
        externals={externals}
        entities={entities}
        household={householdProps}
      />
    );
    expect(screen.queryByText(/Other Trust/i)).not.toBeInTheDocument();
  });

  it("shows entity options when allowEntities=true", () => {
    render(
      <BeneficiaryRowList
        tier="remainder"
        allowEntities={true}
        rows={[{ id: "r1", source: { kind: "empty" }, percentage: 0 }]}
        onChange={() => {}}
        members={members}
        externals={externals}
        entities={entities}
        household={householdProps}
      />
    );
    expect(screen.getByText(/Other Trust/i)).toBeInTheDocument();
  });

  it("renders a distribution-form select for remainder rows", () => {
    const rows: BeneficiaryRow[] = [
      { id: "r1", source: { kind: "household", role: "client" }, percentage: 100, distributionForm: "outright" },
    ];
    render(
      <BeneficiaryRowList
        tier="remainder"
        allowEntities={true}
        rows={rows}
        onChange={vi.fn()}
        members={members}
        externals={externals}
        entities={entities}
        household={householdProps}
      />
    );
    expect(screen.getByRole("combobox", { name: /distribution form 1/i })).toBeTruthy();
  });

  it("does not render a distribution-form select for income rows", () => {
    const rows: BeneficiaryRow[] = [
      { id: "r1", source: { kind: "household", role: "client" }, percentage: 100 },
    ];
    render(
      <BeneficiaryRowList
        tier="income"
        allowEntities={false}
        rows={rows}
        onChange={vi.fn()}
        members={members}
        externals={externals}
        entities={[]}
        household={householdProps}
      />
    );
    expect(screen.queryByRole("combobox", { name: /distribution form/i })).toBeNull();
  });

  it("seeds new remainder rows with distributionForm 'outright'", () => {
    const onChange = vi.fn();
    render(
      <BeneficiaryRowList
        tier="remainder"
        allowEntities={true}
        rows={[]}
        onChange={onChange}
        members={members}
        externals={externals}
        entities={entities}
        household={householdProps}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: /add beneficiary/i }));
    expect(onChange).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ distributionForm: "outright" }),
    ]));
  });

  it("emits a changed distributionForm when the select changes", () => {
    const onChange = vi.fn();
    const rows: BeneficiaryRow[] = [
      { id: "r1", source: { kind: "household", role: "client" }, percentage: 100, distributionForm: "outright" },
    ];
    render(
      <BeneficiaryRowList
        tier="remainder"
        allowEntities={true}
        rows={rows}
        onChange={onChange}
        members={members}
        externals={externals}
        entities={entities}
        household={householdProps}
      />
    );
    fireEvent.change(screen.getByRole("combobox", { name: /distribution form 1/i }), {
      target: { value: "in_trust" },
    });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ distributionForm: "in_trust" }),
    ]);
  });
});
