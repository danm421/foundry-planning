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
    const emailInput = screen.getByLabelText(/share with/i);
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
    fireEvent.change(screen.getByLabelText(/share with/i), { target: { value: "nobody@example.com" } });
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
    fireEvent.change(screen.getByLabelText(/share with/i), { target: { value: "existing@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /share/i }));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "This person already has access to this client.",
      );
    });
  });

  describe("firm member picker", () => {
    const member = (userId: string, displayName: string, email: string) => ({
      userId,
      displayName,
      email,
      imageUrl: null,
      role: "Member",
      roleKey: "org:member",
    });
    const MEMBERS = [
      member("u-ann", "Ann Park", "ann@firm.com"),
      member("u-bob", "Bob Reyes", "bob@firm.com"),
    ];

    async function renderWithMembers(sharesPayload: object = { shares: [] }) {
      const fetchMock = makeFetchMock(sharesPayload);
      global.fetch = fetchMock as typeof fetch;
      const onOpenChange = vi.fn();
      render(
        <ShareDialog
          open
          onOpenChange={onOpenChange}
          clientId={CLIENT_ID}
          initialIsPrivate={false}
          members={MEMBERS}
        />,
      );
      await waitFor(() => expect(screen.queryByText(/loading shared access/i)).toBeNull());
      return { fetchMock, onOpenChange };
    }

    function postedBody(fetchMock: ReturnType<typeof makeFetchMock>) {
      const call = fetchMock.mock.calls.find(([, opts]) => opts?.method === "POST");
      return call ? JSON.parse(call[1]!.body as string) : undefined;
    }

    it("shares with a firm member picked from the list", async () => {
      const { fetchMock } = await renderWithMembers();
      fireEvent.focus(screen.getByLabelText(/share with/i));
      fireEvent.click(screen.getByRole("option", { name: /bob reyes/i }));
      expect(screen.getByLabelText(/share with/i)).toHaveValue("bob@firm.com");

      fireEvent.click(screen.getByRole("button", { name: /^share$/i }));
      await waitFor(() =>
        expect(postedBody(fetchMock)).toEqual({ email: "bob@firm.com", permission: "view" }),
      );
    });

    it("typing a name and pressing Enter picks the best match", async () => {
      await renderWithMembers();
      const input = screen.getByLabelText(/share with/i);
      fireEvent.change(input, { target: { value: "ann" } });
      expect(screen.getAllByRole("option")).toHaveLength(1);
      fireEvent.keyDown(input, { key: "Enter" });
      expect(input).toHaveValue("ann@firm.com");
      expect(screen.queryByRole("listbox")).toBeNull();
    });

    it("does not offer someone who already has access", async () => {
      await renderWithMembers({
        shares: [
          {
            id: "s1",
            clientId: CLIENT_ID,
            scope: "client",
            recipientUserId: "u-ann",
            recipientEmail: "ann@firm.com",
            permission: "view",
          },
        ],
      });
      fireEvent.focus(screen.getByLabelText(/share with/i));
      expect(screen.queryByRole("option", { name: /ann park/i })).toBeNull();
      expect(screen.getByRole("option", { name: /bob reyes/i })).toBeInTheDocument();
    });

    it("Escape closes the list without closing the dialog", async () => {
      const { onOpenChange } = await renderWithMembers();
      const input = screen.getByLabelText(/share with/i);
      fireEvent.focus(input);
      fireEvent.keyDown(input, { key: "Escape" });
      expect(screen.queryByRole("listbox")).toBeNull();
      expect(onOpenChange).not.toHaveBeenCalled();

      // Clicking the still-focused field brings the list back.
      fireEvent.click(input);
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });
  });

  describe("visibility line", () => {
    function renderDialog(props: { initialIsPrivate: boolean; bookSiloEnabled?: boolean }) {
      global.fetch = makeFetchMock() as typeof fetch;
      render(<ShareDialog open onOpenChange={() => {}} clientId={CLIENT_ID} {...props} />);
    }

    it("says the whole firm's advisors can see the client in an open firm", () => {
      renderDialog({ initialIsPrivate: false });
      expect(screen.getByText(/visible to your firm's advisors and admins, and to staff assigned to its advisor/i)).toBeInTheDocument();
    });

    it("limits the line to the client's advisor and admins in a siloed firm", () => {
      renderDialog({ initialIsPrivate: false, bookSiloEnabled: true });
      expect(screen.queryByText(/visible to your firm/i)).toBeNull();
      expect(
        screen.getByText(/visible to its advisor, firm admins, and staff assigned to that advisor/i),
      ).toBeInTheDocument();
    });

    it("names only the advisor and firm admins for a Private client", () => {
      renderDialog({ initialIsPrivate: true, bookSiloEnabled: true });
      expect(
        screen.getByText(/only its advisor and firm admins, plus anyone it is shared with/i),
      ).toBeInTheDocument();
    });
  });
});
