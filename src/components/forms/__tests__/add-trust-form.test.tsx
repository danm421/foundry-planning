// @vitest-environment jsdom
/**
 * Focused tests for the Transfers tab wiring in AddTrustForm (T21).
 *
 * Strategy: render AddTrustForm with activeTab="transfers" and editing set.
 * We mock the global fetch to return empty arrays so the self-fetch doesn't throw.
 * We verify that:
 *   1. TransfersTab renders (empty-state message visible).
 *   2. Clicking "Asset transfer" in the Add menu opens the asset modal.
 *
 * We do NOT test the self-fetch useEffect with real endpoints — that is
 * exercised manually in T23 (browser verification). Fetch mocks for two
 * endpoints in tandem are brittle and add little signal here.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import AddTrustForm from "../add-trust-form";
import type { Entity } from "../../family-view";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// useScenarioWriter is a hook that calls router.refresh() — mock the whole module
// so it doesn't fail in jsdom (Next.js router not available).
vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: vi.fn() }),
}));

// MilestoneYearPicker renders a complex picker — stub it to a plain number input
// so we don't have to set up the full milestones context.
vi.mock("@/components/milestone-year-picker", () => ({
  default: ({ value, onChange, label }: { value: number; onChange: (y: number, ref: null) => void; label: string }) => (
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

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CLIENT_ID = "client-abc";
const TRUST_ID = "trust-xyz";

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

const HOUSEHOLD = {
  client: { firstName: "Alice" },
  spouse: { firstName: "Bob" },
};

function defaultProps(activeTab: "details" | "assets" | "transfers" | "notes" = "transfers") {
  return {
    clientId: CLIENT_ID,
    editing: EDITING,
    household: HOUSEHOLD,
    members: [],
    externals: [],
    entities: [],
    initialDesignations: [],
    activeTab,
    accounts: [],
    liabilities: [],
    incomes: [],
    expenses: [],
    assetFamilyMembers: [],
    onSaved: vi.fn(),
    onClose: vi.fn(),
    onSubmitStateChange: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AddTrustForm — Transfers tab (T21)", () => {
  beforeEach(() => {
    // Stub fetch to return empty arrays for both gifts and gifts/series
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve([]),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders TransfersTab empty state when activeTab is transfers and editing is set", async () => {
    render(<AddTrustForm {...defaultProps("transfers")} />);
    // The empty-state message comes from TransfersTab itself
    expect(await screen.findByText(/No transfers recorded yet/i)).toBeInTheDocument();
  });

  it("shows create-mode fallback message when activeTab is transfers but editing is undefined", () => {
    const props = { ...defaultProps("transfers"), editing: undefined };
    render(<AddTrustForm {...props} />);
    expect(screen.getByText(/Transfer management is available when editing an existing trust/i)).toBeInTheDocument();
    expect(screen.queryByText(/No transfers recorded yet/i)).not.toBeInTheDocument();
  });

  it("clicking Asset transfer in the Add menu opens the asset modal", async () => {
    render(<AddTrustForm {...defaultProps("transfers")} />);
    // Wait for the tab to render
    await screen.findByText(/No transfers recorded yet/i);

    // Open the Add transfer menu
    fireEvent.click(screen.getByRole("button", { name: /add transfer/i }));
    // Click "Asset transfer"
    fireEvent.click(screen.getByRole("button", { name: /asset transfer/i }));

    // The modal dialog should appear (TransferAssetForm renders inside DialogShell
    // which has role="dialog")
    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /asset transfer/i })).toBeInTheDocument();
    });
  });

  it("clicking Cash gift in the Add menu opens the cash modal", async () => {
    render(<AddTrustForm {...defaultProps("transfers")} />);
    await screen.findByText(/No transfers recorded yet/i);

    fireEvent.click(screen.getByRole("button", { name: /add transfer/i }));
    fireEvent.click(screen.getByRole("button", { name: /cash gift/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /cash gift/i })).toBeInTheDocument();
    });
  });

  it("clicking Recurring gift series in the Add menu opens the series modal", async () => {
    render(<AddTrustForm {...defaultProps("transfers")} />);
    await screen.findByText(/No transfers recorded yet/i);

    fireEvent.click(screen.getByRole("button", { name: /add transfer/i }));
    fireEvent.click(screen.getByRole("button", { name: /recurring gift series/i }));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: /recurring gift series/i })).toBeInTheDocument();
    });
  });

  it("shows error banner when the transfers fetch returns 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Unauthorized" }),
    }));

    render(<AddTrustForm {...defaultProps("transfers")} />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/Couldn't load transfers/i);
    expect(screen.getByRole("alert")).toHaveTextContent(/Unauthorized/i);
  });
});

// ---------------------------------------------------------------------------
// CLUT funding pick save-flow tests (Task 6)
// ---------------------------------------------------------------------------

/** One brokerage account eligible for CLUT funding. */
const CLUT_ACCOUNT = {
  id: "acct-a",
  name: "Schwab Brokerage",
  value: 850_000,
  subType: "brokerage",
  isDefaultChecking: false,
  owners: [{ kind: "family_member" as const, familyMemberId: "fm-c", percent: 1.0 }],
};

