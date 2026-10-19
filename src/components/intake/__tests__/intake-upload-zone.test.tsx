// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { IntakeDocumentView } from "@/lib/intake/document-types";
import { IntakeUploadZone, SampleUploadZone } from "../intake-upload-zone";

// ─── Network fakes ───────────────────────────────────────────────────────────
//
// An upload is two steps: `stageFile` sends the bytes straight to Blob (its own
// tests cover that), then a small POST files the staged copy. The test fakes
// the first and drives the second through a stubbed fetch.

const { stageFile } = vi.hoisted(() => ({ stageFile: vi.fn() }));
vi.mock("@/lib/uploads/stage-file", () => ({ stageFile }));

const STAGED = "staging/intake/form-1/1-uuid-statement.pdf";

/** A fetch whose filing POSTs answer, in order, with `responses`. */
function stubFiling(...responses: Array<{ status: number; body?: unknown }>) {
  const fetchMock = vi.fn();
  for (const { status, body } of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (body === undefined) throw new SyntaxError("Unexpected end of JSON input");
        return body;
      },
    } as unknown as Response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** The FormData of the nth filing POST. */
function filed(fetchMock: ReturnType<typeof vi.fn>, n = 0): FormData {
  return (fetchMock.mock.calls[n][1] as RequestInit).body as FormData;
}

const STATEMENT: IntakeDocumentView = {
  id: "11111111-1111-4111-8111-111111111111",
  filename: "brokerage-statement.pdf",
  docType: "statement",
  sizeBytes: 245_760,
  uploadedAt: "2026-08-01T12:00:00.000Z",
};

const TOKEN = "tok_abc";

