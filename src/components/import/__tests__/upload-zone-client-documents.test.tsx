// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ClientDocumentView } from "@/lib/imports/client-documents";
import UploadZone from "../upload-zone";

const STATEMENT: ClientDocumentView = {
  id: "11111111-1111-4111-8111-111111111111",
  filename: "brokerage-statement.pdf",
  sizeBytes: 245_760,
  source: "data_collection",
  typeLabel: "Account statement",
};
const PAYSTUB: ClientDocumentView = {
  id: "22222222-2222-4222-8222-222222222222",
  filename: "paystub-sept.pdf",
  sizeBytes: 3_250_000,
  source: "data_collection",
  typeLabel: "Pay stub",
};
const PORTAL_401K: ClientDocumentView = {
  id: "33333333-3333-4333-8333-333333333333",
  filename: "401k-q3.pdf",
  sizeBytes: 120_000,
  source: "portal",
  typeLabel: null,
};
const FIRM_TAX_RETURN: ClientDocumentView = {
  id: "44444444-4444-4444-8444-444444444444",
  filename: "2025-1040.pdf",
  sizeBytes: 900_000,
  source: "firm",
  typeLabel: null,
};

function doc(n: number): ClientDocumentView {
  return { ...PORTAL_401K, id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`, filename: `doc-${n}.pdf` };
}

function clientDocumentsList() {
  return screen.queryByRole("region", { name: "The client's documents" });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UploadZone — files from the client's vault", () => {
  it("lists each file with its type and size, and nothing when there are none", () => {
    const { rerender } = render(
      <UploadZone clientId="c1" importId="i1" clientDocuments={[STATEMENT, PAYSTUB]} />,
    );
    const list = clientDocumentsList()!;
    expect(within(list).getByText("brokerage-statement.pdf")).toBeInTheDocument();
    expect(within(list).getByText("Data Collection · Account statement")).toBeInTheDocument();
    expect(within(list).getByText("240 KB")).toBeInTheDocument();
    expect(within(list).getByText("3.1 MB")).toBeInTheDocument();

    rerender(<UploadZone clientId="c1" importId="i1" clientDocuments={[]} />);
    expect(clientDocumentsList()).toBeNull();
  });

  it("says where each file came from", () => {
    render(
      <UploadZone
        clientId="c1"
        importId="i1"
        clientDocuments={[STATEMENT, PORTAL_401K, FIRM_TAX_RETURN]}
      />,
    );
    const rows = within(clientDocumentsList()!).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Data Collection · Account statement");
    expect(rows[1]).toHaveTextContent("Client portal");
    expect(rows[2]).toHaveTextContent("Your firm");
  });

  it("shows the newest five until asked for the rest", () => {
    render(
      <UploadZone clientId="c1" importId="i1" clientDocuments={[1, 2, 3, 4, 5, 6, 7].map(doc)} />,
    );
    const list = clientDocumentsList()!;
    expect(within(list).getAllByRole("listitem")).toHaveLength(5);
    expect(within(list).queryByText("doc-6.pdf")).toBeNull();

    fireEvent.click(within(list).getByRole("button", { name: "Show 2 more" }));
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    expect(within(list).queryByRole("button", { name: /more/ })).toBeNull();
  });

  it("leaves out an upload already in the import", () => {
    render(
      <UploadZone
        clientId="c1"
        importId="i1"
        initialFiles={[{ serverFileId: "f0", name: "brokerage-statement.pdf", documentType: "auto" }]}
        clientDocuments={[STATEMENT, PAYSTUB]}
      />,
    );
    const list = clientDocumentsList()!;
    expect(within(list).queryByText("brokerage-statement.pdf")).toBeNull();
    expect(within(list).getByText("paystub-sept.pdf")).toBeInTheDocument();
  });

  it("Add copies the upload into the import and moves it into the file list", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ file: { id: "f1" }, deduped: false }), { status: 200 }),
    );
    const onUploaded = vi.fn();
    render(
      <UploadZone clientId="c1" importId="i1" clientDocuments={[STATEMENT]} onUploaded={onUploaded} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Add brokerage-statement.pdf" }));

    await waitFor(() =>
      expect(onUploaded).toHaveBeenCalledWith({
        serverFileId: "f1",
        name: "brokerage-statement.pdf",
        deduped: false,
      }),
    );
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("/api/clients/c1/imports/i1/client-documents");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ documentId: STATEMENT.id });
    expect(screen.getByText("✓ Uploaded")).toBeInTheDocument();
    expect(clientDocumentsList()).toBeNull();
  });

  it("shows the server's refusal on the row, and Retry posts the same document again", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "That document is no longer available." }), { status: 404 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ file: { id: "f2" }, deduped: false }), { status: 200 }),
      );
    render(<UploadZone clientId="c1" importId="i1" clientDocuments={[STATEMENT]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add brokerage-statement.pdf" }));
    expect(await screen.findByText("That document is no longer available.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("✓ Uploaded")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls).toHaveLength(2);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual({
      documentId: STATEMENT.id,
    });
  });

  it("offers the upload again once its row is removed", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ file: { id: "f1" }, deduped: false }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    render(<UploadZone clientId="c1" importId="i1" clientDocuments={[STATEMENT]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add brokerage-statement.pdf" }));
    await screen.findByText("✓ Uploaded");
    fireEvent.click(screen.getByTitle("Remove file"));

    expect(within(clientDocumentsList()!).getByText("brokerage-statement.pdf")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls[1]![0]).toBe("/api/clients/c1/imports/i1/files/f1");
  });
});
