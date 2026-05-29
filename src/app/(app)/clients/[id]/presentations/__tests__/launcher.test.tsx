// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PresentationsLauncher } from "../launcher";

const originalFetch = global.fetch;
beforeEach(() => {
  global.fetch = vi.fn(async (url: string) => {
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
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [] }}
        investmentCatalog={{ groups: [], entities: [] }}
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
        scenarios={[]}
        snapshots={[]}
        initialTemplates={{ shared: [], mine: [] }}
        investmentCatalog={{ groups: [], entities: [] }}
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
});
