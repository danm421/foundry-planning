// @vitest-environment jsdom
//
// The trust dialog's transfer forms could not save AT ALL: `AddTrustForm`
// wrapped its whole body — transfer modals included — in
// `<form id="add-trust-form">`, and each transfer modal renders its own
// `<form>`. `dialog-shell.tsx` deliberately does NOT portal (its Esc rule
// finds a nested dialog by querying inside the surface), so the nesting was
// real in the DOM. Clicking Save did a NATIVE browser submit: the page
// navigated to `…/details/family?transferYear=YYYY`, dropping the
// `?scenario=` param and destroying the dialog, and no POST was ever issued.
//
// 🚨 Why the rest of the suite is blind to it: every other test for these
// forms (`transfer-asset-form.test.tsx`, `transfer-cash-form.test.tsx`,
// `transfer-forms-scenario-write.test.tsx`, …) renders the child STANDALONE,
// so jsdom never sees the nesting. A component test that renders a child in
// isolation cannot see a defect that only exists in the composed tree. This
// file exists to mount the REAL parent.
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before the component import
// ---------------------------------------------------------------------------

vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({
    submit: (
      _edit: unknown,
      baseFallback: { url: string; method: string; body?: unknown },
    ) =>
      fetch(baseFallback.url, {
        method: baseFallback.method,
        headers: { "Content-Type": "application/json" },
        body: baseFallback.body !== undefined ? JSON.stringify(baseFallback.body) : undefined,
      }),
    scenarioActive: false,
  }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-abc/details/family",
}));

vi.mock("@/hooks/use-scenario-state", () => ({
  useScenarioState: () => ({ scenarioId: null, setScenario: vi.fn() }),
}));

vi.mock("@/components/milestone-year-picker", () => ({
  default: ({
    value,
    onChange,
    label,
  }: {
    value: number;
    onChange: (y: number, ref: null) => void;
    label: string;
  }) => (
    <div>
      <label>{label}</label>
      <input
        type="number"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value), null)}
      />
    </div>
  ),
}));

import AddTrustForm from "../add-trust-form";
import type { Entity } from "../../family-view";
import type { AssetsTabAccount } from "../assets-tab";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = "client-abc";
const TRUST_ID = "trust-xyz";
const MEMBER_ID = "member-1";

const EDITING: Entity = {
  id: TRUST_ID,
  name: "Smith Family Trust",
  entityType: "trust",
  trustSubType: "irrevocable",
  isIrrevocable: true,
  grantor: "client",
  trustee: null,
  trustEnds: "survivorship",
  includeInPortfolio: false,
  isGrantor: false,
  notes: null,
  value: "0",
  basis: "0",
  owners: [],
  owner: null,
  beneficiaries: null,
  distributionMode: null,
  distributionAmount: null,
  distributionPercent: null,
};

/** One family-owned, non-retirement, non-default-checking account, so the
 *  asset form has an eligible asset auto-selected and Save is enabled. */
const ASSET_ACCOUNT: AssetsTabAccount = {
  id: "acc-1",
  name: "Family LLC Units",
  value: 1_000_000,
  subType: "other",
  isDefaultChecking: false,
  owners: [{ kind: "family_member", familyMemberId: MEMBER_ID, percent: 1 }],
};

/** `showNotesAndSales` opens the Notes & sales tab for an IDGT — the only
 *  route to SellToTrustDialog, the fourth <form> this dialog used to nest. */
const IDGT: Entity = { ...EDITING, trustSubType: "idgt", isGrantor: true };

const LEDGER_SUMMARY = {
  perGrantor: {
    client: { used: 3_000_000, total: 13_610_000 },
    spouse: { used: 1_500_000, total: 13_610_000 },
  },
  perTrust: { [TRUST_ID]: { client: 500_000, spouse: 0 } },
};

function renderTrustDialog(
  activeTab: "transfers" | "notes-sales" = "transfers",
  editing: Entity = EDITING,
) {
  return render(
    <AddTrustForm
      clientId={CLIENT_ID}
      editing={editing}
      household={{ client: { firstName: "Alice" }, spouse: { firstName: "Bob" } }}
      members={[]}
      externals={[]}
      entities={[]}
      initialDesignations={[]}
      activeTab={activeTab}
      accounts={[ASSET_ACCOUNT]}
      liabilities={[]}
      incomes={[]}
      expenses={[]}
      assetFamilyMembers={[]}
      planStartYear={2026}
      onSaved={vi.fn()}
      onClose={vi.fn()}
      onSubmitStateChange={vi.fn()}
    />,
  );
}

/** Opens one of the three transfer modals through the real Add-transfer menu.
 *  One regex names both the menu item and the dialog: DialogShell sets
 *  `aria-label={title}`, and the menu item differs from that title only in
 *  capitalisation ("Asset transfer" vs "Asset Transfer"), which /i absorbs. */
