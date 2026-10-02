// @vitest-environment jsdom
/**
 * Focus mode on a reinvestment, through the REAL scenario writer.
 *
 * Inside a scenario the edit, the create and the delete must each issue only
 * scenario-change writes — never a `/reinvestments` GET (it reads the base
 * plan) or a `/reinvestments` write (it writes it). The whole request list is
 * asserted, not just the absence of one call. Base mode keeps its own REST
 * calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let searchParams = new URLSearchParams("");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => searchParams,
  usePathname: () => "/clients/c-1/solver",
}));
vi.mock("@/engine", () => ({ runProjection: () => [] }));

import TechniquesView, { type TechniquesViewProps } from "@/components/techniques-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";

const PROPS: TechniquesViewProps = {
  clientId: "c-1",
  rothConversions: [],
  transfers: [],
  reinvestments: [
    {
      id: "ri-1",
      name: "Glide Path Switch",
      accountIds: ["acc-brokerage"],
      groupKeys: [],
      year: 2031,
      yearRef: null,
      targetType: "model_portfolio",
      realizeTaxesOnSwitch: false,
      // The SCENARIO's portfolio, as the loader reads it off the effective tree.
      modelPortfolioId: "mp-2",
      customGrowthRate: null,
      customPctOrdinaryIncome: null,
      customPctLtCapitalGains: null,
      customPctQualifiedDividends: null,
      customPctTaxExempt: null,
    },
  ],
  relocations: [],
  assetTransactions: [],
  accounts: [{ id: "acc-brokerage", name: "Joint Brokerage", category: "taxable", subType: "joint" }],
  liabilities: [],
  businesses: [],
  modelPortfolios: [
    { id: "mp-1", name: "Balanced 60/40" },
    { id: "mp-2", name: "Conservative" },
  ],
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Pick<Response, "ok" | "status" | "json">>;
const fetchMock = vi.fn<FetchLike>(async (url) =>
  String(url).endsWith("/account-groups")
    ? { ok: true, status: 200, json: async () => [] }
    : { ok: true, status: 200, json: async () => ({ id: "x" }) },
);
const onFocusClose = vi.fn();

function renderFocused(focus: EditorFocus) {
  return render(
    <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
      <TechniquesView {...PROPS} focus={focus} onFocusClose={onFocusClose} />
    </ClientAccessProvider>,
  );
}

/** Method + URL of every request issued, in order. */
const requests = () =>
  fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);
const body = (callIndex: number) => JSON.parse(fetchMock.mock.calls[callIndex][1]?.body as string);
const submitForm = () => fireEvent.submit(document.getElementById("reinvestment-form") as HTMLFormElement);

const GROUPS = "GET /api/clients/c-1/account-groups";
const CHANGES = "POST /api/clients/c-1/scenarios/scn-1/changes";

beforeEach(() => {
  fetchMock.mockClear();
  onFocusClose.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("reinvestment focus — inside a scenario", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams("scenario=scn-1");
  });

  it("edit opens on the scenario's portfolio and writes one scenario change, nothing to /reinvestments", async () => {
    renderFocused({ kind: "reinvestment", id: "ri-1" });
    expect((screen.getByLabelText(/model portfolio/i) as HTMLSelectElement).value).toBe("mp-2");

    submitForm();
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());

    expect(requests()).toEqual([GROUPS, CHANGES]);
    expect(body(1)).toMatchObject({
      op: "edit",
      targetKind: "reinvestment",
      targetId: "ri-1",
      desiredFields: { modelPortfolioId: "mp-2", accountIds: ["acc-brokerage"] },
    });
  });

  it("create writes one scenario add with a fresh id, nothing to /reinvestments", async () => {
    renderFocused({ intent: "create", kind: "reinvestment" });
    fireEvent.click(screen.getByRole("button", { name: /Joint Brokerage/i }));

    submitForm();
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());

    expect(requests()).toEqual([GROUPS, CHANGES]);
    const change = body(1);
    expect(change).toMatchObject({ op: "add", targetKind: "reinvestment" });
    expect(change.entity.id).toEqual(expect.any(String));
  });

  it("delete writes one scenario remove and no form request at all", async () => {
    renderFocused({ intent: "delete", kind: "reinvestment", id: "ri-1" });
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());

    expect(requests()).toEqual([CHANGES]);
    expect(body(0)).toEqual({ op: "remove", targetKind: "reinvestment", targetId: "ri-1" });
  });
});

describe("reinvestment focus — base mode", () => {
  beforeEach(() => {
    searchParams = new URLSearchParams("");
  });

  it("edit PUTs the reinvestments route, from the supplied fields (no GET backfill)", async () => {
    renderFocused({ kind: "reinvestment", id: "ri-1" });
    submitForm();
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());

    expect(requests()).toEqual([GROUPS, "PUT /api/clients/c-1/reinvestments"]);
    expect(body(1)).toMatchObject({ reinvestmentId: "ri-1", modelPortfolioId: "mp-2" });
  });

  it("create POSTs the reinvestments route", async () => {
    renderFocused({ intent: "create", kind: "reinvestment" });
    fireEvent.click(screen.getByRole("button", { name: /Joint Brokerage/i }));
    submitForm();
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());

    expect(requests()).toEqual([GROUPS, "POST /api/clients/c-1/reinvestments"]);
  });

  it("delete DELETEs the reinvestments route", async () => {
    renderFocused({ intent: "delete", kind: "reinvestment", id: "ri-1" });
    await waitFor(() => expect(onFocusClose).toHaveBeenCalledWith());

    expect(requests()).toEqual(["DELETE /api/clients/c-1/reinvestments?reinvestmentId=ri-1"]);
  });
});
