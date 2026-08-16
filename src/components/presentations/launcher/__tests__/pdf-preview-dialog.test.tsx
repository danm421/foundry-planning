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

  // The soft export gate's warning. `export-pdf` (what this dialog fetches)
  // streams a PDF and has nowhere to carry the unreviewed count, so the
  // dialog is handed the count on the REQUEST prop — a source it already has
  // — rather than deriving it from its own fetch. Covered here per the
  // count's own request: no second file for one route's warning.
  describe("the soft export gate's warning", () => {
    const STORY_REQUEST: PreviewRequest = {
      ...REQUEST,
      storyReview: [
        { pageId: "planStory", scenarioId: "base", documentRole: "standalone", unreviewed: 8, total: 12 },
      ],
    };

    it("shows the count when the request carries unreviewed chapters", async () => {
      render(
        <PdfPreviewDialog request={STORY_REQUEST} clientId="c1" onClose={() => {}} />,
      );
      expect(
        screen.getByText("8 of 12 Plan Story chapters haven't been reviewed yet."),
      ).toBeInTheDocument();
    });

    it("shows nothing when the request carries no story review data", async () => {
      render(
        <PdfPreviewDialog request={REQUEST} clientId="c1" onClose={() => {}} />,
      );
      expect(
        screen.queryByText(/haven't been reviewed yet/),
      ).not.toBeInTheDocument();
    });

    it("shows nothing when every chapter has been reviewed", async () => {
      const allReviewed: PreviewRequest = {
        ...REQUEST,
        storyReview: [
          { pageId: "planStory", scenarioId: "base", documentRole: "standalone", unreviewed: 0, total: 12 },
        ],
      };
      render(
        <PdfPreviewDialog request={allReviewed} clientId="c1" onClose={() => {}} />,
      );
      expect(
        screen.queryByText(/haven't been reviewed yet/),
      ).not.toBeInTheDocument();
    });

    it("renders one line per page, so a brief and a full story warn separately", async () => {
      const twoPages: PreviewRequest = {
        ...REQUEST,
        storyReview: [
          { pageId: "planStory", scenarioId: "base", documentRole: "frontMatter", unreviewed: 1, total: 3 },
          { pageId: "planStory", scenarioId: "base", documentRole: "standalone", unreviewed: 8, total: 12 },
        ],
      };
      render(
        <PdfPreviewDialog request={twoPages} clientId="c1" onClose={() => {}} />,
      );
      expect(
        screen.getByText("1 of 3 Plan Story chapters haven't been reviewed yet."),
      ).toBeInTheDocument();
      expect(
        screen.getByText("8 of 12 Plan Story chapters haven't been reviewed yet."),
      ).toBeInTheDocument();
    });

    it("does not block the download, and its own link just closes the dialog", async () => {
      const onClose = vi.fn();
      render(
        <PdfPreviewDialog request={STORY_REQUEST} clientId="c1" onClose={onClose} />,
      );
      await waitFor(() =>
        expect(screen.getByTitle("Cash Flow preview")).toBeInTheDocument(),
      );
      expect(screen.getByRole("button", { name: /Download PDF/i })).not.toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: /review/i }));
      expect(onClose).toHaveBeenCalledTimes(1);
      // No second fetch — the warning is read off the prop, never its own request.
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });
});
