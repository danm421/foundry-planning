// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import EstateFlowRemainderDialog from "@/components/estate-flow-remainder-dialog";
import type { ClientData } from "@/engine/types";

const baseClientData = {
  wills: [],
  familyMembers: [],
  externalBeneficiaries: [],
  entities: [],
} as unknown as ClientData;

describe("EstateFlowRemainderDialog", () => {
  it("shows one will section and hides the contingent tier when unmarried", () => {
    render(
      <EstateFlowRemainderDialog
        clientData={baseClientData}
        isMarried={false}
        ownerNames={{ clientName: "Pat Doe", spouseName: null }}
        onApplyWill={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Pat Doe.*will/i)).toBeInTheDocument();
    expect(screen.queryByText(/Sam/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/if spouse predeceased/i)).not.toBeInTheDocument();
  });

  it("shows two will sections and the contingent tier when married", () => {
    render(
      <EstateFlowRemainderDialog
        clientData={baseClientData}
        isMarried={true}
        ownerNames={{ clientName: "Pat Doe", spouseName: "Sam Doe" }}
        onApplyWill={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText(/Pat Doe.*will/i)).toBeInTheDocument();
    expect(screen.getByText(/Sam Doe.*will/i)).toBeInTheDocument();
    expect(screen.getAllByText(/if spouse predeceased/i).length).toBeGreaterThan(0);
  });
});
