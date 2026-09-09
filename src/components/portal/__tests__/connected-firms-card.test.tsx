// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ConnectedFirmsCard, {
  DISCONNECT_CONFIRM,
  type PortalConnection,
} from "@/components/portal/connected-firms-card";
import { portalBtn } from "@/components/portal/portal-card";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const SINCE_ISO = "2026-03-04T09:00:00.000Z";

/**
 * The date the component will print, derived the SAME way it derives it.
 * `acceptedAt` is a `timestamptz` — an instant — so the component renders the
 * reader's LOCAL day; a hardcoded "March 4" would be a day out at UTC-6 and
 * this suite would pass or fail on where it happened to run.
 */
function expectedSince(iso = SINCE_ISO): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function conn(over: Partial<PortalConnection> = {}): PortalConnection {
  return {
    clientId: "client-1",
    firmName: "Northgate Advisors",
    householdName: "John & Jane Cooper",
    since: SINCE_ISO,
    ...over,
  };
}

type Sent = { url: string; method?: string; body: unknown };

/** Serves GET with `connections` and records every DELETE, answering it with
 *  `deleteResponse`. Returns the recorded DELETEs. */
function stubFetch(
  connections: PortalConnection[],
  deleteResponse: { status: number; body: unknown } = { status: 200, body: { ok: true } },
): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "DELETE") {
      sent.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
      return {
        ok: deleteResponse.status < 400,
        status: deleteResponse.status,
        json: async () => deleteResponse.body,
      } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ connections }) } as Response;
  }) as unknown as typeof fetch;
  return sent;
}

beforeEach(() => {
  vi.restoreAllMocks();
  refresh.mockClear();
});

describe("ConnectedFirmsCard", () => {
  it("names the firm, the household and when the connection started", async () => {
    stubFetch([conn()]);
    render(<ConnectedFirmsCard />);
    expect(await screen.findByText("Northgate Advisors")).toBeTruthy();
    expect(screen.getByText(/John & Jane Cooper/)).toBeTruthy();
    expect(screen.getByText(new RegExp(`Connected since ${expectedSince()}`))).toBeTruthy();
  });

  it("omits the date rather than inventing one when no acceptance was recorded", async () => {
    stubFetch([conn({ since: null })]);
    render(<ConnectedFirmsCard />);
    await screen.findByText("Northgate Advisors");
    expect(screen.queryByText(/Connected since/)).toBeNull();
  });

  it("shows the empty state when no firm holds this login", async () => {
    stubFetch([]);
    render(<ConnectedFirmsCard />);
    await waitFor(() =>
      expect(screen.getByText(/No firms are connected to your login/)).toBeTruthy(),
    );
  });

  it("offers a retry when the list cannot be loaded", async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 500 }) as Response) as unknown as typeof fetch;
    render(<ConnectedFirmsCard />);
    expect(await screen.findByRole("button", { name: /try again/i })).toBeTruthy();
  });

  it("lists one row per connection when several firms hold the login", async () => {
    stubFetch([
      conn(),
      conn({ clientId: "client-2", firmName: "Halyard Wealth", householdName: "The Coopers Sr." }),
    ]);
    render(<ConnectedFirmsCard />);
    await screen.findByText("Northgate Advisors");
    expect(screen.getByText("Halyard Wealth")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: /disconnect/i })).toHaveLength(2);
  });

  it("uses the shared destructive button treatment, not a new one", async () => {
    stubFetch([conn()]);
    render(<ConnectedFirmsCard />);
    const btn = await screen.findByRole("button", { name: /disconnect/i });
    expect(btn.className).toBe(portalBtn.danger);
  });

  // --- Disconnecting. This ends the client's own access, so it asks first and
  // says both consequences plainly.

  it("asks for confirmation, naming both consequences, before disconnecting", async () => {
    const sent = stubFetch([conn()]);
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<ConnectedFirmsCard />);
    fireEvent.click(await screen.findByRole("button", { name: /disconnect/i }));

    expect(confirmSpy).toHaveBeenCalledWith(DISCONNECT_CONFIRM);
    // Losing access, and keeping the login and the other connections.
    expect(DISCONNECT_CONFIRM).toMatch(/lose access/i);
    expect(DISCONNECT_CONFIRM).toMatch(/other connections are unaffected/i);
    expect(DISCONNECT_CONFIRM).toMatch(/new request/i);
    // Declining the prompt is not a disconnect.
    expect(sent).toHaveLength(0);
    expect(screen.getByText("Northgate Advisors")).toBeTruthy();
  });

  it("disconnects the row the client pressed, by clientId", async () => {
    const sent = stubFetch([
      conn(),
      conn({ clientId: "client-2", firmName: "Halyard Wealth" }),
    ]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ConnectedFirmsCard />);
    await screen.findByText("Halyard Wealth");
    fireEvent.click(screen.getAllByRole("button", { name: /disconnect/i })[1]);

    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0].method).toBe("DELETE");
    expect(sent[0].url).toBe("/api/portal/connections");
    expect(sent[0].body).toEqual({ clientId: "client-2" });

    // The row goes, and the other one stays.
    await waitFor(() => expect(screen.queryByText("Halyard Wealth")).toBeNull());
    expect(screen.getByText("Northgate Advisors")).toBeTruthy();
  });

  it("re-renders the rest of the page, which may have been about the household just left", async () => {
    stubFetch([conn()]);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ConnectedFirmsCard />);
    fireEvent.click(await screen.findByRole("button", { name: /disconnect/i }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("keeps the row and says so when the disconnect is refused", async () => {
    stubFetch([conn()], { status: 404, body: { error: "Not found" } });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<ConnectedFirmsCard />);
    fireEvent.click(await screen.findByRole("button", { name: /disconnect/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText("Northgate Advisors")).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
  });
});
