// @vitest-environment jsdom
/**
 * The add-account form's Beneficiaries tab inside a scenario (R1): the account's
 * designations come from the scenario's own refs, never the base
 * `/accounts/:id/beneficiaries` GET and its pick lists from the tree's, and Save
 * writes one scenario account edit
 * through the real writer — never the base PUT. Base mode keeps its REST calls.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let searchParams = new URLSearchParams("scenario=scn-1");
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/c1/details/net-worth",
}));

import BeneficiariesTab from "@/components/forms/beneficiaries-tab";

const REFS = [
  { id: "ref-1", tier: "primary" as const, percentage: 100, householdRole: "client" as const, sortOrder: 0 },
];

type Call = [string, RequestInit | undefined];
const fetchCalls = () => (global.fetch as ReturnType<typeof vi.fn>).mock.calls as Call[];
const requestList = () => fetchCalls().map(([url, init]) => `${init?.method ?? "GET"} ${url}`);

beforeEach(() => {
  searchParams = new URLSearchParams("scenario=scn-1");
  global.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") return new Response(JSON.stringify({ ok: true }), { status: 200 });
    if (init?.method === "PUT") return new Response("[]", { status: 200 });
    return new Response("[]", { status: 200 });
  }) as never;
});
afterEach(() => vi.restoreAllMocks());

const PICK_LISTS = {
  members: [{ id: "fm-1", firstName: "Susan", lastName: "C", relationship: "child" as const, role: "child" as const, dateOfBirth: null, notes: null }],
  externals: [{ id: "ext-1", name: "Red Cross", kind: "charity" as const, notes: null }],
  entities: [{ id: "ent-1", name: "Renamed ILIT" }],
};

describe("BeneficiariesTab inside a scenario", () => {
  it("opens on the scenario's designations and pick lists and saves one scenario account edit — nothing else is requested", async () => {
    render(
      <BeneficiariesTab clientId="c1" accountId="a1" active scenarioBeneficiaries={REFS} pickLists={PICK_LISTS} />,
    );
    expect(await screen.findByText("sum: 100.00%")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Renamed ILIT" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save beneficiaries/i }));
    await waitFor(() => expect(requestList()).toHaveLength(1));

    // The WHOLE request list.
    expect(requestList()).toEqual(["POST /api/clients/c1/scenarios/scn-1/changes"]);
    expect(JSON.parse(fetchCalls()[0][1]!.body as string)).toMatchObject({
      op: "edit", targetKind: "account", targetId: "a1",
      desiredFields: { beneficiaries: REFS },
    });
  });

  it("falls back to the GETs when the caller has no tree data (undefined, not [])", async () => {
    render(<BeneficiariesTab clientId="c1" accountId="a1" active />);
    await screen.findByRole("heading", { name: /primary/i, level: 4 });
    expect(requestList()).toEqual([
      "GET /api/clients/c1/accounts/a1/beneficiaries",
      "GET /api/clients/c1/family-members",
      "GET /api/clients/c1/external-beneficiaries",
      "GET /api/clients/c1/entities",
    ]);
  });
});

describe("BeneficiariesTab in base mode", () => {
  it("loads the account's designations and PUTs them to the base route", async () => {
    searchParams = new URLSearchParams();
    render(<BeneficiariesTab clientId="c1" accountId="a1" active />);
    await screen.findByRole("heading", { name: /primary/i, level: 4 });
    fireEvent.click(screen.getByRole("button", { name: /save beneficiaries/i }));
    await waitFor(() => expect(requestList()).toContain("PUT /api/clients/c1/accounts/a1/beneficiaries"));
    expect(requestList()).toContain("GET /api/clients/c1/accounts/a1/beneficiaries");
    expect(requestList().some((l) => l.includes("/scenarios/"))).toBe(false);
  });
});
