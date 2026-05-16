// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import EstateFlowRemainderDialog from "@/components/estate-flow-remainder-dialog";
import type { ClientData, Will } from "@/engine/types";

const baseClientData = {
  wills: [],
  familyMembers: [],
  externalBeneficiaries: [],
  entities: [],
} as unknown as ClientData;

// Two non-principal family members so seeded recipients resolve.
const familyMembers = [
  { id: "fm-1", role: "child", relationship: "child", firstName: "Kid", lastName: "One" },
  { id: "fm-2", role: "child", relationship: "child", firstName: "Kid", lastName: "Two" },
];

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

  it("emits a Will[] via onApplyWill with tier stamping and offset sortOrder", async () => {
    const user = userEvent.setup();
    const onApplyWill = vi.fn();
    // Client will seeded with recipients across BOTH tiers; spouse will seeded
    // with a single primary recipient. Each tier sums to 100% so canApply holds.
    const clientData = {
      wills: [
        {
          id: "will-client",
          grantor: "client",
          bequests: [],
          residuaryRecipients: [
            { recipientKind: "family_member", recipientId: "fm-1", tier: "primary", percentage: 100, sortOrder: 0 },
            { recipientKind: "family_member", recipientId: "fm-2", tier: "contingent", percentage: 100, sortOrder: 0 },
          ],
        },
        {
          id: "will-spouse",
          grantor: "spouse",
          bequests: [],
          residuaryRecipients: [
            { recipientKind: "family_member", recipientId: "fm-1", tier: "primary", percentage: 100, sortOrder: 0 },
          ],
        },
      ],
      familyMembers,
      externalBeneficiaries: [],
      entities: [],
    } as unknown as ClientData;

    render(
      <EstateFlowRemainderDialog
        clientData={clientData}
        isMarried={true}
        ownerNames={{ clientName: "Pat Doe", spouseName: "Sam Doe" }}
        onApplyWill={onApplyWill}
        onClose={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApplyWill).toHaveBeenCalledTimes(1);
    const wills = onApplyWill.mock.calls[0][0] as Will[];

    const clientWill = wills.find((w) => w.grantor === "client");
    expect(clientWill).toBeDefined();
    expect(clientWill!.id).toBe("will-client");
    expect(clientWill!.grantor).toBe("client");

    const recips = clientWill!.residuaryRecipients ?? [];
    const primary = recips.filter((r) => r.tier === "primary");
    const contingent = recips.filter((r) => r.tier === "contingent");

    expect(primary).toHaveLength(1);
    expect(contingent).toHaveLength(1);
    expect(primary[0].recipientId).toBe("fm-1");
    expect(contingent[0].recipientId).toBe("fm-2");
    // Contingent rows are offset past the primary rows in sortOrder.
    expect(primary[0].sortOrder).toBe(0);
    expect(contingent[0].sortOrder).toBe(primary.length);
    expect(contingent[0].sortOrder).toBeGreaterThan(primary[0].sortOrder);
  });

  it("emits residuaryRecipients: [] for an existing will whose clause is emptied", async () => {
    const user = userEvent.setup();
    const onApplyWill = vi.fn();
    // An existing client will with one recipient. After removing it via the
    // recipient list's remove button, Apply must still emit the Will with an
    // empty residuaryRecipients array so the consumer clears the clause.
    const clientData = {
      wills: [
        {
          id: "will-client",
          grantor: "client",
          bequests: [],
          residuaryRecipients: [
            { recipientKind: "family_member", recipientId: "fm-1", tier: "primary", percentage: 100, sortOrder: 0 },
          ],
        },
      ],
      familyMembers,
      externalBeneficiaries: [],
      entities: [],
    } as unknown as ClientData;

    render(
      <EstateFlowRemainderDialog
        clientData={clientData}
        isMarried={false}
        ownerNames={{ clientName: "Pat Doe", spouseName: null }}
        onApplyWill={onApplyWill}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Remove Client primary remainder recipient/i }),
    );
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApplyWill).toHaveBeenCalledTimes(1);
    const wills = onApplyWill.mock.calls[0][0] as Will[];
    const clientWill = wills.find((w) => w.grantor === "client");
    expect(clientWill).toBeDefined();
    expect(clientWill!.id).toBe("will-client");
    expect(clientWill!.residuaryRecipients).toEqual([]);
  });
});
