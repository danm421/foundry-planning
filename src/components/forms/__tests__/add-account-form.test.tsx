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
    const clientBtn = screen.getByRole("button", { name: "Client" });
    expect(clientBtn).toHaveAttribute("aria-pressed", "true");

    // No Spouse or Joint preset should be active
    const spouseBtn = screen.getByRole("button", { name: "Spouse" });
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
          real_estate: "0.04",
          business: "0.05",
          life_insurance: "0.03",
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
          real_estate: "0.04",
          business: "0.05",
          life_insurance: "0.03",
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