/** Second brokerage account — used in the 2-pick edit-mode delete test. */
const CLUT_ACCOUNT_B = {
  id: "acct-b",
  name: "Fidelity Brokerage",
  value: 500_000,
  subType: "brokerage",
  isDefaultChecking: false,
  owners: [{ kind: "family_member" as const, familyMemberId: "fm-c", percent: 1.0 }],
};

/** CLUT editing fixture — only the Entity fields; splitInterest is form-internal. */
const EDITING_CLUT: Entity = {
  id: "trust-existing-id",
  name: "Existing CLUT",
  entityType: "trust",
  trustSubType: "clut",
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

describe("<AddTrustForm> CLUT funding picks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts an asset gift after the entity POST when an asset is picked for a new CLUT", async () => {
    // Record every fetch call so we can assert ordering.
    const calls: { url: string; method: string; body: unknown }[] = [];

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method?.toUpperCase() ?? "GET";
      let body: unknown = undefined;
      if (init?.body && typeof init.body === "string") {
        try { body = JSON.parse(init.body); } catch { body = init.body; }
      }
      calls.push({ url, method, body });

      if (method === "POST" && url.endsWith("/entities")) {
        return { ok: true, json: async () => ({ id: "trust-new-id", name: "New Trust" }) };
      }
      if (method === "PUT" && url.includes("/beneficiaries")) {
        return { ok: true, json: async () => ({}) };
      }
      if (method === "POST" && url.endsWith("/gifts")) {
        return { ok: true, json: async () => ({ id: "g-new" }) };
      }
      // Default: empty arrays (covers any incidental GETs)
      return { ok: true, json: async () => [] };
    }));

    render(
      <AddTrustForm
        {...defaultProps("details")}
        editing={undefined}
        accounts={[CLUT_ACCOUNT]}
      />,
    );

    // Switch to CLUT type
    fireEvent.change(screen.getByLabelText(/^Type/i), { target: { value: "clut" } });

    // Open the funding picker (trigger has id="clut-fmv" → labelled by "Funding-year FMV" label)
    fireEvent.click(screen.getByRole("button", { name: /funding-year fmv/i }));

    // Pick the first asset checkbox (the Schwab Brokerage account)
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    // Close the popover by clicking Done
    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    // Submit the form
    const form = document.getElementById("add-trust-form")!;
    fireEvent.submit(form);

    // Wait for the async submit chain to complete (entity POST + gift POST)
    await waitFor(() => {
      expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/gifts"))).toBe(true);
    });

    const entityCallIdx = calls.findIndex(
      (c) => c.method === "POST" && c.url.endsWith("/entities"),
    );
    const giftCallIdx = calls.findIndex(
      (c) => c.method === "POST" && c.url.endsWith("/gifts"),
    );

    expect(entityCallIdx).toBeGreaterThanOrEqual(0);
    expect(giftCallIdx).toBeGreaterThan(entityCallIdx);

    const giftCall = calls[giftCallIdx];
    expect(giftCall.body).toMatchObject({
      recipientEntityId: "trust-new-id",
      year: expect.any(Number),
      accountId: "acct-a",
      percent: 1.0,
    });
  });

  it("blocks Save with an error when origin=new and no funding picks", async () => {
    // Fetch mock — only GETs should fire (save is blocked before any POST)
    const calls: { url: string; method: string }[] = [];

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method?.toUpperCase() ?? "GET";
      calls.push({ url, method });
      return { ok: true, json: async () => [] };
    }));

    render(
      <AddTrustForm
        {...defaultProps("details")}
        editing={undefined}
        accounts={[CLUT_ACCOUNT]}
      />,
    );

    // Switch to CLUT type
    fireEvent.change(screen.getByLabelText(/^Type/i), { target: { value: "clut" } });

    // Do NOT open the picker — leave picks empty

    // Submit
    const form = document.getElementById("add-trust-form")!;
    fireEvent.submit(form);

    // Error message should appear synchronously (validation before fetch)
    await screen.findByText(/at least one funding asset/i);

    // No POST to /entities should have been made
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/entities"))).toBe(false);
  });

  it("fires DELETE when an originally-checked pick is unticked on edit", async () => {
    // The inception year the form defaults to (matches the gift row year)
    const INCEPTION_YEAR = new Date().getFullYear();

    const calls: { url: string; method: string; body: unknown }[] = [];

    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method?.toUpperCase() ?? "GET";
      let body: unknown = undefined;
      if (init?.body && typeof init.body === "string") {
        try { body = JSON.parse(init.body); } catch { body = init.body; }
      }
      calls.push({ url, method, body });

      // Initial gifts self-fetch: return TWO existing asset gifts (one per account)
      // so that unticking one still leaves one pick remaining (passes validation).
      if (method === "GET" && url.endsWith("/gifts")) {
        return {
          ok: true,
          json: async () => [
            {
              id: "g1",
              year: INCEPTION_YEAR,
              amount: null,
              grantor: "client" as const,
              recipientEntityId: "trust-existing-id",
              accountId: "acct-a",
              liabilityId: null,
              percent: "1",
              parentGiftId: null,
              useCrummeyPowers: false,
              notes: null,
            },
            {
              id: "g2",
              year: INCEPTION_YEAR,
              amount: null,
              grantor: "client" as const,
              recipientEntityId: "trust-existing-id",
              accountId: "acct-b",
              liabilityId: null,
              percent: "0.5",
              parentGiftId: null,
              useCrummeyPowers: false,
              notes: null,
            },
          ],
        };
      }
      // Series fetch
      if (method === "GET" && url.endsWith("/gifts/series")) {
        return { ok: true, json: async () => [] };
      }
      // Entity PUT (edit save)
      if (method === "PUT" && url.includes("/entities/")) {
        return { ok: true, json: async () => ({ ...EDITING_CLUT }) };
      }
      // Beneficiaries PUT
      if (method === "PUT" && url.includes("/beneficiaries")) {
        return { ok: true, json: async () => ({}) };
      }
      // Gift DELETE (either gift)
      if (method === "DELETE" && url.includes("/gifts/")) {
        return { ok: true, json: async () => ({}) };
      }
      // Default
      return { ok: true, json: async () => [] };
    }));

    render(
      <AddTrustForm
        {...defaultProps("details")}
        editing={EDITING_CLUT}
        accounts={[CLUT_ACCOUNT, CLUT_ACCOUNT_B]}
      />,
    );

    // Wait for both picks to seed: once inceptionValue > 0, the CLUT preview
    // shows a non-dash value for the income interest.
    await waitFor(() => {
      const incomeEl = screen.getByTestId("clut-income-interest");
      expect(incomeEl.textContent).toMatch(/\$/);
    });

    // Open the picker — both asset rows should be checked
    fireEvent.click(screen.getByRole("button", { name: /funding-year fmv/i }));

    // Untick the FIRST asset checkbox (Schwab Brokerage / acct-a / g1).
    // getAllByRole("checkbox") returns rows in DOM order; the first is acct-a.
    const checkboxes = screen.getAllByRole("checkbox");
    fireEvent.click(checkboxes[0]);

    // Close picker — one pick (acct-b / g2) remains, so validation passes.
    fireEvent.click(screen.getByRole("button", { name: /done/i }));

    // Submit
    const form = document.getElementById("add-trust-form")!;
    fireEvent.submit(form);

    // Wait for DELETE to fire for g1
    await waitFor(() => {
      expect(
        calls.some((c) => c.method === "DELETE" && c.url.endsWith("/gifts/g1")),
      ).toBe(true);
    });

    // No POST to /gifts (unticking is a delete, not a create)
    expect(calls.some((c) => c.method === "POST" && c.url.endsWith("/gifts"))).toBe(false);

    // g2 was NOT touched (it stayed checked)
    expect(
      calls.some((c) => c.method === "DELETE" && c.url.endsWith("/gifts/g2")),
    ).toBe(false);
  });
});
