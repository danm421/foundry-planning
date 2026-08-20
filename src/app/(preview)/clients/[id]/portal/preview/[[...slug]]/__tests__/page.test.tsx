// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { ForbiddenError } from "@/lib/authz";
import { UnauthorizedError } from "@/lib/db-helpers";

// Mock the section components so their own DB queries don't run during
// the catch-all dispatch test. Each renders a marker div that captures
// the props the page passed in.
vi.mock("@/components/portal/portal-dashboard", () => ({
  default: ({ clientId }: { clientId: string }) => (
    <div data-testid="section-dashboard" data-client={clientId} />
  ),
}));
vi.mock("@/components/portal/household-section", () => ({
  default: ({ clientId }: { clientId: string }) => (
    <div data-testid="section-household" data-client={clientId} />
  ),
}));
vi.mock("@/components/portal/family-section", () => ({
  default: ({ clientId }: { clientId: string }) => (
    <div data-testid="section-family" data-client={clientId} />
  ),
}));
vi.mock("@/components/portal/trusts-section", () => ({
  default: ({ clientId }: { clientId: string }) => (
    <div data-testid="section-trusts" data-client={clientId} />
  ),
}));
vi.mock("@/components/portal/portal-accounts-screen", () => ({
  PortalAccountsScreen: ({ clientId }: { clientId: string }) => (
    <div data-testid="screen-accounts" data-client={clientId} />
  ),
}));
vi.mock("@/components/portal/organizer-goals-screen", () => ({
  default: ({ clientId }: { clientId: string }) => (
    <div data-testid="screen-goals" data-client={clientId} />
  ),
}));
vi.mock("@/components/portal/organizer-cash-flow-screen", () => ({
  default: ({ clientId }: { clientId: string }) => (
    <div data-testid="screen-cash-flow" data-client={clientId} />
  ),
}));
vi.mock("@/components/portal/portal-documents-screen", () => ({
  PortalDocumentsScreen: ({ editEnabled }: { editEnabled: boolean }) => (
    <div data-testid="screen-documents" data-edit={String(editEnabled)} />
  ),
}));
vi.mock("@/components/portal/calculators-screen", () => ({
  CalculatorsScreen: ({ basePath }: { basePath?: string }) => (
    <div data-testid="screen-calculators" data-basepath={basePath} />
  ),
}));
vi.mock("@/components/portal/debt-paydown-screen", () => ({
  DebtPaydownScreen: ({ clientId, readOnly }: { clientId: string; readOnly?: boolean }) => (
    <div data-testid="screen-debt-paydown" data-client={clientId} data-readonly={String(readOnly)} />
  ),
}));
vi.mock("@/components/portal/portal-nav", () => ({
  default: ({ basePath }: { basePath?: string }) => (
    <div data-testid="nav" data-basepath={basePath} />
  ),
}));
vi.mock("@/components/portal/organizer-tabs", () => ({
  default: ({ basePath }: { basePath?: string }) => (
    <div data-testid="organizer-tabs" data-basepath={basePath} />
  ),
}));
vi.mock("@/components/portal/budget-tabs", () => ({
  default: ({ basePath }: { basePath?: string }) => (
    <div data-testid="budget-tabs" data-basepath={basePath} />
  ),
}));
vi.mock("@/components/portal/budget-section", () => ({
  default: ({ clientId }: { clientId: string }) => (
    <div data-testid="section-budget" data-client={clientId} />
  ),
}));
vi.mock("@/components/portal/transactions-section", () => ({
  default: ({ clientId }: { clientId: string }) => (
    <div data-testid="section-transactions" data-client={clientId} />
  ),
}));
vi.mock("@/components/portal/recurrings-section", () => ({
  default: ({ clientId }: { clientId: string }) => (
    <div data-testid="section-recurring" data-client={clientId} />
  ),
}));
vi.mock("@/components/portal/portal-preview-banner", () => ({
  default: ({ clientId, editEnabled }: { clientId: string; editEnabled: boolean }) => (
    <div data-testid="banner" data-client={clientId} data-edit={String(editEnabled)} />
  ),
}));

// The advisor's section switches ride on the row `requireClientAccess`
// already returns — the page does not read them a second time. Mutable so the
// feature tests at the bottom can switch one off.
const clientFeatures = {
  portalInvestmentsEnabled: true,
  portalBudgetEnabled: true,
  portalDocumentsEnabled: true,
  portalCalculatorsEnabled: true,
};

