// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

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
vi.mock("@/components/portal/portal-documents-screen", () => ({
  PortalDocumentsScreen: ({ editEnabled }: { editEnabled: boolean }) => (
    <div data-testid="screen-documents" data-edit={String(editEnabled)} />
  ),
}));
vi.mock("@/components/portal/portal-nav", () => ({
  default: ({ basePath }: { basePath?: string }) => (
    <div data-testid="nav" data-basepath={basePath} />
  ),
}));
vi.mock("@/components/portal/portal-preview-banner", () => ({
  default: ({ clientId, editEnabled }: { clientId: string; editEnabled: boolean }) => (
    <div data-testid="banner" data-client={clientId} data-edit={String(editEnabled)} />
  ),
}));

// The page no longer inherits (app)/clients/[id]/layout.tsx — it must call
// requireClientAccess itself. The mock's client row also feeds the banner
// (portalEditEnabled) and the contacts lookup (crmHouseholdId).
vi.mock("@/lib/clients/authz", () => ({
  requireClientAccess: vi.fn(() =>
    Promise.resolve({
      client: { crmHouseholdId: "h1", portalEditEnabled: true },
      firmId: "f1",
      permission: "edit",
      access: "own",
    }),
  ),
}));

// Single remaining db query: crmHouseholdContacts (raw await on the builder).
function mkQuery(): unknown {
  const contactsRows = [
    { firstName: "Pat", lastName: "Client", email: "pat@example.com", role: "primary" },
  ];
  return {
    then: (resolve: (v: unknown) => unknown) => resolve(contactsRows),
  };
}
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => mkQuery() }) }) },
}));
vi.mock("@/db/schema", () => ({
  crmHouseholdContacts: {},
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
vi.mock("@/lib/branding/branding", () => ({
  resolveIntakeBranding: vi.fn(() =>
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
import { resolveIntakeBranding } from "@/lib/branding/branding";

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

  it("renders HouseholdSection on slug=['profile']", async () => {
    const { container } = await renderPreview(["profile"]);
    expect(container.querySelector("[data-testid='section-household']")).toBeTruthy();
    expect(container.querySelector("[data-testid='section-dashboard']")).toBeNull();
  });

  it("renders FamilySection on slug=['profile','family']", async () => {
    const { container } = await renderPreview(["profile", "family"]);
    expect(container.querySelector("[data-testid='section-family']")).toBeTruthy();
    expect(container.querySelector("[data-testid='section-household']")).toBeNull();
  });

  it("renders TrustsSection on slug=['profile','trusts']", async () => {
    const { container } = await renderPreview(["profile", "trusts"]);
    expect(container.querySelector("[data-testid='section-trusts']")).toBeTruthy();
  });

  it("calls notFound() for unknown slug", async () => {
    await expect(renderPreview(["does-not-exist"])).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("calls notFound() when client access is denied", async () => {
    vi.mocked(requireClientAccess).mockRejectedValueOnce(new Error("denied"));
    await expect(renderPreview(["profile"])).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("passes correct basePath to PortalNav and a preview banner reflecting the edit toggle", async () => {
    const { container } = await renderPreview(undefined);
    const nav = container.querySelector("[data-testid='nav']");
    expect(nav?.getAttribute("data-basepath")).toBe("/clients/c1/portal/preview");
    const banner = container.querySelector("[data-testid='banner']");
    expect(banner?.getAttribute("data-client")).toBe("c1");
    expect(banner?.getAttribute("data-edit")).toBe("true");
  });

  it("renders PortalAccountsScreen on slug=['accounts']", async () => {
    const { container } = await renderPreview(["accounts"]);
    const node = container.querySelector("[data-testid='screen-accounts']");
    expect(node).toBeTruthy();
    expect(node?.getAttribute("data-client")).toBe("c1");
  });

  it("resolves firm branding and renders the letterhead strip", async () => {
    const { container } = await renderPreview(undefined);
    expect(resolveIntakeBranding).toHaveBeenCalledWith("f1");
    const img = container.querySelector('img[alt="Acme Wealth"]');
    expect(img?.getAttribute("src")).toBe("https://blob.example/logo.png");
  });

  it("renders PortalDocumentsScreen on slug=['documents'], passing the client's edit toggle", async () => {
    const { container } = await renderPreview(["documents"]);
    const node = container.querySelector("[data-testid='screen-documents']");
    expect(node).toBeTruthy();
    expect(node?.getAttribute("data-edit")).toBe("true");
  });
});
