// @vitest-environment jsdom
//
// The Family page hands the plan's tax inflation rate down to its gift dialog,
// so the QCD cap the form warns against grows past its last published year as
// the projection's does (gift-dialog-qcd.test.tsx pins dialog → form).
import { describe, it, expect, vi } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1/details/family",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode; [k: string]: unknown }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
// Leaf dialogs FamilyView mounts; the gift dialog is a stub that shows its prop.
vi.mock("@/components/add-account-dialog", () => ({ default: () => null }));
vi.mock("@/components/add-liability-dialog", () => ({ default: () => null }));
vi.mock("@/components/business-dialog", () => ({ default: () => null }));
vi.mock("@/components/confirm-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/account-delete-dialog", () => ({ default: () => null }));
vi.mock("@/components/entity-dialog", () => ({ default: () => null }));
vi.mock("@/components/revocable-trust-tag-dialog", () => ({ default: () => null }));
vi.mock("@/components/add-client-dialog", () => ({ default: () => null }));
vi.mock("@/components/beneficiary-summary", () => ({ default: () => null }));
vi.mock("@/components/family-member-dialog", () => ({ default: () => null }));
vi.mock("@/components/gift-dialog", () => ({
  default: ({ taxInflationRate }: { taxInflationRate?: number }) => (
    <div data-testid="gift-dialog-stub">{String(taxInflationRate)}</div>
  ),
}));
vi.mock("@/hooks/use-scenario-preserving-href", () => ({
  useScenarioPreservingHref: () => (href: string) => href,
}));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/lib/investments/holdings-client", () => ({ refreshClientHoldingPrices: vi.fn() }));

import FamilyView from "@/components/family-view";
import { ClientAccessProvider } from "@/components/client-access-provider";

describe("FamilyView — gift dialog inflation", () => {
  it("passes the plan's tax inflation rate to the gift dialog", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
    await act(async () => {
      render(
        <ClientAccessProvider value={{ permission: "edit", access: "own" }}>
          <FamilyView
            clientId="c1"
            primary={{
              firstName: "Alice", lastName: "Test", dateOfBirth: "1955-05-15", retirementAge: 67,
              lifeExpectancy: 95, filingStatus: "single", spouseName: null, spouseLastName: null,
              spouseDob: null, spouseRetirementAge: null, spouseLifeExpectancy: null,
            } as never}
            initialMembers={[]}
            initialEntities={[]}
            initialExternalBeneficiaries={[]}
            initialAccounts={[]}
            initialDesignations={[]}
            initialGifts={[]}
            initialGiftSeries={[]}
            annualExclusionByYear={{}}
            taxInflationRate={0.031}
            planStartYear={2026}
            scenarioId="s1"
            contacts={null}
          />
        </ClientAccessProvider>,
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByText("+ Add gift"));
    });
    expect(screen.getByTestId("gift-dialog-stub")).toHaveTextContent("0.031");
  });
});
