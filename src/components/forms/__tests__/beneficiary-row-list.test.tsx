// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import BeneficiaryRowList, { BeneficiaryRow } from "../beneficiary-row-list";

const householdProps = { client: { firstName: "John" }, spouse: { firstName: "Jane" } };
const members = [{ id: "m1", firstName: "Kid", lastName: "One", relationship: "child" as const, dateOfBirth: null, notes: null }];
const externals = [{ id: "e1", name: "Charity", kind: "charity" as const, notes: null }];
const entities: { id: string; name: string }[] = [{ id: "ent1", name: "Other Trust" }];

describe("BeneficiaryRowList", () => {
  it("renders rows and calls onChange when add button clicked", () => {
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
      expect.objectContaining({ source: { kind: "empty" }, percentage: 0 }),
    ]));
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
});
