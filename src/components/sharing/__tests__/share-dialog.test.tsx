// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// ---------------------------------------------------------------------------
// Mocks — before any module imports that use these
// ---------------------------------------------------------------------------

// Mock useBodyScrollLock so it doesn't try to touch document.body in jsdom
vi.mock("@/lib/use-body-scroll-lock", () => ({
  useBodyScrollLock: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import ShareDialog from "../share-dialog";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const CLIENT_ID = "client-abc-123";

function makeFetchMock(sharesPayload: object = { shares: [] }) {
  return vi.fn((url: string, opts?: RequestInit) => {
    // GET /api/shares?direction=outgoing → return shares list
    if (typeof url === "string" && url.includes("/api/shares") && (!opts || opts.method === "GET" || !opts.method)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(sharesPayload),
      } as Response);
    }
    // POST /api/clients/[id]/shares
    if (typeof url === "string" && url.includes(`/api/clients/${CLIENT_ID}/shares`)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ share: { id: "share-001", recipientEmail: "bob@example.com", permission: "edit" } }),
      } as Response);
    }
    // PUT /api/clients/[id]/privacy
    if (typeof url === "string" && url.includes(`/api/clients/${CLIENT_ID}/privacy`)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true, isPrivate: true }),
      } as Response);
    }
    // DELETE /api/shares/[shareId]
    if (typeof url === "string" && url.includes("/api/shares/")) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ok: true }),
      } as Response);
    }
    return Promise.resolve({
      ok: false,
      json: () => Promise.resolve({ error: "Not found" }),
    } as Response);
  });
}

/** Returns a fetch mock where the POST to /shares returns the given HTTP status. */
function makeFetchMockWithSharesPostStatus(status: number) {
  return vi.fn((url: string, opts?: RequestInit) => {
    // GET /api/shares?direction=outgoing → always succeed
    if (typeof url === "string" && url.includes("/api/shares") && (!opts || opts.method === "GET" || !opts.method)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ shares: [] }),
      } as Response);
    }
    // POST /api/clients/[id]/shares → return requested error status
    if (
      typeof url === "string" &&
      url.includes(`/api/clients/${CLIENT_ID}/shares`) &&
      opts?.method === "POST"
    ) {
      return Promise.resolve({
        ok: false,
        status,
        json: () => Promise.resolve({ error: "error" }),
      } as Response);
    }
    return Promise.resolve({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "unexpected" }),
    } as Response);
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ShareDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("POSTs to /api/clients/<id>/shares with { email, permission: 'edit' } on submit", async () => {
    const fetchMock = makeFetchMock();
    global.fetch = fetchMock as typeof fetch;

    render(
      <ShareDialog
        open
        onOpenChange={() => {}}
        clientId={CLIENT_ID}
        initialIsPrivate={false}
      />,
    );

    // Wait for the initial shares fetch to settle
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/shares"),
        expect.objectContaining({ method: "GET" }),
      );
    });

    // Fill in the email
    const emailInput = screen.getByLabelText(/email/i);
    fireEvent.change(emailInput, { target: { value: "bob@example.com" } });

    // Select "edit" permission
    const editRadio = screen.getByLabelText(/edit/i);
    fireEvent.click(editRadio);

    // Submit
    const submitBtn = screen.getByRole("button", { name: /share/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        ([url, opts]) =>
          typeof url === "string" &&
          url.includes(`/api/clients/${CLIENT_ID}/shares`) &&
          opts?.method === "POST",
      );
      expect(postCall).toBeDefined();
      const body = JSON.parse(postCall![1]!.body as string);
      expect(body).toEqual({ email: "bob@example.com", permission: "edit" });
    });
  });

  it("PUTs to /api/clients/<id>/privacy when the Private toggle is clicked", async () => {
    const fetchMock = makeFetchMock();
    global.fetch = fetchMock as typeof fetch;

    render(
      <ShareDialog
        open
        onOpenChange={() => {}}
        clientId={CLIENT_ID}
        initialIsPrivate={false}
      />,
    );

    // Wait for the component to fully mount and the initial fetch to settle
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/shares"),
        expect.objectContaining({ method: "GET" }),
      );
    });

    // Toggle the Private switch
    const privateToggle = screen.getByRole("checkbox", { name: /private/i });
    fireEvent.click(privateToggle);

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, opts]) =>
          typeof url === "string" &&
          url.includes(`/api/clients/${CLIENT_ID}/privacy`) &&
          opts?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse(putCall![1]!.body as string);
      expect(body).toEqual({ isPrivate: true });
    });
  });

  it("shows 'user not found' inline error when shares POST returns 404", async () => {
    const fetchMock = makeFetchMockWithSharesPostStatus(404);
    global.fetch = fetchMock as typeof fetch;

    render(
      <ShareDialog
        open
        onOpenChange={() => {}}
        clientId={CLIENT_ID}
        initialIsPrivate={false}
      />,
    );

    // Wait for initial shares fetch to settle
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/shares"),
        expect.objectContaining({ method: "GET" }),
      );
    });

    // Fill in the email and submit
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "nobody@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "No Foundry user found with that email address.",
      );
    });
  });

  it("shows 'already has access' inline error when shares POST returns 409", async () => {
    const fetchMock = makeFetchMockWithSharesPostStatus(409);
    global.fetch = fetchMock as typeof fetch;

    render(
      <ShareDialog
        open
        onOpenChange={() => {}}
        clientId={CLIENT_ID}
        initialIsPrivate={false}
      />,
    );

    // Wait for initial shares fetch to settle
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/shares"),
        expect.objectContaining({ method: "GET" }),
      );
    });

    // Fill in the email and submit
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "existing@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This person already has access to this client.",
      );
    });
  });
});
