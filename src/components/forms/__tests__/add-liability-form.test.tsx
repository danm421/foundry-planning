// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import AddLiabilityForm, {
  type LiabilityFormInitial,
} from "../add-liability-form";
import type { AccountOwner } from "@/engine/ownership";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/client-123",
}));

const CLIENT_FM = { id: "fm-client", role: "client" as const, firstName: "Alice" };
const SPOUSE_FM = { id: "fm-spouse", role: "spouse" as const, firstName: "Bob" };
const FAMILY_MEMBERS = [CLIENT_FM, SPOUSE_FM];

const BASE_INITIAL: LiabilityFormInitial = {
  id: "liab-1",
  name: "Primary Mortgage",
  balance: "500000",
  interestRate: "0.065",
  monthlyPayment: "3000",
  startYear: 2020,
  startMonth: 1,
  termMonths: 360,
  termUnit: "annual",
  owners: [{ kind: "family_member", familyMemberId: "fm-client", percent: 1 }],
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshMock.mockReset();
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "liab-1" }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ── Test 1: Default initial owners for a new liability ────────────────────────

describe("AddLiabilityForm — owner defaults", () => {
  it("seeds owners=[{client@100%}] for a new liability when clientFm is present", () => {
    render(
      <AddLiabilityForm
        clientId="client-123"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );

    // The "Client" preset button should be aria-pressed="true"
    const clientBtn = screen.getByRole("button", { name: "Client" });
    expect(clientBtn).toHaveAttribute("aria-pressed", "true");

    const spouseBtn = screen.getByRole("button", { name: "Spouse" });
    expect(spouseBtn).toHaveAttribute("aria-pressed", "false");
  });
});

// ── Test 2: Existing liability with joint owners shows Joint preset active ────

describe("AddLiabilityForm — editing with joint owners", () => {
  it("shows Joint 50/50 preset as aria-pressed when initial.owners is joint 50/50", () => {
    const jointOwners: AccountOwner[] = [
      { kind: "family_member", familyMemberId: "fm-client", percent: 0.5 },
      { kind: "family_member", familyMemberId: "fm-spouse", percent: 0.5 },
    ];

    render(
      <AddLiabilityForm
        clientId="client-123"
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

// ── Test 3: Submit body includes owners[] and not legacy ownerEntityId ────────

describe("AddLiabilityForm — submit payload", () => {
  it("includes owners[] and excludes ownerEntityId on create", async () => {
    render(
      <AddLiabilityForm
        clientId="client-123"
        familyMembers={FAMILY_MEMBERS}
        entities={[]}
      />,
    );

    // Fill required fields
    const nameInput = screen.getByPlaceholderText(/Primary Mortgage/i);
    fireEvent.change(nameInput, { target: { value: "Test Loan" } });

    fireEvent.submit(document.getElementById("add-liability-form")!);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/clients/client-123/liabilities",
        expect.objectContaining({ method: "POST" }),
      ),
    );

    const call = fetchMock.mock.calls.find(
      (args) => String(args[0]) === "/api/clients/client-123/liabilities",
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

    // Should NOT include legacy ownerEntityId
    expect(body).not.toHaveProperty("ownerEntityId");
  });
});

// TODO: more form tests once useScenarioWriter is easier to mock
// (e.g. scenario-mode routing, mortgage-linked-property validation)
