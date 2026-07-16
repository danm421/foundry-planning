// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import AddAccountForm, {
  type AccountFormInitial,
} from "../add-account-form";
import type { AccountOwner } from "@/engine/ownership";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-123",
}));

// Minimal family members: one client, one spouse
const CLIENT_FM = { id: "fm-client", role: "client" as const, firstName: "Alice" };
const SPOUSE_FM = { id: "fm-spouse", role: "spouse" as const, firstName: "Bob" };
const FAMILY_MEMBERS = [CLIENT_FM, SPOUSE_FM];

const BASE_INITIAL: AccountFormInitial = {
  id: "acct-1",
  name: "Test Account",
  category: "taxable",
  subType: "brokerage",
  owner: "client",
  value: "100000",
  basis: "80000",
  growthRate: "0.07",
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshMock.mockReset();
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "acct-1" }),
  });
  vi.stubGlobal("fetch", fetchMock);
  // savings-rules fetch for edit mode
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).includes("savings-rules")) {
      return { ok: true, json: async () => [] };
    }
    if (String(url).includes("allocations")) {
      return { ok: true, json: async () => [] };
    }
    if (String(url).includes("holdings")) {
      return { ok: true, json: async () => [] };
    }
    return { ok: true, json: async () => ({ id: "acct-1" }) };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Test 1: Default initial owners for a new account ─────────────────────────

describe("AddAccountForm — owner defaults", () => {
  it("seeds owners=[{client@100%}] for a new account when clientFm is present", () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );

    // The "Client" preset button should be aria-pressed="true" (derives mode=client)
    const clientBtn = screen.getByRole("button", { name: "Alice" });
    expect(clientBtn).toHaveAttribute("aria-pressed", "true");

    // No Spouse or Joint preset should be active
    const spouseBtn = screen.getByRole("button", { name: "Bob" });
    expect(spouseBtn).toHaveAttribute("aria-pressed", "false");
  });
});

// ── Test 2: Existing account with joint owners shows Joint preset active ──────

describe("AddAccountForm — editing with joint owners", () => {
  it("shows Joint 50/50 preset as aria-pressed when initial.owners is joint 50/50", () => {
    const jointOwners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
    ];

    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="edit"
        initial={{ ...BASE_INITIAL, owners: jointOwners }}
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );

    const jointBtn = screen.getByRole("button", { name: "Joint 50/50" });
    expect(jointBtn).toHaveAttribute("aria-pressed", "true");
  });
});

// ── Test 3: Submit body includes owners[] and not legacy owner/ownerEntityId ──

describe("AddAccountForm — submit payload", () => {
  it("includes owners[] and excludes legacy owner/ownerEntityId on create", async () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        categoryDefaults={{
          taxable: "0.07",
          cash: "0.02",
          retirement: "0.07",
          annuity: "0.04",
          real_estate: "0.04",
          business: "0.05",
          life_insurance: "0.03",
          notes_receivable: "0",
        }}
      />,
    );

    fireEvent.submit(document.getElementById("add-account-form")!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/client-123/accounts",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    const call = fetchMock.mock.calls.find(
      (args) => String(args[0]) === "/api/clients/client-123/accounts",
    );
    expect(call).toBeDefined();
    const body = JSON.parse(call![1].body as string);

    // Should include owners[]
    expect(body.owners).toBeDefined();
    expect(Array.isArray(body.owners)).toBe(true);
    expect(body.owners[0]).toMatchObject({
      kind: "family_member",
      familyMemberId: "fm-client",
      percent: 1,
    });

    // Should NOT include legacy owner or ownerEntityId
    expect(body).not.toHaveProperty("owner");
    expect(body).not.toHaveProperty("ownerEntityId");
  });
});

// ── Test 4: Edit-mode hydration roundtrip — joint owners survive a no-op save ──

