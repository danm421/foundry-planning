// @vitest-environment jsdom
/**
 * Focus mode — the Solver's Changes tab opens ONE life policy's editor.
 *
 * With `focus` set the panel renders only the policy dialog (no page chrome)
 * and hands control back through `onFocusClose` when it goes away — or as
 * "unavailable" when the page offers no editor for the row (a disability
 * policy, a missing id, view-only access). A delete runs silently through the
 * scenario writer. The Solver is always inside a scenario, so the writer is
 * NOT mocked: these tests pin the whole request list.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("scenario=scn-1"),
  usePathname: () => "/clients/c1/solver",
}));

import InsurancePanel, { type InsurancePanelProps } from "@/components/insurance-panel";
import { ClientAccessProvider } from "@/components/client-access-provider";
import { PAGE_FOCUS_KINDS, type EditorFocus } from "@/lib/scenario/change-editor-target";
import type { FocusCloseOutcome } from "@/hooks/use-focus-close-once";

const CLIENT_FM = "11111111-1111-4111-8111-111111111111";
const WHOLE = {
  id: "p-whole", name: "Whole 100", category: "life_insurance" as const, subType: "whole_life" as const,
  ownerRef: { kind: "joint" as const }, insuredPerson: "client" as const,
  value: "125000", activationYear: null, activationYearRef: null,
};
const POLICY = {
  faceValue: 500000, costBasis: 0, premiumAmount: 9000, premiumYears: null,
  premiumPayer: "owner", policyType: "whole", termIssueYear: null, termLengthYears: null,
  endsAtInsuredRetirement: false, cashValueGrowthMode: "basic",
  premiumScheduleMode: "off", deathBenefitScheduleMode: "off", incomeScheduleMode: "off",
  postPayoutGrowthRate: 0.06, postPayoutModelPortfolioId: null, cashValueSchedule: [],
};
const PROPS = {
  clientId: "c1", clientFirstName: "Cooper", spouseFirstName: "Jane",
  accounts: [WHOLE], policies: { "p-whole": POLICY },
  entities: [],
  familyMembers: [
    { id: CLIENT_FM, firstName: "Cooper", lastName: "C", relationship: "child", role: "client", dateOfBirth: null, notes: null },
  ],
  externalBeneficiaries: [], modelPortfolios: [], resolvedInflationRate: 0.025,
  scheduleStartYear: 2026, scheduleEndYear: 2060,
} as unknown as InsurancePanelProps;

type OnFocusClose = Mock<(outcome?: FocusCloseOutcome) => void>;

function renderFocused(
  focus: EditorFocus,
  { permission = "edit" as "edit" | "view", onFocusClose = vi.fn() as OnFocusClose } = {},
) {
  const utils = render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <InsurancePanel {...PROPS} focus={focus} onFocusClose={onFocusClose} />
    </ClientAccessProvider>,
  );
  return { ...utils, onFocusClose };
}

const fetchMock = vi.fn();
const requestList = () =>
  (fetchMock.mock.calls as [string, { method: string }][]).map(([url, init]) => `${init.method} ${url}`);

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

async function expectUnavailable(u: { container: HTMLElement; onFocusClose: OnFocusClose }) {
  await waitFor(() => expect(u.onFocusClose).toHaveBeenCalledTimes(1));
  expect(u.onFocusClose).toHaveBeenCalledWith("unavailable");
  expect(u.container).toBeEmptyDOMElement();
}

describe("InsurancePanel focus mode", () => {
  it("opens the policy dialog alone for an account edit focus", async () => {
    renderFocused({ kind: "account", id: "p-whole" });
    expect(await screen.findByRole("dialog", { name: "Edit policy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Insurance" })).toBeNull();
    expect(screen.queryByText("+ Add policy")).toBeNull();
  });

  it("opens the Add policy dialog for a life_insurance create focus", async () => {
    renderFocused({ intent: "create", kind: "account", variant: "life_insurance" });
    expect(await screen.findByRole("dialog", { name: "Add policy" })).toBeInTheDocument();
  });

  it("hands control back, with no outcome, when the dialog closes", async () => {
    const u = renderFocused({ kind: "account", id: "p-whole" });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(u.onFocusClose).toHaveBeenCalledTimes(1));
    expect(u.onFocusClose).toHaveBeenCalledWith();
  });

  it("deletes silently through the scenario writer, then closes", async () => {
    const u = renderFocused({ intent: "delete", kind: "account", id: "p-whole" });
    await waitFor(() => expect(u.onFocusClose).toHaveBeenCalledTimes(1));
    expect(u.onFocusClose).toHaveBeenCalledWith();
    expect(requestList()).toEqual(["POST /api/clients/c1/scenarios/scn-1/changes"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      op: "remove", targetKind: "account", targetId: "p-whole",
    });
    expect(u.container).toBeEmptyDOMElement();
  });

  it("reports a failed delete as failed", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const u = renderFocused({ intent: "delete", kind: "account", id: "p-whole" });
    await waitFor(() => expect(u.onFocusClose).toHaveBeenCalledWith("failed"));
  });

  it("is unavailable for a disability policy (the host opens DisabilityPanel for those)", async () => {
    await expectUnavailable(renderFocused({ kind: "disability_policy", id: "d-1" }));
  });

  it("is unavailable for an unknown account id", async () => {
    await expectUnavailable(renderFocused({ kind: "account", id: "nope" }));
  });

  it("is unavailable under view-only access", async () => {
    await expectUnavailable(renderFocused({ kind: "account", id: "p-whole" }, { permission: "view" }));
  });

  // The Insurance page hosts three focus views: this panel (life policies, which
  // are `account` rows), the disability panel (`disability_policy`) and the LTC
  // panel (`ltc_policy`). The page's list is their union, pinned once, here.
  it("PAGE_FOCUS_KINDS lists exactly the kinds the Insurance page's three panels handle", () => {
    expect(PAGE_FOCUS_KINDS["insurance"]).toEqual(["account", "disability_policy", "ltc_policy"]);
  });
});
