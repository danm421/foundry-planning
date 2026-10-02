// @vitest-environment jsdom
/**
 * The policy dialog's Beneficiaries tab inside a scenario: it opens on the
 * scenario's own designations (passed in from the effective tree, never the
 * base GET) and saves as a scenario account edit (R1) — the same shape
 * `forms/beneficiaries-tab.tsx` writes. Base mode keeps its REST calls (R3).
 */
import { createRef } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import InsurancePolicyBeneficiariesTab, {
  type InsurancePolicyBeneficiariesAutoSaveHandle,
} from "@/components/insurance-policy-beneficiaries-tab";

let searchParams = new URLSearchParams("scenario=scn-1");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/c-1/details/insurance",
}));

const ENTITIES = [{ id: "ilit-1", name: "Cooper ILIT", entityType: "trust" as const }];
const REFS = [
  { id: "ref-1", tier: "primary" as const, percentage: 100, familyMemberId: "fm-spouse", sortOrder: 0 },
];

type Call = [string, RequestInit | undefined];
const calls = () => (global.fetch as ReturnType<typeof vi.fn>).mock.calls as Call[];
const requestList = () => calls().map(([url, init]) => `${init?.method ?? "GET"} ${url}`);

beforeEach(() => {
  searchParams = new URLSearchParams("scenario=scn-1");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return new Response(init.body as string, { status: 200 });
      if (init?.method === "POST") return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

function mount(ref: React.RefObject<InsurancePolicyBeneficiariesAutoSaveHandle | null>, over = {}) {
  return render(
    <InsurancePolicyBeneficiariesTab
      ref={ref}
      clientId="c-1"
      clientFirstName="Cooper"
      spouseFirstName="Susan"
      mode="edit"
      policyId="policy-1"
      members={[{ id: "fm-spouse", firstName: "Susan", relationship: "spouse" } as never]}
      externals={[]}
      entities={ENTITIES}
      policyOwners={[{ kind: "joint" }]}
      scenarioBeneficiaries={REFS}
      {...over}
    />,
  );
}

describe("InsurancePolicyBeneficiariesTab inside a scenario", () => {
  it("opens on the scenario's designations without fetching the base ones, and saves one account edit", async () => {
    const ref = createRef<InsurancePolicyBeneficiariesAutoSaveHandle>();
    const onScenarioSaved = vi.fn();
    mount(ref, { onScenarioSaved });
    // The editor is up synchronously — no "Loading…" round trip.
    await waitFor(() => expect(document.body.textContent).toContain("sum: 100.00%"));

    const result = await ref.current!.saveAsync();
    expect(result.ok).toBe(true);

    // The WHOLE request list: one scenario-changes POST. No base GET, no PUT.
    expect(requestList()).toEqual(["POST /api/clients/c-1/scenarios/scn-1/changes"]);
    expect(JSON.parse(calls()[0][1]!.body as string)).toEqual({
      op: "edit",
      targetKind: "account",
      targetId: "policy-1",
      desiredFields: { beneficiaries: REFS },
    });
    expect(onScenarioSaved).toHaveBeenCalledWith(REFS);
  });

  it("seeds a trust-owned policy's primary row and saves it with a minted uuid", async () => {
    const ref = createRef<InsurancePolicyBeneficiariesAutoSaveHandle>();
    mount(ref, { scenarioBeneficiaries: [], policyOwners: [{ kind: "entity", entityId: "ilit-1" }] });
    await waitFor(() => expect(ref.current).not.toBeNull());
    await waitFor(() => expect(document.body.textContent).toContain("sum: 100.00%"));

    await ref.current!.saveAsync();
    expect(requestList()).toEqual(["POST /api/clients/c-1/scenarios/scn-1/changes"]);
    const [seed] = JSON.parse(calls()[0][1]!.body as string).desiredFields.beneficiaries;
    expect(seed).toMatchObject({ tier: "primary", percentage: 100, entityIdRef: "ilit-1" });
    expect(seed.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe("InsurancePolicyBeneficiariesTab in base mode", () => {
  it("still loads from and PUTs to the account beneficiaries route", async () => {
    searchParams = new URLSearchParams();
    const ref = createRef<InsurancePolicyBeneficiariesAutoSaveHandle>();
    mount(ref, { scenarioBeneficiaries: undefined });
    await waitFor(() => expect(ref.current).not.toBeNull());
    await waitFor(() => expect(requestList()).toContain("GET /api/clients/c-1/accounts/policy-1/beneficiaries"));
    await waitFor(() => expect(document.body.textContent).toContain("sum: 0.00%"));
    await ref.current!.saveAsync();
    expect(requestList()).toContain("PUT /api/clients/c-1/accounts/policy-1/beneficiaries");
    expect(requestList().some((l) => l.includes("/scenarios/"))).toBe(false);
  });
});
