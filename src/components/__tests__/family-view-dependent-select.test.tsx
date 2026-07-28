// @vitest-environment jsdom
/**
 * Task 10: the family-tab row select for `claimedAsDependent`.
 *
 * Mirrors the mocking setup in balance-sheet-family-view-readonly.test.tsx
 * (FamilyView is heavy — mock leaf dialogs / 3rd-party libs, not the gating
 * logic). family-member-dialog is mocked with a distinct marker (rather than
 * `() => null`) so the stopPropagation regression guard is actually
 * observable: if the row's onClick ever fires from an interaction with the
 * select, the marker appears.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — declared before any module imports
// ---------------------------------------------------------------------------

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => ({ get: vi.fn(() => null), toString: () => "" }),
  usePathname: () => "/clients/test-client/details",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

vi.mock("@/components/add-account-dialog", () => ({ default: () => null }));
vi.mock("@/components/add-liability-dialog", () => ({ default: () => null }));
vi.mock("@/components/business-dialog", () => ({ default: () => null }));
vi.mock("@/components/confirm-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/account-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/entity-dialog", () => ({ default: () => null }));
vi.mock("@/components/revocable-trust-tag-dialog", () => ({ default: () => null }));
vi.mock("@/components/gift-dialog", () => ({ default: () => null }));
vi.mock("@/components/add-client-dialog", () => ({ default: () => null }));
vi.mock("@/components/beneficiary-summary", () => ({ default: () => null }));

// Distinct marker (not `() => null`) — proves whether the row's onClick fired.
vi.mock("@/components/family-member-dialog", () => ({
  default: () => <div data-testid="member-dialog-open" />,
}));

const { writerSubmit } = vi.hoisted(() => ({ writerSubmit: vi.fn() }));
vi.mock("@/hooks/use-scenario-writer", () => ({
  useScenarioWriter: () => ({ submit: writerSubmit, scenarioActive: false }),
}));
vi.mock("@/hooks/use-scenario-preserving-href", () => ({
  useScenarioPreservingHref: () => (href: string) => href,
}));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/investments/holdings-client", () => ({ refreshClientHoldingPrices: vi.fn() }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import FamilyView from "@/components/family-view";
import { ClientAccessProvider } from "@/components/client-access-provider";

const CLIENT_ID = "test-client-id";

const PRIMARY_INFO = {
  firstName: "Alice",
  lastName: "Test",
  dateOfBirth: "1960-05-15",
  retirementAge: 67,
  lifeExpectancy: 95,
  filingStatus: "single",
  spouseName: null,
  spouseLastName: null,
  spouseDob: null,
  spouseRetirementAge: null,
  spouseLifeExpectancy: null,
};

const CHILD_MEMBER = {
  id: "fm-child",
  firstName: "Bob",
  lastName: "Test",
  relationship: "child" as const,
  dateOfBirth: "2015-01-01",
  notes: null,
  claimedAsDependent: "yes" as const,
};

const PARENT_MEMBER = {
  id: "fm-parent",
  firstName: "Carol",
  lastName: "Test",
  relationship: "parent" as const,
  dateOfBirth: "1950-01-01",
  notes: null,
  claimedAsDependent: "auto" as const,
};

function baseProps() {
  return {
    clientId: CLIENT_ID,
    primary: PRIMARY_INFO,
    initialMembers: [CHILD_MEMBER, PARENT_MEMBER],
    initialEntities: [],
    initialExternalBeneficiaries: [],
    initialAccounts: [],
    initialDesignations: [],
    initialGifts: [],
    initialGiftSeries: [],
    annualExclusionByYear: {},
    scenarioId: "default",
    contacts: null,
  };
}

describe("FamilyView — claimed-as-dependent row select", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] });
    writerSubmit.mockResolvedValue({ ok: true });
  });

  it(
    "renders the select only for the child-eligible row (with the persisted value selected) and a muted " +
      "placeholder for the non-eligible relationship — kills a mutant that renders the select unconditionally " +
      "or that never checks the relationship at all",
    async () => {
      await act(async () => {
        render(
          <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
            <FamilyView {...baseProps()} />
          </ClientAccessProvider>,
        );
      });

      const select = screen.getByLabelText(/claimed as dependent — bob/i) as HTMLSelectElement;
      expect(select.value).toBe("yes");

      // Carol (parent) must not have a dependent-claim select at all.
      expect(screen.queryByLabelText(/claimed as dependent — carol/i)).toBeNull();
      // Exactly one dependent-claim select exists across both rows.
      const allDependentSelects = screen
        .getAllByRole("combobox")
        .filter((el) => el.getAttribute("aria-label")?.toLowerCase().includes("claimed as dependent"));
      expect(allDependentSelects).toHaveLength(1);

      // Carol's cell shows the muted placeholder instead.
      expect(screen.getByText("—")).toBeTruthy();
    },
  );

  it(
    "disables the select under permission='view' and enables it under permission='edit' — kills a mutant that " +
      "hardcodes disabled (always true/false) or reads a different flag than the row's own canEdit",
    async () => {
      const { rerender } = render(
        <ClientAccessProvider value={{ permission: "view", access: "shared" }}>
          <FamilyView {...baseProps()} />
        </ClientAccessProvider>,
      );
      await act(async () => {});
      let select = screen.getByLabelText(/claimed as dependent — bob/i) as HTMLSelectElement;
      expect(select.disabled).toBe(true);

      await act(async () => {
        rerender(
          <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
            <FamilyView {...baseProps()} />
          </ClientAccessProvider>,
        );
      });
      select = screen.getByLabelText(/claimed as dependent — bob/i) as HTMLSelectElement;
      expect(select.disabled).toBe(false);
    },
  );

  it(
    "fires the change handler with the new value via the scenario writer — kills a mutant that sends the wrong " +
      "field name, the wrong member id, or the previous (stale) value instead of the newly selected one",
    async () => {
      await act(async () => {
        render(
          <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
            <FamilyView {...baseProps()} />
          </ClientAccessProvider>,
        );
      });
      const select = screen.getByLabelText(/claimed as dependent — bob/i) as HTMLSelectElement;

      await act(async () => {
        fireEvent.change(select, { target: { value: "no" } });
      });

      expect(writerSubmit).toHaveBeenCalledTimes(1);
      const [edit, baseFallback] = writerSubmit.mock.calls[0];
      expect(edit).toMatchObject({
        op: "edit",
        targetKind: "family_member",
        targetId: "fm-child",
        desiredFields: { claimedAsDependent: "no" },
      });
      expect(baseFallback).toMatchObject({
        url: `/api/clients/${CLIENT_ID}/family-members/fm-child`,
        method: "PUT",
        body: { claimedAsDependent: "no" },
      });
    },
  );

  it(
    "does NOT open the member edit dialog from a click or change on the select, but a click elsewhere on the " +
      "same row does — the stopPropagation regression guard (R5), with a control proving the dialog CAN open",
    async () => {
      await act(async () => {
        render(
          <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
            <FamilyView {...baseProps()} />
          </ClientAccessProvider>,
        );
      });
      const select = screen.getByLabelText(/claimed as dependent — bob/i) as HTMLSelectElement;

      fireEvent.click(select);
      expect(screen.queryByTestId("member-dialog-open")).toBeNull();

      await act(async () => {
        fireEvent.change(select, { target: { value: "no" } });
      });
      expect(screen.queryByTestId("member-dialog-open")).toBeNull();

      // Control: clicking elsewhere on Bob's row DOES open the dialog — proves
      // the dialog mock is capable of appearing and the row's onClick is live,
      // so the two assertions above are a real negative, not a vacuous one.
      const nameCell = screen.getByText(/Bob/, { selector: "td" });
      fireEvent.click(nameCell);
      expect(screen.getByTestId("member-dialog-open")).toBeTruthy();
    },
  );
});
