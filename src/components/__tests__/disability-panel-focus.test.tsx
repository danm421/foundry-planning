// @vitest-environment jsdom
/**
 * Focus mode — the Solver's Changes tab opens ONE disability policy's editor.
 *
 * With `focus` set the panel renders only the policy dialog (no page chrome)
 * and hands control back through `onFocusClose` when it goes away — or as
 * "unavailable" when there is no editor for the row (a missing id, another
 * kind, view-only access). A delete runs silently through the scenario writer.
 * The Solver is always inside a scenario, so the writer is NOT mocked: these
 * tests pin the whole request list.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ClientInfo, DisabilityPolicy } from "@/engine/types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("scenario=scn-1"),
  usePathname: () => "/clients/c1/solver",
}));

import DisabilityPanel, { type DisabilityPanelProps } from "@/components/disability-panel";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";
import type { FocusCloseOutcome } from "@/hooks/use-focus-close-once";

const POLICY: DisabilityPolicy = {
  id: "d-1",
  name: "Group disability",
  insured: "client",
  coveredEarningsMode: "salary",
  coveredEarningsAmount: null,
  shortTerm: { eliminationDays: 7, benefitPct: 0.6, durationWeeks: 13, monthlyMax: null },
  longTerm: {
    eliminationDays: 90,
    benefitPct: 0.6,
    monthlyMax: 10_000,
    benefitPeriod: { mode: "to_age", age: 65 },
  },
  benefitTaxable: true,
  colaRate: 0,
  annualPremium: 0,
  premiumPayer: "employer",
};
const CLIENT: ClientInfo = {
  firstName: "Cooper",
  lastName: "Reed",
  dateOfBirth: "1980-06-15",
  retirementAge: 65,
  planEndAge: 95,
  spouseName: "Jane",
  spouseDob: "1982-03-01",
  filingStatus: "married_joint",
};
const PROPS: DisabilityPanelProps = {
  clientId: "c1",
  policies: [POLICY],
  clientFirstName: "Cooper",
  spouseFirstName: "Jane",
  currentSalaryByPerson: { client: 200_000, spouse: 0 },
  currentYear: 2026,
  planStartYear: 2024,
  inflationRate: 0.03,
  planEndYear: 2060,
  client: CLIENT,
};

type OnFocusClose = Mock<(outcome?: FocusCloseOutcome) => void>;

function renderFocused(
  focus: EditorFocus,
  { permission = "edit" as "edit" | "view", onFocusClose = vi.fn() as OnFocusClose } = {},
) {
  const utils = render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <DisabilityPanel {...PROPS} focus={focus} onFocusClose={onFocusClose} />
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

describe("DisabilityPanel focus mode", () => {
  it("opens the policy dialog alone for an edit focus", async () => {
    renderFocused({ kind: "disability_policy", id: "d-1" });
    expect(await screen.findByRole("dialog", { name: "Edit disability policy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Disability" })).toBeNull();
    expect(screen.queryByText("Add workplace coverage")).toBeNull();
  });

  it("opens the Add dialog for a create focus", async () => {
    renderFocused({ intent: "create", kind: "disability_policy" });
    expect(await screen.findByRole("dialog", { name: "Add disability policy" })).toBeInTheDocument();
  });

  it("saves a create as a scenario add, then hands control back with no outcome", async () => {
    const u = renderFocused({ intent: "create", kind: "disability_policy" });
    fireEvent.change(await screen.findByLabelText("Policy name"), { target: { value: "Private LTD" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(u.onFocusClose).toHaveBeenCalledTimes(1));
    expect(u.onFocusClose).toHaveBeenCalledWith();
    expect(requestList()).toEqual(["POST /api/clients/c1/scenarios/scn-1/changes"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).op).toBe("add");
  });

  it("hands control back, with no outcome, when the dialog closes", async () => {
    const u = renderFocused({ kind: "disability_policy", id: "d-1" });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(u.onFocusClose).toHaveBeenCalledTimes(1));
    expect(u.onFocusClose).toHaveBeenCalledWith();
    expect(requestList()).toEqual([]);
  });

  it("deletes silently through the scenario writer, then closes", async () => {
    const u = renderFocused({ intent: "delete", kind: "disability_policy", id: "d-1" });
    await waitFor(() => expect(u.onFocusClose).toHaveBeenCalledTimes(1));
    expect(u.onFocusClose).toHaveBeenCalledWith();
    expect(requestList()).toEqual(["POST /api/clients/c1/scenarios/scn-1/changes"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      op: "remove", targetKind: "disability_policy", targetId: "d-1",
    });
    expect(u.container).toBeEmptyDOMElement();
  });

  it("reports a failed delete as failed", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const u = renderFocused({ intent: "delete", kind: "disability_policy", id: "d-1" });
    await waitFor(() => expect(u.onFocusClose).toHaveBeenCalledWith("failed"));
  });

  it("is unavailable for an id that is not a listed policy", async () => {
    await expectUnavailable(renderFocused({ kind: "disability_policy", id: "nope" }));
  });

  it("is unavailable for another kind", async () => {
    await expectUnavailable(renderFocused({ kind: "account", id: "d-1" }));
  });

  it("is unavailable under view-only access", async () => {
    await expectUnavailable(renderFocused({ kind: "disability_policy", id: "d-1" }, { permission: "view" }));
  });
});
