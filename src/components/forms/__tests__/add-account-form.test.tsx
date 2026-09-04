// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BENEFICIARY_REQUIRED_MESSAGE } from "@/lib/accounts/is-529";
import { createRef } from "react";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import AddAccountForm, {
  type AccountFormInitial,
  type AccountFormAutoSaveHandle,
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
    expect(screen.getByText(BENEFICIARY_REQUIRED_MESSAGE)).toBeDefined();

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
    expect(screen.queryByText(BENEFICIARY_REQUIRED_MESSAGE)).toBeNull();
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

  // saveAsyncImpl (~:1017) builds its own accountBody independently of
  // handleSubmit's (~:1239) — it's the payload used by tab-switch autosave,
  // reached only through the imperative ref (useImperativeHandle at ~:1158),
  // never through fireEvent.submit. Exercise it directly so a regression on
  // that path (e.g. countsTowardAum dropped from saveAsyncImpl only) fails
  // here even though the two submit-payload tests above stay green.
  it("carries countsTowardAum: true in the PUT body when saveAsync is invoked directly via the imperative ref (tab-switch autosave path)", async () => {
    const formRef = createRef<AccountFormAutoSaveHandle>();

    render(
      <AddAccountForm
        ref={formRef}
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

    // Bypass handleSubmit entirely — call the imperative handle the way
    // useTabAutoSave does on a tab switch, NOT fireEvent.submit.
    await act(async () => {
      await formRef.current!.saveAsync();
    });

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

// ── Real estate growth defaults ─────────────────────────────────────────────
// Both real-estate rate pickers (value growth + property tax growth) default
// to the plan inflation rate on a NEW account. Asserting only that the custom
// % inputs are hidden would pass even if the payload still said "custom", so
// each case also reads the outgoing body.

const CATEGORY_DEFAULTS = {
  taxable: "0.07",
  cash: "0.02",
  retirement: "0.07",
  annuity: "0.04",
  real_estate: "0.04",
  business: "0.05",
  life_insurance: "0.03",
  notes_receivable: "0",
};

describe("AddAccountForm — real estate growth source defaults", () => {
  it("defaults value growth and property tax growth to inflation on create", async () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="real_estate"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        categoryDefaults={CATEGORY_DEFAULTS}
      />,
    );

    // An inflation-sourced rate hides its custom % input.
    expect(document.getElementById("growthRate")).toBeNull();
    expect(document.getElementById("propertyTaxGrowthRate")).toBeNull();

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
    expect(body.growthSource).toBe("inflation");
    expect(body.propertyTaxGrowthSource).toBe("inflation");
  });

  it("keeps a stored custom source when editing an existing real estate account", () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="real_estate"
        mode="edit"
        initial={{
          ...BASE_INITIAL,
          category: "real_estate",
          subType: "primary_residence",
          growthRate: "0.05",
          growthSource: "custom",
        }}
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        categoryDefaults={CATEGORY_DEFAULTS}
      />,
    );

    expect(document.getElementById("growthRate")).not.toBeNull();
    expect(document.getElementById("propertyTaxGrowthRate")).not.toBeNull();
  });
});

// ── The annuity contract: read before you overwrite ─────────────────────────
// The Income & Guarantees panel is the ONLY way a contract is described, and
// the save is a full-replacement PUT. Everything below is about that pairing.

const ANNUITY_CONTRACT_URL = "/api/clients/client-123/annuity-contracts/acct-1";

const ANNUITY_INITIAL: AccountFormInitial = {
  ...BASE_INITIAL,
  name: "Athene Contract",
  category: "annuity",
  // 'other' is no longer a type the annuity dropdown offers — an account left
  // on it would render the Type select with no matching option.
  subType: "non_qualified",
  growthRate: "0.04",
};

/** A contract with real terms in it — the thing a blank panel would erase. */
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

type FetchInit = { method?: string; body?: string } | undefined;

/** Re-points the shared fetch mock at the annuity routes, keeping every other
 *  route's stock answer. `read` is what GET answers; `write` is what PUT does. */
