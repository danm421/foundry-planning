// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

// Mock the section components so their own DB queries don't run during
// the catch-all dispatch test. Each renders a marker div that captures
// the props the page passed in.
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
vi.mock("@/components/portal/accounts-section", () => ({
  default: ({ clientId }: { clientId: string }) => (
    <div data-testid="section-accounts" data-client={clientId} />
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

// Page does two queries: clients (.limit chain) and crmHouseholdContacts (raw await).
// Same thenable-with-.limit() pattern as the household-section test.
function mkQuery(): unknown {
  const contactsRows = [
    { firstName: "Pat", lastName: "Client", email: "pat@example.com", role: "primary" },
  ];
  const clientRow = { crmHouseholdId: "h1", portalEditEnabled: true };
  return {
    then: (resolve: (v: unknown) => unknown) => resolve(contactsRows),
    limit: () => Promise.resolve([clientRow]),
  };
}
vi.mock("@/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => mkQuery() }) }) },
}));
vi.mock("@/db/schema", () => ({
  clients: {},
  crmHouseholdContacts: {},
}));
vi.mock("drizzle-orm", () => ({ eq: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import PreviewPage from "../page";
import { notFound } from "next/navigation";

async function renderPreview(slug: string[] | undefined) {
  const ui = await PreviewPage({ params: Promise.resolve({ id: "c1", slug }) });
  return render(ui);
}

describe("PortalPreview catch-all", () => {
  it("renders HouseholdSection on empty slug", async () => {
    const { container } = await renderPreview(undefined);
    const node = container.querySelector("[data-testid='section-household']");
    expect(node).toBeTruthy();
    expect(node?.getAttribute("data-client")).toBe("c1");
  });

  it("renders HouseholdSection on slug=['profile']", async () => {
    const { container } = await renderPreview(["profile"]);
    expect(container.querySelector("[data-testid='section-household']")).toBeTruthy();
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

  it("passes correct basePath to PortalNav and a preview banner reflecting the edit toggle", async () => {
    const { container } = await renderPreview(undefined);
    const nav = container.querySelector("[data-testid='nav']");
    expect(nav?.getAttribute("data-basepath")).toBe("/clients/c1/portal/preview");
    const banner = container.querySelector("[data-testid='banner']");
    expect(banner?.getAttribute("data-client")).toBe("c1");
    expect(banner?.getAttribute("data-edit")).toBe("true");
  });

  it("renders AccountsSection on slug=['accounts']", async () => {
    const { container } = await renderPreview(["accounts"]);
    const node = container.querySelector("[data-testid='section-accounts']");
    expect(node).toBeTruthy();
    expect(node?.getAttribute("data-client")).toBe("c1");
  });
});
