// @vitest-environment jsdom
/**
 * The add-account form's Beneficiaries tab inside a scenario (R1): the account's
 * designations come from the scenario's own refs, never the base
 * `/accounts/:id/beneficiaries` GET, and Save writes one scenario account edit
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

describe("BeneficiariesTab inside a scenario", () => {
  it("shows the scenario's designations and saves one scenario account edit", async () => {
    render(<BeneficiariesTab clientId="c1" accountId="a1" active scenarioBeneficiaries={REFS} />);
    expect(await screen.findByText("sum: 100.00%")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /save beneficiaries/i }));
    await waitFor(() =>
      expect(requestList()).toContain("POST /api/clients/c1/scenarios/scn-1/changes"),
    );

    // The lists the editor offers load as before; the account's own designations
    // and the base PUT never appear.
    expect(requestList().filter((l) => l.includes("/beneficiaries") && !l.includes("external"))).toEqual([]);
    expect(requestList().some((l) => l.startsWith("PUT "))).toBe(false);
    const post = fetchCalls().find(([, init]) => init?.method === "POST")!;
    expect(JSON.parse(post[1]!.body as string)).toMatchObject({
      op: "edit", targetKind: "account", targetId: "a1",
      desiredFields: { beneficiaries: REFS },
    });
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