function mockAnnuityRoutes(
  read: { ok: boolean; row?: unknown; status?: number },
  write: { ok: boolean; body?: unknown } = { ok: true },
) {
  fetchMock.mockImplementation(async (url: string, init: FetchInit) => {
    const u = String(url);
    if (u.includes("annuity-contracts")) {
      if ((init?.method ?? "GET") === "GET") {
        return {
          ok: read.ok,
          status: read.ok ? 200 : (read.status ?? 500),
          json: async () => (read.ok ? (read.row ?? null) : { error: "Account not found" }),
        };
      }
      return {
        ok: write.ok,
        status: write.ok ? 200 : 400,
        json: async () => write.body ?? { ok: true },
      };
    }
    if (u.includes("savings-rules") || u.includes("allocations") || u.includes("holdings")) {
      return { ok: true, json: async () => [] };
    }
    return { ok: true, json: async () => ({ id: "acct-1" }) };
  });
}

const contractWrites = () =>
  fetchMock.mock.calls.filter(
    (args) => String(args[0]) === ANNUITY_CONTRACT_URL && (args[1] as FetchInit)?.method === "PUT",
  );

function renderAnnuity(
  mode: "create" | "edit",
  formRef?: ReturnType<typeof createRef<AccountFormAutoSaveHandle>>,
) {
  return render(
    <AddAccountForm
      ref={formRef}
      clientId="client-123"
      category="annuity"
      mode={mode}
      initial={mode === "edit" ? ANNUITY_INITIAL : undefined}
      familyMembers={FAMILY_MEMBERS}
      entities={[]}
      categoryDefaults={CATEGORY_DEFAULTS}
    />,
  );
}

describe("AddAccountForm — annuity contract validation errors", () => {
  // A 400 from the PUT route is `{ error: "Validation failed", issues: [...] }`.
  // Showing only `error` told the advisor nothing about WHICH box is wrong.
  it("names the offending field when the contract PUT comes back 400", async () => {
    mockAnnuityRoutes(
      { ok: true, row: null },
      {
        ok: false,
        body: {
          error: "Validation failed",
          issues: [
            { path: "surrenderChargePct", message: "Must be a fraction between 0 and 1" },
          ],
        },
      },
    );

    renderAnnuity("create");
    fireEvent.submit(document.getElementById("add-account-form")!);

    await waitFor(() =>
      expect(screen.getByText(/surrenderChargePct/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Must be a fraction between 0 and 1/)).toBeInTheDocument();
  });
});

describe("AddAccountForm — annuity contract load guard", () => {
  // The PUT is a full replacement. When the read that fills the panel fails,
  // the panel is showing column defaults for a contract that has real terms in
  // it — and writing those back erases the carrier, the cost basis, the benefit
  // base and the whole income rider, with nothing on screen to warn the
  // advisor that anything was ever there.
  it("refuses to write the contract back when the read that filled the panel failed", async () => {
    mockAnnuityRoutes({ ok: false });
    const formRef = createRef<AccountFormAutoSaveHandle>();
    renderAnnuity("edit", formRef);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ANNUITY_CONTRACT_URL));

    await act(async () => {
      await formRef.current!.saveAsync();
    });

    // The account itself still saves — only the contract is held back.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/client-123/accounts/acct-1",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    expect(contractWrites()).toHaveLength(0);
  });

  it("tells the advisor the panel is not showing their contract", async () => {
    mockAnnuityRoutes({ ok: false });
    renderAnnuity("edit");

    await waitFor(() =>
      expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument(),
    );
  });

  // The other half of the guard: a brand-new account has no stored contract to
  // read, so "we never read one" must NOT be treated as "the read failed".
  it("still writes the contract on a brand-new account — there was nothing to read", async () => {
    mockAnnuityRoutes({ ok: true, row: null });
    renderAnnuity("create");

    fireEvent.submit(document.getElementById("add-account-form")!);

    await waitFor(() => expect(contractWrites()).toHaveLength(1));
  });

  // A `null` row is a successful read (the account simply has no contract yet),
  // not a failure — the write must go ahead on an existing account too.
  it("treats an empty contract row as a successful read, not a failed one", async () => {
    mockAnnuityRoutes({ ok: true, row: null });
    const formRef = createRef<AccountFormAutoSaveHandle>();
    renderAnnuity("edit", formRef);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ANNUITY_CONTRACT_URL));
    await act(async () => {
      await formRef.current!.saveAsync();
    });

    await waitFor(() => expect(contractWrites()).toHaveLength(1));
  });

  it("writes back the contract it read, not the panel's blank defaults", async () => {
    mockAnnuityRoutes({ ok: true, row: STORED_CONTRACT });
    const formRef = createRef<AccountFormAutoSaveHandle>();
    renderAnnuity("edit", formRef);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ANNUITY_CONTRACT_URL));
    await act(async () => {
      await formRef.current!.saveAsync();
    });

    await waitFor(() => expect(contractWrites()).toHaveLength(1));
    const body = JSON.parse(contractWrites()[0][1].body as string);
    expect(body).toMatchObject({
      carrier: "Athene",
      costBasis: 250_000,
      benefitBase: 500_000,
      incomeMode: "rider",
    });
  });

  // End of the I-3 chain: the gate is only worth anything if the save path
  // honours it. A stored contract that names a joint payout without a survivor
  // share must not be re-saved untouched.
  it("holds the whole save when the loaded contract's joint payout has no survivor share", async () => {
    mockAnnuityRoutes({ ok: true, row: { ...STORED_CONTRACT, survivorPct: null } });
    const formRef = createRef<AccountFormAutoSaveHandle>();
    renderAnnuity("edit", formRef);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ANNUITY_CONTRACT_URL));

    let result: { ok: boolean } | undefined;
    await act(async () => {
      result = await formRef.current!.saveAsync();
    });

    expect(result?.ok).toBe(false);
    expect(
      fetchMock.mock.calls.filter(
        (args) => String(args[0]) === "/api/clients/client-123/accounts/acct-1",
      ),
    ).toHaveLength(0);
    expect(contractWrites()).toHaveLength(0);
  });
});