function makeFile(name = "statement.pdf", size = 1024): File {
  const file = new File(["x"], name, { type: "application/pdf" });
  // File.size is read-only and derived from the parts; override it so a test
  // can describe a 31MB file without allocating one.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

function renderZone(overrides: Partial<Parameters<typeof IntakeUploadZone>[0]> = {}) {
  const onChanged = vi.fn();
  const utils = render(
    <IntakeUploadZone
      token={TOKEN}
      docType="statement"
      documents={[]}
      onChanged={onChanged}
      label="Add a statement"
      {...overrides}
    />,
  );
  return { ...utils, onChanged };
}

/** Put files through the hidden <input type="file">, as the picker would. */
function chooseFiles(container: HTMLElement, files: File[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  stageFile.mockReset();
  stageFile.mockResolvedValue(STAGED);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("IntakeUploadZone", () => {
  it("lists an uploaded document by name, size and type", () => {
    renderZone({ documents: [STATEMENT] });

    const row = screen.getByText("brokerage-statement.pdf").closest("li");
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent("240 KB · Account statement");
  });

  it("offers no way to retrieve an uploaded document", () => {
    const { container } = renderZone({ documents: [STATEMENT] });

    // The feature's core security property: the client sees that a file
    // arrived and nothing more. No link, no image, no locator in the markup.
    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("blob.vercel-storage.com");
  });

  it("lets the picker choose any type of file", () => {
    const { container } = renderZone();
    expect(container.querySelector('input[type="file"]')).not.toHaveAttribute("accept");
  });

  it("stages the file through the form's own token route, then files it with the fixed docType", async () => {
    const fetchMock = stubFiling({ status: 201, body: { document: { ...STATEMENT, id: "srv-1" } } });
    const { container, onChanged } = renderZone();
    const file = makeFile();

    chooseFiles(container, [file]);

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(stageFile).toHaveBeenCalledWith(
      `/api/intake/${TOKEN}/documents/upload-token`,
      file,
      expect.any(Function),
    );
    expect(fetchMock).toHaveBeenCalledWith(`/api/intake/${TOKEN}/documents`, {
      method: "POST",
      body: expect.any(FormData),
    });
    const body = filed(fetchMock);
    expect(body.get("stagedPathname")).toBe(STAGED);
    expect(body.get("filename")).toBe("statement.pdf");
    expect(body.get("contentType")).toBe("application/pdf");
    expect(body.get("docType")).toBe("statement");
  });

  it("reports the server's own message when filing is refused", async () => {
    stubFiling({
      status: 400,
      body: { error: "You've attached too many documents. The limit is 25." },
    });
    const { container } = renderZone();

    chooseFiles(container, [makeFile()]);

    expect(
      await screen.findByText("You've attached too many documents. The limit is 25."),
    ).toBeInTheDocument();
  });

  it("reports a staging failure's own message, and files nothing", async () => {
    const fetchMock = stubFiling();
    stageFile.mockRejectedValue(new Error("This form link has expired."));
    const { container } = renderZone();

    chooseFiles(container, [makeFile()]);

    expect(await screen.findByText("This form link has expired.")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says the connection failed when a request never got out", async () => {
    stageFile.mockRejectedValue(new TypeError("Failed to fetch"));
    const { container } = renderZone();

    chooseFiles(container, [makeFile()]);

    expect(await screen.findByText(/couldn't reach the server/i)).toBeInTheDocument();
  });

  it("retries a failed upload", async () => {
    const fetchMock = stubFiling({ status: 500 }, { status: 201, body: { document: STATEMENT } });
    const { container } = renderZone();

    chooseFiles(container, [makeFile()]);

    const retry = await screen.findByRole("button", {
      name: /try uploading statement\.pdf again/i,
    });
    fireEvent.click(retry);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(stageFile).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/intake/${TOKEN}/documents`);
  });

  it("takes a file just under 30MB, and refuses a bigger one without sending it", async () => {
    stubFiling({ status: 201, body: { document: STATEMENT } });
    const { container } = renderZone();

    chooseFiles(container, [makeFile("big.pdf", 29 * 1024 * 1024)]);
    await waitFor(() => expect(stageFile).toHaveBeenCalledTimes(1));

    chooseFiles(container, [makeFile("huge.pdf", 31 * 1024 * 1024)]);
    expect(await screen.findByText(/Maximum size is 30MB/)).toBeInTheDocument();
    expect(stageFile).toHaveBeenCalledTimes(1);
  });

  it("uploads under the type the client picked, and only offers the picker when asked", async () => {
    const fetchMock = stubFiling({ status: 201, body: { document: STATEMENT } });
    const { container, rerender } = renderZone();
    expect(screen.queryByLabelText(/what kind of document/i)).not.toBeInTheDocument();

    rerender(
      <IntakeUploadZone
        token={TOKEN}
        docType="statement"
        allowTypeChoice
        documents={[]}
        onChanged={vi.fn()}
        label="Add a document"
      />,
    );

    fireEvent.change(screen.getByLabelText(/what kind of document/i), {
      target: { value: "tax_return" },
    });
    chooseFiles(container, [makeFile("1040.pdf")]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(filed(fetchMock).get("docType")).toBe("tax_return");
  });

  it("hands a finished upload over to the refetched list without listing it twice", async () => {
    stubFiling({ status: 201, body: { document: STATEMENT } });
    const onChanged = vi.fn();
    const props = {
      token: TOKEN,
      docType: "statement" as const,
      documents: [] as IntakeDocumentView[],
      onChanged,
      label: "Add a statement",
    };
    const { container, rerender } = render(<IntakeUploadZone {...props} />);

    chooseFiles(container, [makeFile("brokerage-statement.pdf")]);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));

    // Still shown while the caller's refetch is in flight — a file must not
    // blink out of the list between the 201 and the new `documents` arriving.
    expect(screen.getAllByText("brokerage-statement.pdf")).toHaveLength(1);

    rerender(<IntakeUploadZone {...props} documents={[STATEMENT]} />);
    expect(screen.getAllByText("brokerage-statement.pdf")).toHaveLength(1);
  });

  it("removes a document through the delete route and reports the change", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 204 } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const { onChanged } = renderZone({ documents: [STATEMENT] });

    fireEvent.click(screen.getByRole("button", { name: /remove brokerage-statement\.pdf/i }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/intake/${TOKEN}/documents/${STATEMENT.id}`,
      { method: "DELETE" },
    );
  });

  it("says so when a removal fails, and leaves the row in place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response),
    );
    const { onChanged } = renderZone({ documents: [STATEMENT] });

    fireEvent.click(screen.getByRole("button", { name: /remove brokerage-statement\.pdf/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/couldn't remove that file/i);
    expect(onChanged).not.toHaveBeenCalled();
    expect(screen.getByText("brokerage-statement.pdf")).toBeInTheDocument();
  });
});

// ─── SampleUploadZone ────────────────────────────────────────────────────────
//
// The advisor's preview renders this instead of the live zone. It must show the
// same layout and copy while holding no token and owning no mechanism that
// could reach the network — which is what makes it safe on a page whose whole
// promise is that nothing is saved or sent.

describe("SampleUploadZone", () => {
  it("shows the live zone's drop-target copy, including the size and format hint", () => {
    render(<SampleUploadZone docType="statement" label="Add a statement" />);

    expect(screen.getByText("Add a statement")).toBeInTheDocument();
    expect(screen.getByText(/drag and drop, or/i)).toBeInTheDocument();
    expect(screen.getByText(/Any file type, up to 30MB each/i)).toBeInTheDocument();
  });

  it("renders no file input and no clickable drop target", () => {
    const { container } = render(
      <SampleUploadZone docType="statement" label="Add a statement" />,
    );

    expect(container.querySelectorAll('input[type="file"]')).toHaveLength(0);
    // The live zone's drop target is a <button> that opens the picker; the
    // sample's is a <div>, so there is nothing here to click at all.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("lists a sample document by name, size and type, exactly as the live row does", () => {
    render(
      <SampleUploadZone
        docType="other"
        documents={[STATEMENT]}
        label="Add a document"
      />,
    );

    const row = screen.getByText("brokerage-statement.pdf").closest("li");
    expect(row).toHaveTextContent("240 KB · Account statement");
  });

  it("renders the Remove control disabled — it has nowhere to post", () => {
    render(
      <SampleUploadZone
        docType="other"
        documents={[STATEMENT]}
        label="Add a document"
      />,
    );

    const remove = screen.getByRole("button", { name: /remove brokerage-statement\.pdf/i });
    expect(remove).toBeDisabled();

    fireEvent.click(remove);
    expect(stageFile).not.toHaveBeenCalled();
    expect(screen.getByText("brokerage-statement.pdf")).toBeInTheDocument();
  });

  it("offers no way to retrieve a listed document", () => {
    const { container } = render(
      <SampleUploadZone
        docType="other"
        documents={[STATEMENT]}
        label="Add a document"
      />,
    );

    expect(container.querySelectorAll("a")).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(0);
    expect(container.innerHTML).not.toContain("blob.vercel-storage.com");
  });

  it("offers the same doc-type picker the live zone does, with no consequence", () => {
    render(<SampleUploadZone docType="other" allowTypeChoice label="Add a document" />);

    const picker = screen.getByLabelText(/what kind of document is this/i);
    expect(picker).toHaveValue("other");
    expect(screen.getByRole("option", { name: "Pay stub" })).toBeInTheDocument();

    // Changing it moves local state and nothing else — no request, ever.
    fireEvent.change(picker, { target: { value: "paystub" } });
    expect(picker).toHaveValue("paystub");
    expect(stageFile).not.toHaveBeenCalled();
  });

  it("hides the picker when the caller does not ask for it", () => {
    render(<SampleUploadZone docType="statement" label="Add a statement" />);

    expect(screen.queryByLabelText(/what kind of document is this/i)).toBeNull();
  });
});
