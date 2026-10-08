// @vitest-environment jsdom
/**
 * Focus mode — the Solver's Changes tab opens ONE long-term care policy's editor.
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
import type { LtcPolicy } from "@/engine/types";
import { LTC_STANDALONE_DEFAULTS } from "@/lib/schemas/ltc-policies";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams("scenario=scn-1"),
  usePathname: () => "/clients/c1/solver",
}));

import LtcPanel, { type LtcPanelProps } from "@/components/ltc-panel";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";
import type { FocusCloseOutcome } from "@/hooks/use-focus-close-once";

const STANDALONE: LtcPolicy = {
  id: "l-1", name: "Genworth LTC", insured: "client", carrier: null, issueYear: 2026,
  ...LTC_STANDALONE_DEFAULTS, annualPremium: 2400, partnership: false, notes: null,
};
const WHOLE = { id: "a1", name: "Whole Life", insuredPerson: "client" as const, faceValue: 500_000 };
const PROPS: LtcPanelProps = {
  clientId: "c1", policies: [STANDALONE], lifePolicies: [WHOLE],
  clientFirstName: "Cooper", spouseFirstName: "Jane", spouseDob: "1972-01-01", currentYear: 2026,
};

type OnFocusClose = Mock<(outcome?: FocusCloseOutcome) => void>;

function renderFocused(
  focus: EditorFocus,
  { permission = "edit" as "edit" | "view", onFocusClose = vi.fn() as OnFocusClose } = {},
) {
  const utils = render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <LtcPanel {...PROPS} focus={focus} onFocusClose={onFocusClose} />
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

describe("LtcPanel focus mode", () => {
  it("opens the policy dialog alone for an edit focus", async () => {
    renderFocused({ kind: "ltc_policy", id: "l-1" });
    expect(await screen.findByRole("dialog", { name: "Edit long-term care policy" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Long-term care" })).toBeNull();
    expect(screen.queryByText("Add policy")).toBeNull();
  });

  it("opens the Add dialog for a create focus", async () => {
    renderFocused({ intent: "create", kind: "ltc_policy" });
    expect(await screen.findByRole("dialog", { name: "Add long-term care policy" })).toBeInTheDocument();
  });

  it("saves a create as a scenario add, then hands control back with no outcome", async () => {
    const u = renderFocused({ intent: "create", kind: "ltc_policy" });
    fireEvent.change(await screen.findByLabelText("Policy name"), { target: { value: "Genworth" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(u.onFocusClose).toHaveBeenCalledTimes(1));
    expect(u.onFocusClose).toHaveBeenCalledWith();
    expect(requestList()).toEqual(["POST /api/clients/c1/scenarios/scn-1/changes"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).op).toBe("add");
  });

  it("hands control back, with no outcome, when the dialog closes", async () => {
    const u = renderFocused({ kind: "ltc_policy", id: "l-1" });
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(u.onFocusClose).toHaveBeenCalledTimes(1));
    expect(u.onFocusClose).toHaveBeenCalledWith();
    expect(requestList()).toEqual([]);
  });

  it("deletes silently through the scenario writer, then closes", async () => {
    const u = renderFocused({ intent: "delete", kind: "ltc_policy", id: "l-1" });
    await waitFor(() => expect(u.onFocusClose).toHaveBeenCalledTimes(1));
    expect(u.onFocusClose).toHaveBeenCalledWith();
    expect(requestList()).toEqual(["POST /api/clients/c1/scenarios/scn-1/changes"]);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      op: "remove", targetKind: "ltc_policy", targetId: "l-1",
    });
    expect(u.container).toBeEmptyDOMElement();
  });

  it("reports a failed delete as failed", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    const u = renderFocused({ intent: "delete", kind: "ltc_policy", id: "l-1" });
    await waitFor(() => expect(u.onFocusClose).toHaveBeenCalledWith("failed"));
  });

  it("is unavailable for an id that is not a listed policy", async () => {
    await expectUnavailable(renderFocused({ kind: "ltc_policy", id: "nope" }));
  });

  it("is unavailable for another kind", async () => {
    await expectUnavailable(renderFocused({ kind: "account", id: "l-1" }));
  });

  it("is unavailable under view-only access", async () => {
    await expectUnavailable(renderFocused({ kind: "ltc_policy", id: "l-1" }, { permission: "view" }));
  });
});