describe("AddAccountForm — a failed contract write must not orphan the account", () => {
  const accountCreates = () =>
    fetchMock.mock.calls.filter(
      (args) =>
        String(args[0]) === "/api/clients/client-123/accounts" &&
        (args[1] as FetchInit)?.method === "POST",
    );

  // The contract PUT is the only follow-up on the create path that throws. If
  // it fires before the form records the id the server just handed back, the
  // account exists but the form still believes it doesn't — and the next Save
  // mints a fresh uuid and creates the whole account a second time.
  const failingContractWrite = () =>
    mockAnnuityRoutes({ ok: true, row: null }, { ok: false, body: { error: "Server error" } });

  it("edits, rather than re-creates, after a failed contract write on the tab-switch save", async () => {
    failingContractWrite();
    const formRef = createRef<AccountFormAutoSaveHandle>();
    renderAnnuity("create", formRef);

    await act(async () => {
      await formRef.current!.saveAsync();
    });
    await act(async () => {
      await formRef.current!.saveAsync();
    });

    expect(accountCreates()).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/clients/client-123/accounts/acct-1",
      expect.objectContaining({ method: "PUT" }),
    );
    // Capturing the id first must not have silenced the contract write itself:
    // the account id now exists, but the load guard's "nothing to read" case
    // still has to hold for the create that is in flight.
    expect(contractWrites().length).toBeGreaterThan(0);
  });

  it("edits, rather than re-creates, after a failed contract write on the dialog's own Save", async () => {
    failingContractWrite();
    renderAnnuity("create");

    fireEvent.submit(document.getElementById("add-account-form")!);
    await waitFor(() => expect(screen.getByText(/Server error/)).toBeInTheDocument());

    fireEvent.submit(document.getElementById("add-account-form")!);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/client-123/accounts/acct-1",
        expect.objectContaining({ method: "PUT" }),
      ),
    );

    expect(accountCreates()).toHaveLength(1);
  });
});

// ── Round 2 ─────────────────────────────────────────────────────────────────