async function openTransferModal(name: RegExp) {
  await screen.findByText(/No transfers recorded yet/i);
  fireEvent.click(screen.getByRole("button", { name: /add transfer/i }));
  fireEvent.click(screen.getByRole("button", { name }));
  return waitFor(() => screen.getByRole("dialog", { name }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AddTrustForm — transfer modals are not nested inside the trust form", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async (url: string) => {
      if (typeof url === "string" && url.includes("/gifts/ledger")) {
        return { ok: true, json: () => Promise.resolve(LEDGER_SUMMARY) };
      }
      return { ok: true, json: () => Promise.resolve([]) };
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // The structural ratchet. `form form` is exactly the DOM shape the HTML spec
  // forbids and the browser reacts to — assert it over the whole document, so
  // it stays honest no matter where the modals move to.
  const NESTING_CASES: Array<[string, RegExp, string]> = [
    ["Asset Transfer", /asset transfer/i, "transfer-asset-form"],
    ["Cash Gift", /cash gift/i, "transfer-cash-form"],
    ["Recurring Gift Series", /recurring gift series/i, "transfer-series-form"],
  ];

  it.each(NESTING_CASES)(
    "%s: renders no <form> inside another <form>",
    async (_label, name, innerFormId) => {
      renderTrustDialog();
      const dialog = await openTransferModal(name);

      // Both forms are present…
      expect(document.getElementById("add-trust-form")).toBeInTheDocument();
      const inner = document.getElementById(innerFormId);
      expect(inner).toBeInTheDocument();

      // …and neither contains the other.
      expect(document.querySelectorAll("form form")).toHaveLength(0);
      expect(inner!.closest("#add-trust-form")).toBeNull();

      // The walkthrough's probe, folded in: Save must own the transfer form,
      // not the trust form. It does not go red on the nesting by itself (the
      // transfer form is still the nearest ancestor either way) — it guards
      // the binding if these modals are ever restructured again.
      const save = within(dialog).getByRole("button", { name: /^Save$/i });
      expect((save as HTMLButtonElement).form?.id).toBe(innerFormId);
    },
  );

  // The fourth nested <form>, reached a different way: it is not one of the
  // Add-transfer modals but a dialog the Notes & sales tab renders inline, so
  // moving only the three transfer modals would have left it broken.
  it("Sell to trust: renders no <form> inside another <form>", async () => {
    renderTrustDialog("notes-sales", IDGT);

    fireEvent.click(
      await screen.findByRole("button", { name: /sell an asset to the trust/i }),
    );
    const dialog = await waitFor(() => screen.getByRole("dialog", { name: /sell to/i }));

    const inner = within(dialog).getByRole("button", { name: /sell to trust/i });
    expect((inner as HTMLButtonElement).form?.id).toBe("sell-to-trust-form");
    expect(document.getElementById("sell-to-trust-form")).toBeInTheDocument();
    expect(document.querySelectorAll("form form")).toHaveLength(0);
  });

  // Composed-tree end-to-end guards. Honest caveat: these two were GREEN
  // before the fix — jsdom answers a nested form's submit through React's
  // delegated listener, so it never performs the native navigation a real
  // browser does. Only the structural assertion above went red here; the
  // runtime proof is the browser pass. They stay because they pin the
  // parent→child prop wiring the standalone tests can't reach.
  it("an asset transfer's Save posts the gift instead of natively submitting", async () => {
    renderTrustDialog();
    const dialog = await openTransferModal(/asset transfer/i);

    fireEvent.click(within(dialog).getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(postedGiftBodies(fetchMock)).toHaveLength(1);
    });
    expect(postedGiftBodies(fetchMock)[0]).toMatchObject({
      recipientEntityId: TRUST_ID,
      accountId: ASSET_ACCOUNT.id,
      grantor: "client",
    });
  });

  it("a cash gift's Save posts the gift instead of natively submitting", async () => {
    renderTrustDialog();
    const dialog = await openTransferModal(/cash gift/i);

    fireEvent.change(within(dialog).getByPlaceholderText(/e\.g\. 10,000/i), {
      target: { value: "18000" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: /^Save$/i }));

    await waitFor(() => {
      expect(postedGiftBodies(fetchMock)).toHaveLength(1);
    });
    expect(postedGiftBodies(fetchMock)[0]).toMatchObject({
      recipientEntityId: TRUST_ID,
      amount: 18000,
      grantor: "client",
    });
  });
});

/** Every POST the component made to the gifts collection, body parsed. Reads
 *  the call log rather than `toHaveBeenCalledWith` so the trust dialog's own
 *  GET traffic (transfers, series, ledger) can't satisfy the assertion. */
function postedGiftBodies(fetchMock: ReturnType<typeof vi.fn>): unknown[] {
  return fetchMock.mock.calls
    .filter(
      ([url, init]) =>
        typeof url === "string" &&
        url.endsWith(`/api/clients/${CLIENT_ID}/gifts`) &&
        (init as RequestInit | undefined)?.method === "POST",
    )
    .map(([, init]) => JSON.parse((init as RequestInit).body as string));
}
