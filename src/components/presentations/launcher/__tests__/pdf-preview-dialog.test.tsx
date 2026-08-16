// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import {
  PdfPreviewDialog,
  type PreviewRequest,
} from "../pdf-preview-dialog";

const REQUEST: PreviewRequest = {
  title: "Cash Flow",
  scenarioId: null,
  pages: [{ pageId: "cashFlow", options: { range: "full" } }],
};

const originalFetch = global.fetch;

beforeEach(() => {
  // jsdom has no object-URL impl — stub both.
  URL.createObjectURL = vi.fn(() => "blob:mock-url");
  URL.revokeObjectURL = vi.fn();
  global.fetch = vi.fn(
    async () =>
      new Response(new Blob(["%PDF-1.4"], { type: "application/pdf" }), {
        status: 200,
      }),
  ) as never;
});
afterEach(() => {
  global.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("PdfPreviewDialog", () => {
  it("renders nothing when request is null", () => {
    const { container } = render(
      <PdfPreviewDialog request={null} clientId="c1" onClose={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("fetches preview=true and renders the PDF in an iframe", async () => {
    render(
      <PdfPreviewDialog request={REQUEST} clientId="c1" onClose={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByTitle("Cash Flow preview")).toBeInTheDocument(),
    );
    const [, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(JSON.parse(init!.body as string)).toMatchObject({
      preview: true,
      scenarioId: null,
      pages: REQUEST.pages,
    });
  });

  it("shows an inline error when the request fails", async () => {
    global.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "Boom" }), { status: 500 }),
    ) as never;
    render(
      <PdfPreviewDialog request={REQUEST} clientId="c1" onClose={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Boom"),
    );
  });

  it("downloads by reusing the fetched blob (no second fetch)", async () => {
    render(
      <PdfPreviewDialog request={REQUEST} clientId="c1" onClose={() => {}} />,
    );
    await waitFor(() =>
      expect(screen.getByTitle("Cash Flow preview")).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: /Download PDF/i }));
    expect(global.fetch).toHaveBeenCalledTimes(1); // no re-render
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2); // iframe + download
  });
});
