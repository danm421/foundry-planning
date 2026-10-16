// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { IntakeDocumentView } from "@/lib/intake/document-types";
import UploadZone from "../upload-zone";

const STATEMENT: IntakeDocumentView = {
  id: "11111111-1111-4111-8111-111111111111",
  filename: "brokerage-statement.pdf",
  docType: "statement",
  sizeBytes: 245_760,
  uploadedAt: "2026-08-01T12:00:00.000Z",
};
const PAYSTUB: IntakeDocumentView = {
  id: "22222222-2222-4222-8222-222222222222",
  filename: "paystub-sept.pdf",
  docType: "paystub",
  sizeBytes: 3_250_000,
  uploadedAt: "2026-08-02T12:00:00.000Z",
};

function clientUploadsList() {
  return screen.queryByRole("region", { name: "Documents the client uploaded" });
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UploadZone — the client's Data Collection uploads", () => {
  it("lists each upload with its type and size, and nothing when there are none", () => {
    const { rerender } = render(
      <UploadZone clientId="c1" importId="i1" clientUploads={[STATEMENT, PAYSTUB]} />,
    );
    const list = clientUploadsList()!;
    expect(within(list).getByText("brokerage-statement.pdf")).toBeInTheDocument();
    expect(within(list).getByText("Account statement")).toBeInTheDocument();
    expect(within(list).getByText("240 KB")).toBeInTheDocument();
    expect(within(list).getByText("3.1 MB")).toBeInTheDocument();

    rerender(<UploadZone clientId="c1" importId="i1" clientUploads={[]} />);
    expect(clientUploadsList()).toBeNull();
  });

  it("leaves out an upload already in the import", () => {
    render(
      <UploadZone
        clientId="c1"
        importId="i1"
        initialFiles={[{ serverFileId: "f0", name: "brokerage-statement.pdf", documentType: "auto" }]}
        clientUploads={[STATEMENT, PAYSTUB]}
      />,
    );
    const list = clientUploadsList()!;
    expect(within(list).queryByText("brokerage-statement.pdf")).toBeNull();
    expect(within(list).getByText("paystub-sept.pdf")).toBeInTheDocument();
  });

  it("Add copies the upload into the import and moves it into the file list", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ file: { id: "f1" }, deduped: false }), { status: 200 }),
    );
    const onUploaded = vi.fn();
    render(
      <UploadZone clientId="c1" importId="i1" clientUploads={[STATEMENT]} onUploaded={onUploaded} />,
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
    expect(url).toBe("/api/clients/c1/imports/i1/intake-documents");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ documentId: STATEMENT.id });
    expect(screen.getByText("✓ Uploaded")).toBeInTheDocument();
    expect(clientUploadsList()).toBeNull();
  });

  it("shows the server's refusal on the row, and Retry posts the same document again", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "That document is no longer available." }), { status: 404 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ file: { id: "f2" }, deduped: false }), { status: 200 }),
      );
    render(<UploadZone clientId="c1" importId="i1" clientUploads={[STATEMENT]} />);

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
    render(<UploadZone clientId="c1" importId="i1" clientUploads={[STATEMENT]} />);

    fireEvent.click(screen.getByRole("button", { name: "Add brokerage-statement.pdf" }));
    await screen.findByText("✓ Uploaded");
    fireEvent.click(screen.getByTitle("Remove file"));

    expect(within(clientUploadsList()!).getByText("brokerage-statement.pdf")).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls[1]![0]).toBe("/api/clients/c1/imports/i1/files/f1");
  });
});
