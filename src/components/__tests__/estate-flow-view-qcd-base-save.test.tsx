// @vitest-environment jsdom
//
// A QCD saved from the Estate Flow tab in the BASE case. Inside a scenario the
// whole draft is posted as a `gift` change, `qcd` included; in the base case
// `persistGiftChange` hand-builds the REST body, so the two QCD columns have
// to be in it. Without them a fixed QCD was saved as a cash gift from
// checking, a Full RMD QCD 400'd on its $0 amount, and QCD -> Cash never
// cleared the columns. The setup mirrors estate-flow-view-scenario-write.test.tsx.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-1/estate-flow",
}));
vi.mock("@/components/estate-flow-chart-tab", () => ({
  EstateFlowChartTab: () => <div data-testid="chart-tab" />,
}));
vi.mock("@/components/estate-flow-comparison-tab", () => ({
  EstateFlowComparisonTab: () => <div data-testid="comparison-tab" />,
}));

// The Report tab's gift dialogs only ever call `setWorkingGifts` with the list
// ops; buttons stand in for them so the diff, writer and routes stay real.
vi.mock("@/components/estate-flow-report-tab", () => ({
  EstateFlowReportTab: ({
    setWorkingGifts,
  }: {
    setWorkingGifts: React.Dispatch<React.SetStateAction<EstateFlowGift[]>>;
  }) => (
    <div>
      <button type="button" onClick={() => setWorkingGifts((cur) => addGift(cur, NEW_FIXED_QCD))}>
        add fixed qcd
      </button>
      <button type="button" onClick={() => setWorkingGifts((cur) => addGift(cur, NEW_FULL_RMD_SERIES))}>
        add full rmd qcd series
      </button>
      <button type="button" onClick={() => setWorkingGifts((cur) => updateGift(cur, SAVED_QCD_AS_CASH))}>
        qcd to cash
      </button>
      <button type="button" onClick={() => setWorkingGifts((cur) => updateGift(cur, SAVED_QCD_AS_FULL_RMD))}>
        qcd to full rmd
      </button>
      <button type="button" onClick={() => setWorkingGifts((cur) => updateGift(cur, EDITED_CASH_SERIES))}>
        edit cash series
      </button>
    </div>
  ),
}));

import EstateFlowView from "@/components/estate-flow-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import { buildClientData, sampleAccounts } from "@/engine/__tests__/fixtures";
import { LEGACY_FM_CLIENT } from "@/engine/ownership";
import { addGift, updateGift, type EstateFlowGift } from "@/lib/estate/estate-flow-gifts";

const CLIENT_ID = "client-1";
const CHARITY = { kind: "external_beneficiary" as const, id: "ext-charity" };

// Key order mirrors `giftRowToDraft` / `giftSeriesRowToDraft` (the diff
// compares with JSON.stringify).
const SAVED_QCD: EstateFlowGift = {
  kind: "cash-once",
  id: "gift-qcd",
  year: 2040,
  amount: 15_000,
  grantor: "client",
  recipient: CHARITY,
  crummey: false,
  eventKind: "outright",
  qcd: { accountId: "acct-ira", amountMode: "fixed" },
};
const SAVED_QCD_AS_CASH: EstateFlowGift = {
  kind: "cash-once",
  id: "gift-qcd",
  year: 2040,
  amount: 15_000,
  grantor: "client",
  recipient: CHARITY,
  crummey: false,
  eventKind: "outright",
};
const SAVED_QCD_AS_FULL_RMD: EstateFlowGift = {
  ...SAVED_QCD,
  amount: 0,
  qcd: { accountId: "acct-ira", amountMode: "full_rmd" },
};
const NEW_FIXED_QCD: EstateFlowGift = {
  kind: "cash-once",
  id: "gift-new-qcd",
  year: 2041,
  amount: 20_000,
  grantor: "client",
  recipient: CHARITY,
  crummey: false,
  qcd: { accountId: "acct-ira", amountMode: "fixed" },
};
const NEW_FULL_RMD_SERIES: EstateFlowGift = {
  kind: "series",
  id: "gs-new-qcd",
  startYear: 2040,
  endYear: 2045,
  annualAmount: 0,
  amountMode: "fixed",
  inflationAdjust: false,
  grantor: "client",
  recipient: CHARITY,
  crummey: false,
  qcd: { accountId: "acct-ira", amountMode: "full_rmd" },
};
const CASH_SERIES: EstateFlowGift = {
  kind: "series",
  id: "gs-cash",
  startYear: 2030,
  endYear: 2035,
  annualAmount: 10_000,
  amountMode: "fixed",
  inflationAdjust: false,
  grantor: "client",
  recipient: CHARITY,
  crummey: false,
};
const EDITED_CASH_SERIES: EstateFlowGift = { ...CASH_SERIES, annualAmount: 12_000 };

