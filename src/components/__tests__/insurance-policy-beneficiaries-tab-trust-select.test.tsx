// @vitest-environment jsdom
import { createRef } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import InsurancePolicyBeneficiariesTab, {
  type InsurancePolicyBeneficiariesAutoSaveHandle,
} from "@/components/insurance-policy-beneficiaries-tab";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const ENTITIES = [
  { id: "ilit-1", name: "Cooper ILIT", entityType: "trust" as const },
  { id: "llc-1", name: "Family LLC", entityType: "llc" as const },
];

beforeEach(() => {
  // Existing primary row points at the spouse; we'll switch it to the ILIT.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response(
        JSON.stringify([
          {
            id: "existing-1",
            targetKind: "account",
            accountId: "policy-1",
            entityId: null,
            tier: "primary",
            familyMemberId: "fm-spouse",
            externalBeneficiaryId: null,
            entityIdRef: null,
            householdRole: null,
            percentage: "100",
            sortOrder: 0,
          },
        ]),
        { status: 200 },
      );
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function waitForHandle(
  ref: React.RefObject<InsurancePolicyBeneficiariesAutoSaveHandle | null>,
) {
  await waitFor(() => {
    expect(ref.current).not.toBeNull();
  });
  return ref.current!;
}

describe("InsurancePolicyBeneficiariesTab — trust as beneficiary", () => {
  it("offers trust entities in the beneficiary dropdown and persists the selection", async () => {
    const ref = createRef<InsurancePolicyBeneficiariesAutoSaveHandle>();
    render(
      <InsurancePolicyBeneficiariesTab
        ref={ref}
        clientId="c-1"
        clientFirstName="Cooper"
        spouseFirstName="Susan"
        mode="edit"
        policyId="policy-1"
        members={[
          {
            id: "fm-spouse",
            firstName: "Susan",
            relationship: "spouse",
          } as never,
        ]}
        externals={[]}
        entities={ENTITIES}
        // Client-owned policy — trust seed should NOT fire; user must pick the trust.
        policyOwners={[{ kind: "family" }]}
      />,
    );

    // Wait for the loaded editor to render the existing row.
    const select = await waitFor(() => {
      const el = screen.getAllByRole("combobox")[0];
      expect(el).toBeDefined();
      return el as HTMLSelectElement;
    });

    // The dropdown must include the trust option.
    const trustOption = Array.from(select.options).find(
      (o) => o.value === "ent:ilit-1",
    );
    expect(trustOption).toBeDefined();
    expect(trustOption!.textContent).toContain("Cooper ILIT");

    // Switch the existing row from spouse → ILIT.
    fireEvent.change(select, { target: { value: "ent:ilit-1" } });

    const handle = await waitForHandle(ref);
    const result = await handle.saveAsync();
    expect(result.ok).toBe(true);

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, RequestInit | undefined]>;
    const putCall = calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeDefined();
    const body = JSON.parse((putCall![1] as RequestInit).body as string);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      tier: "primary",
      entityIdRef: "ilit-1",
    });
    // Picking the trust must clear the previous family-member ref.
    expect(body[0].familyMemberId).toBeUndefined();
  });
});
