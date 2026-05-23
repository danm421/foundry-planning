// @vitest-environment jsdom
import { createRef } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import InsurancePolicyBeneficiariesTab, {
  type InsurancePolicyBeneficiariesAutoSaveHandle,
} from "@/components/insurance-policy-beneficiaries-tab";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

const ENTITIES = [
  { id: "ilit-1", name: "Cooper ILIT", entityType: "trust" as const },
];

beforeEach(() => {
  // GET returns no existing rows; PUT echoes the body.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string);
        return new Response(JSON.stringify(body), { status: 200 });
      }
      return new Response(JSON.stringify([]), { status: 200 });
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

describe("InsurancePolicyBeneficiariesTab — trust auto-seed", () => {
  it("seeds the trust as primary beneficiary when the policy is trust-owned and DB is empty", async () => {
    const ref = createRef<InsurancePolicyBeneficiariesAutoSaveHandle>();
    render(
      <InsurancePolicyBeneficiariesTab
        ref={ref}
        clientId="c-1"
        clientFirstName="Cooper"
        spouseFirstName="Susan"
        mode="edit"
        policyId="policy-1"
        members={[]}
        externals={[]}
        entities={ENTITIES}
        policyOwners={[{ kind: "entity", entityId: "ilit-1" }]}
      />,
    );

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
      percentage: 100,
      entityIdRef: "ilit-1",
    });
  });

  it("does NOT seed when the policy already has beneficiaries", async () => {
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
        policyOwners={[{ kind: "entity", entityId: "ilit-1" }]}
      />,
    );

    const handle = await waitForHandle(ref);
    const result = await handle.saveAsync();
    expect(result.ok).toBe(true);

    const calls = (global.fetch as ReturnType<typeof vi.fn>).mock
      .calls as Array<[string, RequestInit | undefined]>;
    const putCall = calls.find(([, init]) => init?.method === "PUT");
    expect(putCall).toBeDefined();
    const body = JSON.parse((putCall![1] as RequestInit).body as string);
    // Existing spouse row preserved; no trust row injected.
    expect(body).toHaveLength(1);
    expect(body[0].familyMemberId).toBe("fm-spouse");
    expect(body[0].entityIdRef).toBeUndefined();
  });
});