/** All three recipient columns, as both one-time and series bodies send them. */
const TO_CHARITY = {
  recipientEntityId: null,
  recipientFamilyMemberId: null,
  recipientExternalBeneficiaryId: "ext-charity",
};

let fetchMock: ReturnType<typeof vi.fn>;

function writeCalls(): Array<{ url: string; method: string; body: unknown }> {
  return fetchMock.mock.calls
    .map(([url, init]) => ({
      url: String(url),
      method: (init as RequestInit | undefined)?.method ?? "GET",
      body: (() => {
        const b = (init as RequestInit | undefined)?.body;
        return typeof b === "string" ? JSON.parse(b) : b;
      })(),
    }))
    .filter((c) => c.method !== "GET");
}

async function saveAfter(button: string) {
  await act(async () => {
    render(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <EstateFlowView
          clientId={CLIENT_ID}
          scenarioId="base"
          scenarioName="Base case"
          isMarried={false}
          ownerNames={{ clientName: "Alex", spouseName: null }}
          initialClientData={buildClientData({
            accounts: [
              ...sampleAccounts,
              {
                id: "acct-ira",
                name: "Alex IRA",
                category: "retirement",
                subType: "traditional_ira",
                titlingType: "jtwros",
                value: 500_000,
                basis: 0,
                growthRate: 0.05,
                rmdEnabled: true,
                owners: [{ kind: "family_member", familyMemberId: LEGACY_FM_CLIENT, percent: 1 }],
              },
            ],
            externalBeneficiaries: [
              { id: "ext-charity", name: "Red Cross", kind: "charity", charityType: "public" },
            ],
          })}
          initialGifts={[SAVED_QCD, CASH_SERIES]}
          cpi={0.03}
        />
      </ClientAccessProvider>,
    );
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: button }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /^Save to/ }));
  });
  await waitFor(() => expect(writeCalls()).toHaveLength(1));
  return writeCalls()[0];
}

describe("EstateFlowView — base-case QCD saves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("POSTs a one-time Fixed QCD with both QCD columns", async () => {
    const call = await saveAfter("add fixed qcd");
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/gifts`);
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({
      year: 2041,
      yearRef: null,
      grantor: "client",
      ...TO_CHARITY,
      notes: null,
      valuationDiscount: null,
      amount: 20_000,
      useCrummeyPowers: false,
      accountId: null,
      qcdAccountId: "acct-ira",
      qcdAmountMode: "fixed",
    });
  });

  it("POSTs a recurring Full RMD QCD to the charity: amount 0, fixed series mode, the charity's own column", async () => {
    const call = await saveAfter("add full rmd qcd series");
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/gifts/series`);
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({
      grantor: "client",
      ...TO_CHARITY,
      startYear: 2040,
      startYearRef: null,
      endYear: 2045,
      endYearRef: null,
      annualAmount: 0,
      amountMode: "fixed",
      inflationAdjust: false,
      useCrummeyPowers: false,
      valuationDiscount: null,
      notes: null,
      qcdAccountId: "acct-ira",
      qcdAmountMode: "full_rmd",
    });
  });

  it("PATCHes a QCD switched to Cash with explicit nulls for both QCD columns", async () => {
    const call = await saveAfter("qcd to cash");
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/gifts/gift-qcd`);
    expect(call.method).toBe("PATCH");
    expect(call.body).toEqual({
      year: 2040,
      yearRef: null,
      grantor: "client",
      ...TO_CHARITY,
      notes: null,
      valuationDiscount: null,
      amount: 15_000,
      useCrummeyPowers: false,
      qcdAccountId: null,
      qcdAmountMode: null,
    });
  });

  it("PATCHes a Fixed QCD switched to Full RMD with amount 0", async () => {
    const call = await saveAfter("qcd to full rmd");
    expect(call.method).toBe("PATCH");
    expect(call.body).toMatchObject({
      amount: 0,
      qcdAccountId: "acct-ira",
      qcdAmountMode: "full_rmd",
    });
  });

  it("PATCHes a non-QCD series with explicit QCD nulls and the charity's own recipient column", async () => {
    const call = await saveAfter("edit cash series");
    expect(call.url).toBe(`/api/clients/${CLIENT_ID}/gifts/series/gs-cash`);
    expect(call.method).toBe("PATCH");
    expect(call.body).toMatchObject({
      ...TO_CHARITY,
      annualAmount: 12_000,
      qcdAccountId: null,
      qcdAmountMode: null,
    });
  });
});