describe("AddAccountForm — edit hydration roundtrip", () => {
  it("submits the original joint owners unchanged when user clicks Save without editing", async () => {
    const jointOwners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
    ];

    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="edit"
        initial={{ ...BASE_INITIAL, owners: jointOwners }}
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        categoryDefaults={{
          taxable: "0.07",
          cash: "0.02",
          retirement: "0.07",
          annuity: "0.04",
          real_estate: "0.04",
          business: "0.05",
          life_insurance: "0.03",
          notes_receivable: "0",
        }}
      />,
    );

    // Confirm the Joint 50/50 preset is active (hydration worked)
    const jointBtn = screen.getByRole("button", { name: "Joint 50/50" });
    expect(jointBtn).toHaveAttribute("aria-pressed", "true");

    // Submit without making any changes
    fireEvent.submit(document.getElementById("add-account-form")!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/client-123/accounts/acct-1",
        expect.objectContaining({ method: "PUT" }),
      ),
    );

    const call = fetchMock.mock.calls.find(
      (args) => String(args[0]) === "/api/clients/client-123/accounts/acct-1",
    );
    expect(call).toBeDefined();
    const body = JSON.parse(call![1].body as string);

    // Must NOT have fallen back to client@100%
    expect(body.owners).toHaveLength(2);
    expect(body.owners).toContainEqual({ kind: "family_member", familyMemberId: "fm-client", percent: 0.5 });
    expect(body.owners).toContainEqual({ kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 });
  });
});

// ── Test 4b: Opening Holdings on a brand-new account mints it (force-create) ──

describe("AddAccountForm — Holdings tab on a new account", () => {
  const ASSET_CLASSES = [
    { id: "ac-1", name: "US Large Cap", slug: "us_large_cap", geometricReturn: 0.07 },
  ];

  it("creates the account when the Holdings tab is opened before any save", async () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        assetClasses={ASSET_CLASSES}
        categoryDefaults={{
          taxable: "0.07",
          cash: "0.02",
          retirement: "0.07",
          annuity: "0.04",
          real_estate: "0.04",
          business: "0.05",
          life_insurance: "0.03",
          notes_receivable: "0",
        }}
      />,
    );

    // Before opening Holdings, no account POST has fired.
    expect(
      fetchMock.mock.calls.some(
        (args) =>
          String(args[0]) === "/api/clients/client-123/accounts" &&
          args[1]?.method === "POST",
      ),
    ).toBe(false);

    // Opening Holdings force-saves so the nested holdings route has an id.
    fireEvent.click(screen.getByRole("button", { name: "Holdings" }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/client-123/accounts",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    // Once minted, the Holdings tab is usable — no "save the account first" gate.
    await waitFor(() =>
      expect(screen.queryByText(/Save the account first to add holdings/i)).toBeNull(),
    );
  });
});

// ── Test 5: Switching subType to traditional_ira triggers retirementMode ──────

describe("AddAccountForm — retirement mode (retirementMode)", () => {
  it("shows single-owner picker (retirementMode) when subType is traditional_ira", () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="retirement"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );

    // In retirement mode, the multi-owner preset bar should NOT be visible;
    // instead a single <select> with aria-label="Owner" renders.
    const ownerSelect = screen.getByRole("combobox", { name: "Owner" });
    expect(ownerSelect).toBeDefined();

    // Preset buttons should NOT be present in retirement mode
    expect(screen.queryByRole("button", { name: "Joint 50/50" })).toBeNull();
  });
});

// ── Test 6: Category dropdown excludes routed-elsewhere categories ────────────

describe("AddAccountForm — category dropdown filtering", () => {
  it("does not offer notes_receivable, business, or life_insurance in the Category dropdown", () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );

    const categorySelect = screen.getByRole("combobox", { name: /Category/ }) as HTMLSelectElement;
    const values = Array.from(categorySelect.options).map((o) => o.value);

    // Categories routed to their own dedicated forms must not appear here.
    expect(values).not.toContain("notes_receivable");
    expect(values).not.toContain("business");
    expect(values).not.toContain("life_insurance");

    // Sanity: the categories AddAccountForm actually handles are still present.
    expect(values).toEqual(expect.arrayContaining(["taxable", "cash", "retirement", "real_estate"]));
  });
});

// ── Test 7: HSA subtype reveals coverage selector; payload includes hsaCoverage ─