describe("AddAccountForm — an account the server does not call an annuity yet", () => {
  // The route 404s whenever the STORED row is not already category "annuity"
  // (`findAnnuityAccount`, shared by GET and PUT). That is the route saying
  // "there is nothing here to read", the same answer as a null body — not "the
  // read failed". Recategorizing an existing account to Annuity hits it every
  // time, because the database row still says taxable until the save lands.
  it("lets the advisor fill in a contract after recategorizing an account to Annuity", async () => {
    mockAnnuityRoutes({ ok: false, status: 404 });
    const formRef = createRef<AccountFormAutoSaveHandle>();
    renderAnnuity("edit", formRef);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ANNUITY_CONTRACT_URL));

    // The panel, not the dead-end alert.
    expect(screen.queryByText(/could not be loaded/i)).toBeNull();
    expect(screen.getByLabelText(/^product type$/i)).toBeInTheDocument();

    // The advisor actually FILLS SOMETHING IN — which is what this test is
    // named for, and what separates it from the clobber case below. Without a
    // real edit the save is correctly skipped.
    fireEvent.change(screen.getByLabelText(/^product type$/i), {
      target: { value: "myga" },
    });

    // And the terms they type actually reach the server.
    await act(async () => {
      await formRef.current!.saveAsync();
    });
    await waitFor(() => expect(contractWrites()).toHaveLength(1));
  });

  // The other half of the same 404. `findAnnuityAccount` 404s for an account
  // the DB does not YET call an annuity — and also for one it no longer calls
  // an annuity, whose `annuity_contracts` row is still sitting there (nothing
  // deletes it on a category change). The save's own account PUT flips the
  // category back BEFORE this write, so the upsert would land on a real row.
  // An untouched contract must therefore never be written in edit mode.
  it("does not overwrite a stored contract when the advisor never opened the panel", async () => {
    mockAnnuityRoutes({ ok: false, status: 404 });
    const formRef = createRef<AccountFormAutoSaveHandle>();
    renderAnnuity("edit", formRef);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ANNUITY_CONTRACT_URL));

    await act(async () => {
      await formRef.current!.saveAsync();
    });
    expect(contractWrites()).toHaveLength(0);
  });

  // The other side of it: widening 404 must not have widened everything else,
  // or C-1 is back.
  it("still treats a genuine read failure as a failure", async () => {
    mockAnnuityRoutes({ ok: false, status: 500 });
    const formRef = createRef<AccountFormAutoSaveHandle>();
    renderAnnuity("edit", formRef);

    await waitFor(() => expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument());
    await act(async () => {
      await formRef.current!.saveAsync();
    });
    expect(contractWrites()).toHaveLength(0);
  });
});

describe("AddAccountForm — a contract that just loaded is not an edit", () => {
  const incomeTab = () => screen.getByRole("button", { name: "Income & Guarantees" });

  // The GET answers all 22 columns against a 5-key blank, so the moment a
  // stored contract lands the form reads as dirty — and a tab click then fires
  // a save the advisor never asked for.
  it("does not fire an unrequested save when a tab is clicked after the contract loads", async () => {
    mockAnnuityRoutes({ ok: true, row: STORED_CONTRACT });
    renderAnnuity("edit");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ANNUITY_CONTRACT_URL));

    fireEvent.click(incomeTab());
    await waitFor(() => expect(incomeTab()).toHaveClass("text-accent"));

    expect(
      fetchMock.mock.calls.filter(
        (args) => String(args[0]) === "/api/clients/client-123/accounts/acct-1",
      ),
    ).toHaveLength(0);
    expect(contractWrites()).toHaveLength(0);
  });

  // The re-baseline has to be ONE-SHOT. Moving it past the loaded row must not
  // turn into "this form is never dirty" — an edit the advisor makes after the
  // load still has to save on a tab switch.
  it("still saves an edit made after the contract has loaded", async () => {
    mockAnnuityRoutes({ ok: true, row: STORED_CONTRACT });
    renderAnnuity("edit");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ANNUITY_CONTRACT_URL));

    fireEvent.change(screen.getByLabelText(/^product type$/i), { target: { value: "myga" } });
    fireEvent.click(incomeTab());

    await waitFor(() => expect(contractWrites()).toHaveLength(1));
    expect(JSON.parse(contractWrites()[0][1].body as string)).toMatchObject({
      productType: "myga",
      // The carrier is no longer an editable field on the panel, and the write
      // still carries the one the read handed it. Dropping a control must not
      // start blanking the column behind it.
      carrier: "Athene",
    });
  });

  // THE STRAND. A stored contract that names a joint payout without a survivor
  // share is exactly what the pre-fix panel could write, so real rows are in
  // this shape. Dirty-on-load + the I-3 gate meant `interceptTabChange` refused
  // every tab click, and the one field that unblocks the form sits on the tab
  // it would not open.
  it("lets the advisor reach Income & Guarantees to fix a contract the gate is holding", async () => {
    mockAnnuityRoutes({ ok: true, row: { ...STORED_CONTRACT, survivorPct: null } });
    renderAnnuity("edit");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ANNUITY_CONTRACT_URL));

    fireEvent.click(incomeTab());

    await waitFor(() => expect(incomeTab()).toHaveClass("text-accent"));
    // Not merely rendered — actually on screen: no ancestor is still `hidden`.
    expect(screen.getByLabelText(/survivor share/i).closest("div.hidden")).toBeNull();
  });
});


