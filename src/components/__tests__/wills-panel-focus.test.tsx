// @vitest-environment jsdom
/**
 * Focus mode — the Solver's Changes tab opens ONE will's editor.
 *
 * The Wills page has no will dialog: each grantor's will is edited in place,
 * in that grantor's section (bequests, residuary, delete). So with `focus` set
 * the view renders just the focused will's section, inside a dialog so the
 * advisor can close it, and hands control back through `onFocusClose` when
 * that dialog goes away — or, as "unavailable", when the page shows no
 * editable section for the will (it's missing, it's the co-client's with no
 * co-client on file, it isn't the will the page shows for its grantor, or the
 * advisor has view-only access).
 *
 * The Solver is always inside a scenario, so `?scenario=` is in the URL and
 * `use-scenario-writer` is NOT mocked: the save test pins that an edit made in
 * the focused section writes to the scenario, not the base plan.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

const SCENARIO_ID = "scn-1";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(`scenario=${SCENARIO_ID}`),
  usePathname: () => "/clients/c-1/solver",
}));

import WillsPanel, { type WillsPanelProps, type WillsPanelWill } from "@/components/wills-panel";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { EditorFocus } from "@/lib/scenario/change-editor-target";
import type { FocusCloseOutcome } from "@/hooks/use-focus-close-once";

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const CLIENT_ID = "c-1";

type OnFocusClose = Mock<(outcome?: FocusCloseOutcome) => void>;

const CLIENT_WILL: WillsPanelWill = {
  id: "will-client",
  grantor: "client",
  bequests: [
    {
      kind: "asset",
      id: "bq-1",
      name: "Brokerage to Carol",
      assetMode: "specific",
      accountId: "acct-1",
      entityId: null,
      percentage: 60,
      condition: "always",
      sortOrder: 0,
      recipients: [
        { recipientKind: "family_member", recipientId: "fm-1", percentage: 100, sortOrder: 0 },
      ],
    },
  ],
  residuaryRecipients: [],
};

const SPOUSE_WILL: WillsPanelWill = {
  id: "will-spouse",
  grantor: "spouse",
  bequests: [
    {
      kind: "asset",
      id: "bq-2",
      name: "Everything to Alice",
      assetMode: "all_assets",
      accountId: null,
      entityId: null,
      percentage: 100,
      condition: "always",
      sortOrder: 0,
      recipients: [
        { recipientKind: "spouse", recipientId: null, percentage: 100, sortOrder: 0 },
      ],
    },
  ],
  residuaryRecipients: [],
};

const PROPS: WillsPanelProps = {
  clientId: CLIENT_ID,
  primary: { firstName: "Alice", lastName: "Test", spouseName: "Bob", spouseLastName: "Test" },
  accounts: [{ id: "acct-1", name: "Fidelity Brokerage", category: "taxable", ownerEntityId: null, value: 500000 }],
  liabilities: [],
  familyMembers: [{ id: "fm-1", firstName: "Carol", lastName: "Test", role: "child" }],
  externalBeneficiaries: [],
  entities: [],
  initialWills: [CLIENT_WILL, SPOUSE_WILL],
};

function renderFocused(
  focus: EditorFocus,
  {
    onFocusClose = vi.fn(),
    permission = "edit",
    props = PROPS,
  }: {
    onFocusClose?: OnFocusClose;
    permission?: "view" | "edit";
    props?: WillsPanelProps;
  } = {},
) {
  const utils = render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <WillsPanel {...props} focus={focus} onFocusClose={onFocusClose} />
    </ClientAccessProvider>,
  );
  return { ...utils, onFocusClose };
}

const editWillDialog = () => screen.getByRole("dialog", { name: "Edit will" });

async function expectUnavailable(utils: { container: HTMLElement; onFocusClose: OnFocusClose }) {
  await waitFor(() => expect(utils.onFocusClose).toHaveBeenCalledTimes(1));
  expect(utils.onFocusClose).toHaveBeenCalledWith("unavailable");
  expect(utils.container).toBeEmptyDOMElement();
  expect(screen.queryByRole("dialog")).toBeNull();
}

type FetchInit = { method?: string; body?: string } | undefined;
type FetchLike = (url: string, init?: FetchInit) => Promise<Pick<Response, "ok" | "status" | "json">>;
const fetchMock = vi.fn<FetchLike>();

/** The scenario-changes POSTs the panel made, parsed. */
function scenarioChangeBodies(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls
    .filter(([url, init]) => url === `/api/clients/${CLIENT_ID}/scenarios/${SCENARIO_ID}/changes` && init?.method === "POST")
    .map(([, init]) => JSON.parse(init!.body!) as Record<string, unknown>);
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Which editor opens
// ---------------------------------------------------------------------------

describe("WillsPanel focus mode — which editor opens", () => {
  it("a client will → that will's section alone, in an Edit will dialog", () => {
    renderFocused({ kind: "will", id: "will-client" });

    const dialog = within(editWillDialog());
    expect(dialog.getByRole("heading", { name: "Alice Test's Will" })).toBeTruthy();
    expect(dialog.getByText("Brokerage to Carol")).toBeTruthy();
    expect(dialog.getByText("60% of Fidelity Brokerage")).toBeTruthy();
    // The other grantor's will is not part of this editor.
    expect(screen.queryByRole("heading", { name: "Bob Test's Will" })).toBeNull();
    expect(screen.queryByText("Everything to Alice")).toBeNull();
  });

  it("a co-client will → the co-client's section alone", () => {
    renderFocused({ kind: "will", id: "will-spouse" });

    const dialog = within(editWillDialog());
    expect(dialog.getByRole("heading", { name: "Bob Test's Will" })).toBeTruthy();
    expect(dialog.getByText("Everything to Alice")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Alice Test's Will" })).toBeNull();
  });

  it("the section's own editors work in place — Edit opens the bequest dialog pre-filled", () => {
    renderFocused({ kind: "will", id: "will-client" });

    fireEvent.click(within(editWillDialog()).getByRole("button", { name: "Edit bequest" }));

    const bequest = within(screen.getByRole("dialog", { name: "Edit bequest" }));
    expect((bequest.getByLabelText("Percentage") as HTMLInputElement).value).toBe("60");
    expect((bequest.getByLabelText("Asset or debt") as HTMLSelectElement).value).toBe("asset:acct-1");
  });
});

// ---------------------------------------------------------------------------
// Unavailable
// ---------------------------------------------------------------------------

describe("WillsPanel focus mode — unavailable", () => {
  it("a will that isn't there → onFocusClose(\"unavailable\") once, nothing rendered", async () => {
    const utils = renderFocused({ kind: "will", id: "gone" });

    await expectUnavailable(utils);

    // A parent re-render with fresh inline props must not close it again.
    utils.rerender(
      <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
        <WillsPanel {...PROPS} focus={{ kind: "will", id: "gone" }} onFocusClose={utils.onFocusClose} />
      </ClientAccessProvider>,
    );
    expect(utils.onFocusClose).toHaveBeenCalledTimes(1);
  });

  it("a kind this view doesn't edit → unavailable", async () => {
    await expectUnavailable(renderFocused({ kind: "account", id: "will-client" }));
  });

  it("a co-client will with no co-client on file → unavailable, as the page hides that section", async () => {
    await expectUnavailable(
      renderFocused(
        { kind: "will", id: "will-spouse" },
        { props: { ...PROPS, primary: { ...PROPS.primary, spouseName: null, spouseLastName: null } } },
      ),
    );
  });

  it("a second will for the same grantor → unavailable, as the page shows only the first", async () => {
    const second: WillsPanelWill = { ...CLIENT_WILL, id: "will-client-2", bequests: [] };
    await expectUnavailable(
      renderFocused(
        { kind: "will", id: "will-client-2" },
        { props: { ...PROPS, initialWills: [CLIENT_WILL, second, SPOUSE_WILL] } },
      ),
    );
  });

  it("without edit permission → unavailable, as the page offers no editor either", async () => {
    await expectUnavailable(renderFocused({ kind: "will", id: "will-client" }, { permission: "view" }));
  });
});

// ---------------------------------------------------------------------------
// Closing and saving
// ---------------------------------------------------------------------------

describe("WillsPanel focus mode — closing", () => {
  // A normal close carries no outcome at all — not even an explicit undefined.
  it.each([
    { how: "Done", close: () => fireEvent.click(within(editWillDialog()).getByRole("button", { name: "Done" })) },
    { how: "the Close button", close: () => fireEvent.click(within(editWillDialog()).getByRole("button", { name: "Close" })) },
    { how: "Escape", close: () => fireEvent.keyDown(window, { key: "Escape" }) },
    { how: "the backdrop", close: () => fireEvent.click(screen.getByTestId("dialog-overlay")) },
  ])("closing with $how calls onFocusClose()", ({ close }) => {
    const { onFocusClose, container } = renderFocused({ kind: "will", id: "will-client" });
    expect(onFocusClose).not.toHaveBeenCalled();

    close();

    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
    expect(container).toBeEmptyDOMElement();
  });

  // Ruling F-wills: closing unmounts the view, so a close mid-save would hide a
  // failed save's error for good.
  it("ignores every close while a save is pending, and shows the error when it fails", async () => {
    let settle!: (res: Pick<Response, "ok" | "status" | "json">) => void;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = resolve;
        }),
    );
    const { onFocusClose } = renderFocused({ kind: "will", id: "will-client" });
    fireEvent.click(within(editWillDialog()).getByRole("button", { name: "Delete bequest" }));
    await waitFor(() => expect(within(editWillDialog()).getByText("Saving…")).toBeTruthy());

    const done = within(editWillDialog()).getByRole("button", { name: "Done" });
    expect(done).toHaveProperty("disabled", true);
    fireEvent.click(done);
    fireEvent.click(within(editWillDialog()).getByRole("button", { name: "Close" }));
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(screen.getByTestId("dialog-overlay"));
    expect(editWillDialog()).toBeTruthy();
    expect(onFocusClose).not.toHaveBeenCalled();

    settle({ ok: false, status: 500, json: async () => ({}) });

    await waitFor(() =>
      expect(within(editWillDialog()).getByText("scenario edit failed: HTTP 500")).toBeTruthy(),
    );
    expect(within(editWillDialog()).getByRole("button", { name: "Done" })).toHaveProperty("disabled", false);
    expect(onFocusClose).not.toHaveBeenCalled();
  });

  it("Escape inside the bequest dialog closes only that dialog, not the will editor", () => {
    const { onFocusClose } = renderFocused({ kind: "will", id: "will-client" });
    fireEvent.click(within(editWillDialog()).getByRole("button", { name: "Edit bequest" }));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Edit bequest" })).toBeNull();
    expect(editWillDialog()).toBeTruthy();
    expect(onFocusClose).not.toHaveBeenCalled();
  });

  it("a bequest edit writes a scenario will edit and keeps the editor open until Done", async () => {
    const { onFocusClose } = renderFocused({ kind: "will", id: "will-client" });
    fireEvent.click(within(editWillDialog()).getByRole("button", { name: "Edit bequest" }));
    const bequest = within(screen.getByRole("dialog", { name: "Edit bequest" }));
    fireEvent.change(bequest.getByLabelText("Percentage"), { target: { value: "75" } });

    fireEvent.click(bequest.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit bequest" })).toBeNull());
    expect(scenarioChangeBodies()).toEqual([
      expect.objectContaining({
        op: "edit",
        targetKind: "will",
        targetId: "will-client",
        desiredFields: expect.objectContaining({
          bequests: [expect.objectContaining({ id: "bq-1", percentage: 75 })],
        }),
      }),
    ]);
    // Every edit in the section saves on its own, as on the page; the editor
    // stays open for the next one.
    expect(within(editWillDialog()).getByText("75% of Fidelity Brokerage")).toBeTruthy();
    expect(onFocusClose).not.toHaveBeenCalled();

    fireEvent.click(within(editWillDialog()).getByRole("button", { name: "Done" }));
    expect(onFocusClose).toHaveBeenCalledTimes(1);
    expect(onFocusClose).toHaveBeenCalledWith();
  });
});
