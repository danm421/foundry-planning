// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PresentationsLauncher } from "../launcher";

const originalFetch = global.fetch;
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
  URL.revokeObjectURL = vi.fn();
  global.fetch = vi.fn(async (url: string) => {
    if (String(url).includes("/presentations/export-pdf")) {
      return new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), {
        status: 200,
      });
    }
    if (url === "/api/presentation-templates") {
      return new Response(JSON.stringify({ shared: [], mine: [] }), {
        status: 200,
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as never;
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe("PresentationsLauncher", () => {
  it("pre-selects Cover + TOC + Cash Flow on empty state and renders Generate enabled", () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    expect(screen.getByText("Cover Sheet")).toBeInTheDocument();
    expect(screen.getByText("Table of Contents")).toBeInTheDocument();
    expect(screen.getByText("Cash Flow")).toBeInTheDocument();
    expect(
      (screen.getByRole("button", { name: /Generate PDF/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });

  it("disables Generate when all pages are removed", () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove Cover Sheet"));
    fireEvent.click(screen.getByLabelText("Remove Table of Contents"));
    fireEvent.click(screen.getByLabelText("Remove Cash Flow"));
    expect(
      (screen.getByRole("button", { name: /Generate PDF/i }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("opens a per-report preview that POSTs preview=true with a single page", async () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Preview Cash Flow/i }));
    await screen.findByTitle(/preview$/i);
    const exportCall = vi
      .mocked(global.fetch)
      .mock.calls.find((c) => String(c[0]).includes("export-pdf"));
    expect(exportCall).toBeTruthy();
    const body = JSON.parse((exportCall![1] as RequestInit).body as string);
    expect(body.preview).toBe(true);
    expect(body.pages).toHaveLength(1);
  });

  it("opens a whole-deck preview that POSTs all pages", async () => {
    render(
      <PresentationsLauncher
        clientId="c1"
        currentUserId="me"
        clientLastName="Sample"
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [] }}
        investmentCatalog={{ groups: [], entities: [], portfolios: [], recommendedPortfolioId: null }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Preview full/i }));
    await screen.findByTitle(/Full presentation preview/i);
    const exportCall = vi
      .mocked(global.fetch)
      .mock.calls.find((c) => String(c[0]).includes("export-pdf"));
    const body = JSON.parse((exportCall![1] as RequestInit).body as string);
    expect(body.preview).toBe(true);
    expect(body.pages.length).toBeGreaterThan(1);
  });
});
