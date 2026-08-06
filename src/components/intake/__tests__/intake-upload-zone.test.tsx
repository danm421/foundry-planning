// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { IntakeDocumentView } from "@/lib/intake/document-types";
import { IntakeUploadZone, SampleUploadZone } from "../intake-upload-zone";

// ─── Fake XHR ────────────────────────────────────────────────────────────────
//
// The component uses XMLHttpRequest rather than fetch because it is the only
// API that reports upload progress, so the test has to stand one up. Each
// instance records what was opened and sent, and the test drives the response.

class FakeXhr {
  static instances: FakeXhr[] = [];
  method = "";
  url = "";
  body: FormData | null = null;
  status = 0;
  responseText = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  upload = { onprogress: null as ((e: ProgressEvent) => void) | null };

  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  send(body: FormData) {
    this.body = body;
  }
  /** Drive the response the component is waiting on. */
  respond(status: number, responseText = "") {
    this.status = status;
    this.responseText = responseText;
    this.onload?.();
  }
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
  // can describe a 20MB file without allocating one.
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
  FakeXhr.instances = [];
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
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

  it("posts the file to the form's own endpoint with the fixed docType", async () => {
    const { container, onChanged } = renderZone();

    chooseFiles(container, [makeFile()]);

    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const xhr = FakeXhr.instances[0];
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toBe(`/api/intake/${TOKEN}/documents`);
    expect(xhr.body?.get("docType")).toBe("statement");
    expect((xhr.body?.get("file") as File).name).toBe("statement.pdf");
    expect(onChanged).not.toHaveBeenCalled();

    act(() => xhr.respond(201, JSON.stringify({ document: { ...STATEMENT, id: "srv-1" } })));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it("reports the server's own message when an upload is rejected", async () => {
    const { container } = renderZone();

    chooseFiles(container, [makeFile("resume.html")]);
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    act(() =>
      FakeXhr.instances[0].respond(
        400,
        JSON.stringify({
          error:
            "Unsupported or unsafe file type. Allowed: PDF, Office documents, images, and text/CSV.",
        }),
      ),
    );

    expect(
      await screen.findByText(
        "Unsupported or unsafe file type. Allowed: PDF, Office documents, images, and text/CSV.",
      ),
    ).toBeInTheDocument();
  });

  it("retries a failed upload", async () => {
    const { container } = renderZone();

    chooseFiles(container, [makeFile()]);
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    act(() => FakeXhr.instances[0].respond(500, ""));

    const retry = await screen.findByRole("button", {
      name: /try uploading statement\.pdf again/i,
    });
    fireEvent.click(retry);

    await waitFor(() => expect(FakeXhr.instances).toHaveLength(2));
    expect(FakeXhr.instances[1].url).toBe(`/api/intake/${TOKEN}/documents`);
  });

  it("refuses an oversized file without sending it", async () => {
    const { container } = renderZone();

    chooseFiles(container, [makeFile("huge.pdf", 11 * 1024 * 1024)]);

    expect(await screen.findByText(/Maximum size is 10MB/)).toBeInTheDocument();
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("uploads under the type the client picked, and only offers the picker when asked", async () => {
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

    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    expect(FakeXhr.instances[0].body?.get("docType")).toBe("tax_return");
  });

  it("hands a finished upload over to the refetched list without listing it twice", async () => {
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
    await waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    act(() => FakeXhr.instances[0].respond(201, JSON.stringify({ document: STATEMENT })));

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
    expect(screen.getByText(/PDF, Word, Excel, CSV, or a photo/i)).toBeInTheDocument();
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
    expect(FakeXhr.instances).toHaveLength(0);
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
    expect(FakeXhr.instances).toHaveLength(0);
  });

  it("hides the picker when the caller does not ask for it", () => {
    render(<SampleUploadZone docType="statement" label="Add a statement" />);

    expect(screen.queryByLabelText(/what kind of document is this/i)).toBeNull();
  });
});