// ── An annuity picks its growth like any other investable account ────────────

/** The growth-source `<select>`. `GrowthRateField`'s label carries no `htmlFor`
 *  and its select no `id`, so it is found by the one option every category's
 *  dropdown carries rather than by an association that does not exist. */
function growthSourceSelect(): HTMLSelectElement {
  const select = screen
    .getAllByRole("combobox")
    .find((el) =>
      Array.from((el as HTMLSelectElement).options).some((o) => o.value === "default"),
    );
  if (!select) throw new Error("no growth-source select rendered");
  return select as HTMLSelectElement;
}

describe("AddAccountForm — an annuity picks its growth like an investable account", () => {
  it("offers portfolios and a plan default instead of a bare percent box", () => {
    mockAnnuityRoutes({ ok: true, row: null });
    render(
      <AddAccountForm
        clientId="client-123"
        category="annuity"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        modelPortfolios={[{ id: "mp-1", name: "Moderate", blendedReturn: 0.062 }]}
        fundPortfolios={[{ id: "tp-1", name: "Core Four", blendedReturnPct: 5.9 }]}
        categoryDefaults={CATEGORY_DEFAULTS}
        resolvedInflationRate={0.025}
      />,
    );

    const labels = Array.from(growthSourceSelect().options).map((o) => o.textContent ?? "");
    expect(labels.some((l) => l.includes("Plan default"))).toBe(true);
    expect(labels.some((l) => l.includes("Moderate"))).toBe(true);
    // Fund portfolios are NOT offered here: since 2026-09-03 they reach plans by
    // being promoted to a model portfolio, so a promoted one arrives in
    // `modelPortfolios` above. Offering both would list one portfolio twice.
    expect(labels.some((l) => l.includes("Core Four"))).toBe(false);
    expect(labels.some((l) => l.includes("Custom %"))).toBe(true);
    // Asset mix would also switch on the Asset Mix and Holdings tabs, which an
    // annuity has no sub-account holdings to fill.
    expect(labels.some((l) => l.includes("Asset mix"))).toBe(false);
    // The bare number box the annuity used to get is gone.
    expect(screen.queryByLabelText("Growth Rate (%)")).toBeNull();
  });

  it("saves the chosen portfolio as the growth source, with no custom rate", async () => {
    // A model portfolio that lived in `growth_rate` would be a frozen number
    // that stops tracking the portfolio the moment the CMA moves.
    mockAnnuityRoutes({ ok: true, row: null });
    render(
      <AddAccountForm
        clientId="client-123"
        category="annuity"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        modelPortfolios={[{ id: "mp-1", name: "Moderate", blendedReturn: 0.062 }]}
        categoryDefaults={CATEGORY_DEFAULTS}
        resolvedInflationRate={0.025}
      />,
    );

    fireEvent.change(growthSourceSelect(), { target: { value: "mp:mp-1" } });
    fireEvent.submit(document.getElementById("add-account-form")!);

    await waitFor(() => {
      const post = fetchMock.mock.calls.find(
        (args) =>
          String(args[0]) === "/api/clients/client-123/accounts" &&
          (args[1] as FetchInit)?.method === "POST",
      );
      expect(post).toBeDefined();
      const body = JSON.parse((post![1] as FetchInit)!.body!);
      expect(body.growthSource).toBe("model_portfolio");
      expect(body.modelPortfolioId).toBe("mp-1");
      expect(body.growthRate).toBeNull();
    });
  });
});


// ── The annuity's Account Type states the tax treatment ──────────────────────