describe("AddAccountForm — HSA subtype + coverage selector", () => {
  it("shows coverage selector only for hsa subtype and includes hsaCoverage in submit payload", async () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="retirement"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        categoryDefaults={{
          taxable: "0.07",
          cash: "0.02",
          retirement: "0.07",
          annuity: "0.04",
          real_estate: "0.04",
          business: "0.05",
          life_insurance: "0.03",
          notes_receivable: "0",
        }}
      />,
    );

    // The default retirement subType is traditional_ira — coverage selector must be absent.
    expect(screen.queryByRole("combobox", { name: /HSA Coverage/ })).toBeNull();

    // Switch subType to hsa.
    const subTypeSelect = screen.getByRole("combobox", { name: /Account Type/ });
    fireEvent.change(subTypeSelect, { target: { value: "hsa" } });

    // Coverage selector must now be visible.
    const coverageSelect = screen.getByRole("combobox", { name: /HSA Coverage/ }) as HTMLSelectElement;
    expect(coverageSelect).toBeDefined();
    expect(coverageSelect.value).toBe("self");

    // Switch to family coverage.
    fireEvent.change(coverageSelect, { target: { value: "family" } });
    expect(coverageSelect.value).toBe("family");

    // Submit the form and verify the payload contains hsaCoverage: "family".
    fireEvent.submit(document.getElementById("add-account-form")!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/client-123/accounts",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    const call = fetchMock.mock.calls.find(
      (args) => String(args[0]) === "/api/clients/client-123/accounts",
    );
    expect(call).toBeDefined();
    const body = JSON.parse(call![1].body as string);
    expect(body.hsaCoverage).toBe("family");
    expect(body.subType).toBe("hsa");
  });

  it("omits hsaCoverage (sends null) when subType is not hsa", async () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="retirement"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        categoryDefaults={{
          taxable: "0.07",
          cash: "0.02",
          retirement: "0.07",
          annuity: "0.04",
          real_estate: "0.04",
          business: "0.05",
          life_insurance: "0.03",
          notes_receivable: "0",
        }}
      />,
    );

    // Default subType is traditional_ira — no coverage selector.
    expect(screen.queryByRole("combobox", { name: /HSA Coverage/ })).toBeNull();

    // Submit without changing subType (stays traditional_ira).
    fireEvent.submit(document.getElementById("add-account-form")!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/client-123/accounts",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    const call = fetchMock.mock.calls.find(
      (args) => String(args[0]) === "/api/clients/client-123/accounts",
    );
    expect(call).toBeDefined();
    const body = JSON.parse(call![1].body as string);
    expect(body.hsaCoverage).toBeNull();
  });
});

// ── Test 8: 529 (education_savings) beneficiary requirement gates submit ──────

describe("AddAccountForm — 529 beneficiary submit gate", () => {
  it("blocks submit with inline error while beneficiary is empty; lifts canSubmit=false; allows submit once set", async () => {
    const submitStates: { canSubmit: boolean; loading: boolean }[] = [];
    render(
      <AddAccountForm
        clientId="client-123"
        category="education_savings"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        onSubmitStateChange={(s) => submitStates.push(s)}
      />,
    );

    // Inline required-beneficiary error is visible (beneficiaryMode defaults
    // to "family" with no member selected).
    expect(screen.getByText(/requires a designated beneficiary/i)).toBeDefined();

    // The lifted submit state must disable the dialog's primary button.
    expect(submitStates.at(-1)?.canSubmit).toBe(false);

    // Enter-key / programmatic submit must be a no-op — no POST fires.
    fireEvent.submit(document.getElementById("add-account-form")!);
    await new Promise((r) => setTimeout(r, 50));
    expect(
      fetchMock.mock.calls.some(
        (args) =>
          String(args[0]) === "/api/clients/client-123/accounts" &&
          args[1]?.method === "POST",
      ),
    ).toBe(false);

    // Pick a family-member beneficiary → gate lifts.
    fireEvent.change(screen.getByRole("combobox", { name: "Beneficiary family member" }), {
      target: { value: "fm-spouse" },
    });
    expect(screen.queryByText(/requires a designated beneficiary/i)).toBeNull();
    expect(submitStates.at(-1)?.canSubmit).toBe(true);

    // Submit now fires and carries the 529 fields with no owners[].
    fireEvent.submit(document.getElementById("add-account-form")!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/client-123/accounts",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    const call = fetchMock.mock.calls.find(
      (args) => String(args[0]) === "/api/clients/client-123/accounts",
    );
    const body = JSON.parse(call![1].body as string);
    expect(body.category).toBe("education_savings");
    expect(body.beneficiaryFamilyMemberId).toBe("fm-spouse");
    expect(body).not.toHaveProperty("owners");
  });
});