// The page no longer inherits (app)/clients/[id]/layout.tsx — it must call
// requireClientAccess itself. The mock's client row also feeds the banner
// (portalEditEnabled) and the contacts lookup (crmHouseholdId).
vi.mock("@/lib/clients/authz", () => ({
  requireClientAccess: vi.fn(() =>
    Promise.resolve({
      client: {
        crmHouseholdId: "h1",
        portalEditEnabled: true,
        advisorId: "adv1",
        ...clientFeatures,
      },
      firmId: "f1",
      permission: "edit",
      access: "own",
    }),
  ),
}));

// The preview renders the portal itself, so it also follows the owning firm's
// `client_portal` entitlement. Spread the real module: the page's own
// nullOnAccessDenial — and the ForbiddenError this file throws through it —
// have to be the actual ones for the denial classification to hold.
const portalEntitlementMock = vi.fn();
vi.mock("@/lib/authz", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/authz")>();
  return { ...actual, requireClientPortalEntitlement: async () => portalEntitlementMock() };
});

// Generic db query double shared by crmHouseholdContacts (raw await on the
// builder) and the page's loadPortalConnectionAlert call, which goes through
// loadPlaidItems and chains an extra .orderBy() — the same stub row shape
// serves both; it doesn't have fields deriveItemStatus recognizes, so the
// connection alert always resolves to false here.
function mkQuery(): unknown {
  const contactsRows = [
    { firstName: "Pat", lastName: "Client", email: "pat@example.com", role: "primary" },
  ];
  const query = {
    then: (resolve: (v: unknown) => unknown) => resolve(contactsRows),
    orderBy: () => query,
  };
  return query;
}
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => mkQuery() }) }) },
}));
vi.mock("@/db/schema", () => ({
  crmHouseholdContacts: {},
  plaidItems: {},
}));
vi.mock("@/lib/portal/privacy", () => ({
  loadPortalPrivacy: () =>
    Promise.resolve({ shareTransactions: true, shareBudgets: true, shareRecurrings: true }),
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));
vi.mock("@/lib/branding/resolve-for-client", () => ({
  resolveIntakeBrandingForClient: vi.fn(() =>
    Promise.resolve({
      logoUrl: "https://blob.example/logo.png",
      firmName: "Acme Wealth",
      faviconUrl: null,
    }),
  ),
}));

import PreviewPage from "../page";
import { notFound } from "next/navigation";
import { requireClientAccess } from "@/lib/clients/authz";
import { resolveIntakeBrandingForClient } from "@/lib/branding/resolve-for-client";

async function renderPreview(slug: string[] | undefined) {
  const ui = await PreviewPage({ params: Promise.resolve({ id: "c1", slug }) });
  return render(ui);
}

describe("PortalPreview catch-all", () => {
  it("asserts client access and renders the dashboard on empty slug", async () => {
    const { container } = await renderPreview(undefined);
    expect(requireClientAccess).toHaveBeenCalledWith("c1");
    const node = container.querySelector("[data-testid='section-dashboard']");
    expect(node).toBeTruthy();
    expect(node?.getAttribute("data-client")).toBe("c1");
  });

  it("renders Household, Family, and Trusts sections on slug=['organizer']", async () => {
    const { container } = await renderPreview(["organizer"]);
    expect(container.querySelector("[data-testid='section-household']")).toBeTruthy();
    expect(container.querySelector("[data-testid='section-family']")).toBeTruthy();
    expect(container.querySelector("[data-testid='section-trusts']")).toBeTruthy();
    expect(container.querySelector("[data-testid='section-dashboard']")).toBeNull();
  });

  it("calls notFound() for unknown slug", async () => {
    await expect(renderPreview(["does-not-exist"])).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  // Previously asserted with a bare `new Error("denied")`, which passed only
  // because the page swallowed *every* rejection. Now that non-authz faults
  // propagate, the denial case has to raise the error the gate actually throws.
  it("calls notFound() when client access is denied", async () => {
    vi.mocked(requireClientAccess).mockRejectedValueOnce(
      new ForbiddenError("Client not found or access denied"),
    );
    await expect(renderPreview(["profile"])).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("calls notFound() when there is no session", async () => {
    vi.mocked(requireClientAccess).mockRejectedValueOnce(new UnauthorizedError());
    await expect(renderPreview(["profile"])).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("propagates a DB fault instead of rendering not-found", async () => {
    vi.mocked(notFound).mockClear();
    const dbFault = Object.assign(
      new Error("column clients.covered_by_workplace_plan does not exist"),
      { code: "42703" },
    );
    vi.mocked(requireClientAccess).mockRejectedValueOnce(dbFault);

    // `rejects.toBe` pins the identity of the thrown value — the page can only
    // fail this exact way by rethrowing what the gate raised.
    await expect(renderPreview(["profile"])).rejects.toBe(dbFault);
    expect(notFound).not.toHaveBeenCalled();
  });

  // Empty slug, not ["profile"] — an unknown slug reaches notFound() on its own,
  // so it would pass this test with the entitlement gate deleted.
  it("calls notFound() when the firm has no client_portal entitlement", async () => {
    vi.mocked(notFound).mockClear();
    portalEntitlementMock.mockImplementationOnce(() => {
      throw new ForbiddenError("Client portal is not enabled");
    });
    await expect(renderPreview(undefined)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("propagates a non-denial fault from the entitlement gate", async () => {
    vi.mocked(notFound).mockClear();
    const clerkFault = new Error("Clerk 500");
    portalEntitlementMock.mockImplementationOnce(() => {
      throw clerkFault;
    });
    await expect(renderPreview(undefined)).rejects.toBe(clerkFault);
    expect(notFound).not.toHaveBeenCalled();
  });

  it("passes correct basePath to PortalNav and a preview banner reflecting the edit toggle", async () => {
    const { container } = await renderPreview(undefined);
    const nav = container.querySelector("[data-testid='nav']");
    expect(nav?.getAttribute("data-basepath")).toBe("/clients/c1/portal/preview");
    const banner = container.querySelector("[data-testid='banner']");
    expect(banner?.getAttribute("data-client")).toBe("c1");
    expect(banner?.getAttribute("data-edit")).toBe("true");
  });

  // Budget owns three tabs now; the dispatcher has to route the nested slugs
  // and hang the tab strip off every one of them (but no other section).
  it.each([
    [["budget"], "section-budget"],
    [["budget", "transactions"], "section-transactions"],
    [["budget", "recurring"], "section-recurring"],
  ])("renders %j with the Budget tab strip", async (slug, testid) => {
    const { container } = await renderPreview(slug as string[]);
    expect(container.querySelector(`[data-testid='${testid}']`)).toBeTruthy();
    const tabs = container.querySelector("[data-testid='budget-tabs']");
    expect(tabs?.getAttribute("data-basepath")).toBe("/clients/c1/portal/preview");
  });

  it("does not render the Budget tab strip outside the section", async () => {
    const { container } = await renderPreview(["organizer"]);
    expect(container.querySelector("[data-testid='budget-tabs']")).toBeNull();
  });

  // Organizer owns four tabs (Task 3): Household, Accounts, Goals and Cash
  // Flow all route through the dispatcher. The tab strip must still render on
  // every live branch.
  it.each([
    [["organizer"], "section-household"],
    [["organizer", "accounts"], "screen-accounts"],
    [["organizer", "goals"], "screen-goals"],
    [["organizer", "cash-flow"], "screen-cash-flow"],
  ])("renders %j with the Organizer tab strip", async (slug, testid) => {
    const { container } = await renderPreview(slug as string[]);
    expect(container.querySelector(`[data-testid='${testid}']`)).toBeTruthy();
    const tabs = container.querySelector("[data-testid='organizer-tabs']");
    expect(tabs?.getAttribute("data-basepath")).toBe("/clients/c1/portal/preview");
  });

  it("does not render the Organizer tab strip outside the section", async () => {
    const { container } = await renderPreview(["budget"]);
    expect(container.querySelector("[data-testid='organizer-tabs']")).toBeNull();
  });

  it("calls notFound() for the pre-move transactions and recurrings slugs", async () => {
    await expect(renderPreview(["transactions"])).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderPreview(["recurrings"])).rejects.toThrow("NEXT_NOT_FOUND");
  });

  // profile/accounts were the pre-Organizer slugs; they must no longer route.
  it("calls notFound() for the pre-move profile and accounts slugs", async () => {
    await expect(renderPreview(["profile"])).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderPreview(["profile", "family"])).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderPreview(["profile", "trusts"])).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(renderPreview(["accounts"])).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders PortalAccountsScreen on slug=['organizer','accounts']", async () => {
    const { container } = await renderPreview(["organizer", "accounts"]);
    const node = container.querySelector("[data-testid='screen-accounts']");
    expect(node).toBeTruthy();
    expect(node?.getAttribute("data-client")).toBe("c1");
  });

  it("resolves branding by the client's advisor and renders the letterhead strip", async () => {
    const { container } = await renderPreview(undefined);
    expect(resolveIntakeBrandingForClient).toHaveBeenCalledWith("f1", "adv1");
    const img = container.querySelector('img[alt="Acme Wealth"]');
    expect(img?.getAttribute("src")).toBe("https://blob.example/logo.png");
  });

  it("renders the Calculators index on slug=['calculators'], linking back inside the preview", async () => {
    const { container } = await renderPreview(["calculators"]);
    const node = container.querySelector("[data-testid='screen-calculators']");
    expect(node).toBeTruthy();
    // Without the basePath the advisor's card link would dump them out of the
    // preview and into the real client portal.
    expect(node?.getAttribute("data-basepath")).toBe(`/clients/c1/portal/preview`);
  });

  it("renders the debt paydown calculator READ-ONLY on slug=['calculators','debt-paydown']", async () => {
    const { container } = await renderPreview(["calculators", "debt-paydown"]);
    const node = container.querySelector("[data-testid='screen-debt-paydown']");
    expect(node).toBeTruthy();
    expect(node?.getAttribute("data-client")).toBe("c1");
    // requireClientPortalAccess throws for any session carrying an orgId, so
    // an autosaving preview would 403 on every keystroke.
    expect(node?.getAttribute("data-readonly")).toBe("true");
  });

  it("renders PortalDocumentsScreen on slug=['documents'], passing the client's edit toggle", async () => {
    const { container } = await renderPreview(["documents"]);
    const node = container.querySelector("[data-testid='screen-documents']");
    expect(node).toBeTruthy();
    expect(node?.getAttribute("data-edit")).toBe("true");
  });
});

// The preview is the advisor's proof of what the client sees. A section the
// advisor switched off must be gone HERE too, or the preview lies.
describe("PortalPreview feature switches", () => {
  afterEach(() => {
    clientFeatures.portalInvestmentsEnabled = true;
    clientFeatures.portalBudgetEnabled = true;
    clientFeatures.portalDocumentsEnabled = true;
    clientFeatures.portalCalculatorsEnabled = true;
  });

  // Both calculator paths hang off ONE switch — `portalFeatureForPath`
  // prefix-matches — so the child route must go dark with its index.
  it("gates both calculator paths from the one switch", async () => {
    clientFeatures.portalCalculatorsEnabled = false;
    for (const slug of [["calculators"], ["calculators", "debt-paydown"]]) {
      const { container } = await renderPreview(slug);
      expect(container.textContent).toContain("Switched off");
      expect(container.textContent).toContain("Calculators");
      expect(container.querySelector("[data-testid='screen-calculators']")).toBeNull();
      expect(container.querySelector("[data-testid='screen-debt-paydown']")).toBeNull();
    }
  });

  // Not a 404: the advisor lands here by clicking through to check the switch
  // they just flipped, and the screen has to name it.
  it("shows the switched-off notice instead of not-found", async () => {
    vi.mocked(notFound).mockClear();
    clientFeatures.portalInvestmentsEnabled = false;
    const { container } = await renderPreview(["investments"]);
    expect(notFound).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Switched off");
    expect(container.textContent).toContain("Investments");
    // The section itself is gone, not merely captioned.
    expect(container.querySelector("[data-testid='screen-investments']")).toBeNull();
  });

  it("gates every Budget tab, and takes the tab strip with it", async () => {
    clientFeatures.portalBudgetEnabled = false;
    for (const slug of [["budget"], ["budget", "transactions"], ["budget", "recurring"]]) {
      const { container } = await renderPreview(slug);
      expect(container.textContent).toContain("Switched off");
      expect(container.querySelector("[data-testid='budget-tabs']")).toBeNull();
      expect(container.querySelector("[data-testid='section-budget']")).toBeNull();
      expect(container.querySelector("[data-testid='section-transactions']")).toBeNull();
      expect(container.querySelector("[data-testid='section-recurring']")).toBeNull();
    }
  });

  it("still 404s an unknown slug — the notice is for real sections only", async () => {
    clientFeatures.portalBudgetEnabled = false;
    await expect(renderPreview(["does-not-exist"])).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("leaves the core sections reachable when all three are off", async () => {
    clientFeatures.portalInvestmentsEnabled = false;
    clientFeatures.portalBudgetEnabled = false;
    clientFeatures.portalDocumentsEnabled = false;
    const { container } = await renderPreview(undefined);
    expect(container.querySelector("[data-testid='section-dashboard']")).toBeTruthy();
    const organizer = await renderPreview(["organizer"]);
    expect(
      organizer.container.querySelector("[data-testid='section-household']"),
    ).toBeTruthy();
  });
});
