// @vitest-environment jsdom
//
// Adding a trust from Details → Profile must list it ONCE.
//
// On a first Save, AddTrustForm reports the new trust twice: `saveAsyncImpl`
// fires `onAutoSaved(saved, "create")` on every successful save, then
// `handleSubmit` fires `onSaved(saved, "create")` as the close-the-dialog
// signal. FamilyView wires both to the same list update, so treating each
// "create" as an append showed the trust twice (one database row) until reload.
// The stub dialog below replays exactly that sequence.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/test-client-id/details/family",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

const SAVED_TRUST = {
  id: "ent-rj",
  name: "RJ Trust",
  entityType: "trust",
  notes: null,
} as unknown as Entity;

vi.mock("@/components/entity-dialog", () => ({
  default: ({
    onSaved,
    onAutoSaved,
  }: {
    onSaved: (e: Entity, mode: "create" | "edit") => void;
    onAutoSaved?: (e: Entity, mode: "create" | "edit") => void;
  }) => (
    <button
      onClick={() => {
        onAutoSaved?.(SAVED_TRUST, "create");
        onSaved(SAVED_TRUST, "create");
      }}
    >
      Stub save
    </button>
  ),
}));
vi.mock("@/components/add-account-dialog", () => ({ default: () => null }));
vi.mock("@/components/add-liability-dialog", () => ({ default: () => null }));
vi.mock("@/components/business-dialog", () => ({ default: () => null }));
vi.mock("@/components/confirm-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/account-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/revocable-trust-tag-dialog", () => ({ default: () => null }));
vi.mock("@/components/gift-dialog", () => ({ default: () => null }));
vi.mock("@/components/add-client-dialog", () => ({ default: () => null }));
vi.mock("@/components/beneficiary-summary", () => ({ default: () => null }));
vi.mock("@/components/family-member-dialog", () => ({ default: () => null }));
vi.mock("@/hooks/use-scenario-preserving-href", () => ({
  useScenarioPreservingHref: () => (href: string) => href,
}));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/investments/holdings-client", () => ({ refreshClientHoldingPrices: vi.fn() }));

import FamilyView from "@/components/family-view";
import { ClientAccessProvider } from "@/components/client-access-provider";
import type { Entity } from "@/components/family-view";

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

describe("FamilyView — saving a new trust", () => {
  beforeEach(() => {
    // `[]` — FamilyView GETs the revocable-trust tag list on mount.
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
  });

  it("lists the trust once even though the dialog reports the create twice", async () => {
    await act(async () => {
      render(
        <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
          <FamilyView
            clientId="test-client-id"
            primary={PRIMARY_INFO}
            initialMembers={[]}
            initialEntities={[]}
            initialExternalBeneficiaries={[]}
            initialAccounts={[]}
            initialDesignations={[]}
            initialGifts={[]}
            initialGiftSeries={[]}
            annualExclusionByYear={{}}
            planStartYear={2026}
            scenarioId="base-scn"
            contacts={null}
          />
        </ClientAccessProvider>,
      );
    });

    await act(async () => { fireEvent.click(screen.getByText("+ Add Trust")); });
    await act(async () => { fireEvent.click(screen.getByText("Stub save")); });

    expect(screen.getAllByText("RJ Trust")).toHaveLength(1);
  });
});
