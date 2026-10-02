// @vitest-environment jsdom
//
// Two account-dialog sections that accept input inside a scenario and then
// drop it: the Asset Mix allocations (`account_asset_allocations` — no scenario
// column; every save path skips the PUT in scenario mode) and the annuity's
// Income & Guarantees contract (`saveAnnuityContract` returns early). Inside a
// scenario both are read-only under the base-only note; in base mode they
// still write.
//
// `?scenario=` drives the REAL `useScenarioWriter`.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, within } from "@testing-library/react";

import AddAccountForm, { type AccountFormInitial } from "../add-account-form";

let searchParams = new URLSearchParams("");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/client-123/solver",
}));

const FAMILY_MEMBERS = [{ id: "fm-client", role: "client" as const, firstName: "Alice" }];
const OWNERS = [{ kind: "family_member" as const, familyMemberId: "fm-client", percent: 1 }];

const TAXABLE: AccountFormInitial = {
  id: "acct-1",
  name: "Brokerage",
  category: "taxable",
  subType: "brokerage",
  owner: "client",
  value: "100000",
  basis: "50000",
  growthRate: "0.05",
  owners: OWNERS,
};

const ANNUITY: AccountFormInitial = {
  ...TAXABLE,
  name: "Athene Contract",
  category: "annuity",
  subType: "non_qualified",
  growthRate: "0.04",
};

const ASSET_CLASSES = [
  { id: "ac-eq", name: "US Equity", slug: "us-equity", geometricReturn: 0.07 },
  { id: "ac-inf", name: "Inflation", slug: "inflation", geometricReturn: 0.025 },
];

const STORED_CONTRACT = {
  carrier: "Athene",
  contractNumberLast4: "4417",
  productType: "fixed_indexed",
  taxTreatment: "non_qualified",
  costBasis: 250_000,
  annualFeePct: 0.012,
  incomeMode: "rider",
  incomeStartYear: 2034,
  payoutStructure: "joint_survivor",
  survivorPct: 1,
  benefitBase: 500_000,
  rollupRatchets: true,
};

let fetchMock: ReturnType<typeof vi.fn>;

const writes = () =>
  fetchMock.mock.calls
    .map(([url, init]) => ({ url: String(url), method: (init as RequestInit | undefined)?.method ?? "GET" }))
    .filter((c) => c.method !== "GET");

beforeEach(() => {
  searchParams = new URLSearchParams("");
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    if (u.includes("annuity-contracts") && method === "GET") {
      return { ok: true, status: 200, json: async () => STORED_CONTRACT };
    }
    if (u.includes("allocations") && method === "GET") {
      return { ok: true, json: async () => [{ assetClassId: "ac-eq", weight: "0.6" }] };
    }
    if (u.includes("savings-rules") || u.includes("holdings")) return { ok: true, json: async () => [] };
    return { ok: true, json: async () => ({ id: "acct-1" }) };
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderForm(initial: AccountFormInitial, initialTab: "asset_mix" | "annuity") {
  return render(
    <AddAccountForm
      clientId="client-123"
      category={initial.category as "taxable" | "annuity"}
      mode="edit"
      initial={initial}
      initialTab={initialTab}
      familyMembers={FAMILY_MEMBERS}
      entities={[]}
      assetClasses={ASSET_CLASSES}
    />,
  );
}

async function submit() {
  await act(async () => {
    fireEvent.submit(document.getElementById("add-account-form") as HTMLFormElement);
  });
}

describe("Account dialog → Asset Mix", () => {
  it("inside a scenario: read-only under the base-only note; a save sends no allocations", async () => {
    searchParams = new URLSearchParams("scenario=scn-1");
    renderForm(TAXABLE, "asset_mix");

    const note = await screen.findByText("Available on the base plan.");
    const weights = within(note.nextElementSibling as HTMLElement).getAllByRole("textbox");
    expect(weights.length).toBeGreaterThan(0);
    for (const w of weights) expect(w).toBeDisabled();

    await submit();
    await waitFor(() => expect(writes().some((w) => w.url.includes("/scenarios/scn-1/changes"))).toBe(true));
    expect(writes().filter((w) => w.url.includes("/allocations"))).toEqual([]);
  });

  it("on the base plan: editable, and a save still PUTs the allocations", async () => {
    renderForm(TAXABLE, "asset_mix");
    await waitFor(() => expect(screen.getByDisplayValue("60.0")).toBeInTheDocument());
    expect(screen.queryByText("Available on the base plan.")).toBeNull();
    expect(screen.getByDisplayValue("60.0")).toBeEnabled();

    await submit();
    await waitFor(() =>
      expect(writes()).toContainEqual({ url: "/api/clients/client-123/accounts/acct-1/allocations", method: "PUT" }),
    );
  });
});

describe("Account dialog → annuity Income & Guarantees", () => {
  it("inside a scenario: read-only under the base-only note; a save sends no contract", async () => {
    searchParams = new URLSearchParams("scenario=scn-1");
    renderForm(ANNUITY, "annuity");

    const note = await screen.findByText("Available on the base plan.");
    const fields = (note.nextElementSibling as HTMLElement).querySelectorAll("input, select, button");
    expect(fields.length).toBeGreaterThan(0);
    for (const f of fields) expect(f).toBeDisabled();

    await submit();
    await waitFor(() => expect(writes().some((w) => w.url.includes("/scenarios/scn-1/changes"))).toBe(true));
    expect(writes().filter((w) => w.url.includes("annuity-contracts"))).toEqual([]);
  });

  it("on the base plan: editable, and a save still PUTs the contract", async () => {
    renderForm(ANNUITY, "annuity");
    await waitFor(() => expect(screen.getByDisplayValue("2034")).toBeInTheDocument());
    expect(screen.queryByText("Available on the base plan.")).toBeNull();
    expect(screen.getByDisplayValue("2034")).toBeEnabled();

    await submit();
    await waitFor(() =>
      expect(writes()).toContainEqual({ url: "/api/clients/client-123/annuity-contracts/acct-1", method: "PUT" }),
    );
  });
});