// ── AUM flag ─────────────────────────────────────────────────────────────────

describe("AddAccountForm — counts toward AUM", () => {
  it("renders the checkbox for an AUM-eligible category, unchecked by default", () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );

    const box = screen.getByRole("checkbox", { name: /counts toward aum/i });
    expect(box).not.toBeChecked();
  });

  it("reflects a persisted true when editing", () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="edit"
        initial={{ ...BASE_INITIAL, countsTowardAum: true }}
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /counts toward aum/i })).toBeChecked();
  });

  it("does not render the checkbox for an ineligible category", () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="real_estate"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );

    expect(
      screen.queryByRole("checkbox", { name: /counts toward aum/i }),
    ).not.toBeInTheDocument();
  });

  it("clears a set flag when the category switches to an ineligible one", () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="edit"
        initial={{ ...BASE_INITIAL, countsTowardAum: true }}
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /counts toward aum/i })).toBeChecked();

    fireEvent.change(screen.getByLabelText(/^category/i), {
      target: { value: "real_estate" },
    });
    expect(
      screen.queryByRole("checkbox", { name: /counts toward aum/i }),
    ).not.toBeInTheDocument();

    // Switching back must NOT resurrect the old true — the flag was cleared.
    fireEvent.change(screen.getByLabelText(/^category/i), {
      target: { value: "taxable" },
    });
    expect(screen.getByRole("checkbox", { name: /counts toward aum/i })).not.toBeChecked();
  });
});

// ── AUM flag — submit payload ───────────────────────────────────────────────
// Discrimination test: the checkbox rendering/checked-state tests above would
// still pass even if the flag never made it into the request body (e.g. the
// save-payload edit was omitted or typo'd). These assert on the actual
// outgoing fetch body, mirroring the "529 beneficiary submit gate" pattern
// above (fireEvent.submit → grab the fetch mock call → JSON.parse the body).

describe("AddAccountForm — counts toward AUM submit payload", () => {
  it("carries countsTowardAum: true in the POST body when creating an account with the box ticked", async () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        categoryDefaults={{
          taxable: "0.07",
          cash: "0.02",
          retirement: "0.07",
          annuity: "0.04",
          real_estate: "0.04",
          business: "0.05",
          life_insurance: "0.03",
          notes_receivable: "0",
        }}
      />,
    );

    const box = screen.getByRole("checkbox", { name: /counts toward aum/i });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    expect(box).toBeChecked();

    fireEvent.submit(document.getElementById("add-account-form")!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/client-123/accounts",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    const call = fetchMock.mock.calls.find(
      (args) => String(args[0]) === "/api/clients/client-123/accounts",
    );
    expect(call).toBeDefined();
    const body = JSON.parse(call![1].body as string);
    expect(body.countsTowardAum).toBe(true);
  });

  it("carries countsTowardAum: true in the PUT body when saving an existing flagged account unchanged", async () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="edit"
        initial={{ ...BASE_INITIAL, countsTowardAum: true }}
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        categoryDefaults={{
          taxable: "0.07",
          cash: "0.02",
          retirement: "0.07",
          annuity: "0.04",
          real_estate: "0.04",
          business: "0.05",
          life_insurance: "0.03",
          notes_receivable: "0",
        }}
      />,
    );

    expect(screen.getByRole("checkbox", { name: /counts toward aum/i })).toBeChecked();

    // Submit without making any changes.
    fireEvent.submit(document.getElementById("add-account-form")!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/client-123/accounts/acct-1",
        expect.objectContaining({ method: "PUT" }),
      ),
    );

    const call = fetchMock.mock.calls.find(
      (args) => String(args[0]) === "/api/clients/client-123/accounts/acct-1",
    );
    expect(call).toBeDefined();
    const body = JSON.parse(call![1].body as string);
    expect(body.countsTowardAum).toBe(true);
  });
});