describe("AddAccountForm — the annuity Account Type states the tax treatment", () => {
  it("offers exactly the three treatments and nothing else", () => {
    mockAnnuityRoutes({ ok: true, row: null });
    renderAnnuity("create");

    const select = screen.getByLabelText("Account Type") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual([
      "non_qualified",
      "qualified",
      "tax_free",
    ]);
  });

  it("sends the chosen type as the contract's tax treatment, overriding what was stored", async () => {
    // The stored contract says non_qualified; the advisor picks Qualified on
    // the Details tab. The PUT must carry qualified — the account row is the
    // editor and the contract column is its mirror.
    mockAnnuityRoutes({ ok: true, row: STORED_CONTRACT });
    const formRef = createRef<AccountFormAutoSaveHandle>();
    renderAnnuity("edit", formRef);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ANNUITY_CONTRACT_URL));

    fireEvent.change(screen.getByLabelText("Account Type"), {
      target: { value: "qualified" },
    });
    await act(async () => {
      await formRef.current!.saveAsync();
    });

    await waitFor(() => expect(contractWrites()).toHaveLength(1));
    const body = JSON.parse(contractWrites()[0][1].body as string);
    expect(body.taxTreatment).toBe("qualified");
    // The rest of the loaded contract still survives the derivation — this is
    // an override of one field, not a rebuild of the body.
    expect(body.carrier).toBe("Athene");
    expect(body.benefitBase).toBe(500_000);
  });

  it("leaves the stored treatment alone for a legacy sub-type the backfill missed", async () => {
    mockAnnuityRoutes({ ok: true, row: { ...STORED_CONTRACT, taxTreatment: "tax_free" } });
    const formRef = createRef<AccountFormAutoSaveHandle>();
    render(
      <AddAccountForm
        ref={formRef}
        clientId="client-123"
        category="annuity"
        mode="edit"
        initial={{ ...ANNUITY_INITIAL, subType: "other" }}
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
        categoryDefaults={CATEGORY_DEFAULTS}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(ANNUITY_CONTRACT_URL));
    await act(async () => {
      await formRef.current!.saveAsync();
    });

    await waitFor(() => expect(contractWrites()).toHaveLength(1));
    expect(JSON.parse(contractWrites()[0][1].body as string).taxTreatment).toBe("tax_free");
  });
});

// ── Basis field label ───────────────────────────────────────────────────────
// One column, two meanings. On a brokerage `basis` is a real cost basis; on a
// retirement account it is already-taxed Form 8606 money that the engine hands
// back TAX-FREE, pro-rata, on every distribution. Labelling that "Cost basis"
// invites a purchase price, which would silently under-tax the whole plan.
describe("AddAccountForm — basis field label", () => {
  // Query the account-level field by its `for="basis"` binding: "cost basis"
  // also appears on the holdings editor, which is a different field.
  const basisLabelText = () =>
    document.querySelector('label[for="basis"]')?.textContent ?? "";

  it("says Cost basis on a taxable account", () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );
    expect(basisLabelText()).toMatch(/cost basis/i);
    expect(basisLabelText()).not.toMatch(/post-tax basis/i);
  });

  it("says Post-tax basis on a retirement account", () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="retirement"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );
    expect(basisLabelText()).toMatch(/post-tax basis/i);
    expect(basisLabelText()).not.toMatch(/cost basis/i);
  });

  it("follows a category switch", () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );
    expect(basisLabelText()).toMatch(/cost basis/i);

    fireEvent.change(screen.getByLabelText(/^category/i), {
      target: { value: "retirement" },
    });
    expect(basisLabelText()).toMatch(/post-tax basis/i);
  });
});

// ── Post-tax basis must NOT mirror the balance ──────────────────────────────
// `basis` on a Form 8606 IRA is already-taxed money that the engine returns
// TAX-FREE pro-rata. Mirroring the balance into it (the default for a
// brokerage) would make the entire account distribute untaxed.
describe("AddAccountForm — basis auto-mirror", () => {
  // CurrencyInput renders "400,000" — compare digits, not the formatting.
  const basisDigits = () =>
    ((document.querySelector("#basis") as HTMLInputElement).value ?? "").replace(/[^0-9]/g, "");

  const renderFor = (subType: string) =>
    render(
      <AddAccountForm
        clientId="client-123"
        category="retirement"
        mode="create"
        initial={{ ...BASE_INITIAL, category: "retirement", subType, value: "0", basis: "0" }}
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );

  it.each(["traditional_ira", "sep_ira", "simple_ira"])(
    "leaves post-tax basis at 0 when the balance is typed on a %s",
    (subType) => {
      renderFor(subType);
      fireEvent.change(screen.getByLabelText(/current value/i), {
        target: { value: "400000" },
      });
      expect(basisDigits()).toBe("0");
    },
  );

  it("still mirrors value into cost basis on a taxable brokerage", () => {
    render(
      <AddAccountForm
        clientId="client-123"
        category="taxable"
        mode="create"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );
    fireEvent.change(screen.getByLabelText(/current value/i), {
      target: { value: "400000" },
    });
    expect(basisDigits()).toBe("400000");
  });
});
