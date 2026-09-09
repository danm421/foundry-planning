// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import AccessRequestList, { type AccessRequest } from "@/components/portal/access-request-list";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function req(over: Partial<AccessRequest> = {}): AccessRequest {
  return {
    bindingId: "b1",
    firmName: "Northgate Advisors",
    advisorName: "Dana Reed",
    householdName: "John & Jane Cooper",
    // NOON UTC, deliberately. fmtExpiry renders the reader's LOCAL day
    // (expires_at is a timestamptz — an instant, not a calendar date), so a
    // midnight fixture would read as the 22nd in the Americas and the 23rd in
    // Europe, and this assertion would depend on where the suite ran.
    expiresAt: "2026-09-23T12:00:00.000Z",
    ...over,
  };
}

type Post = { url: string; body: unknown };

/** Serves GET with `requests` and records every POST, answering it with
 *  `postResponse`. Returns the recorded POSTs. */
function stubFetch(requests: AccessRequest[], postResponse: { status: number; body: unknown } = { status: 200, body: { ok: true } }): Post[] {
  const posts: Post[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === "POST") {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return {
        ok: postResponse.status < 400,
        status: postResponse.status,
        json: async () => postResponse.body,
      } as Response;
    }
    return { ok: true, status: 200, json: async () => ({ requests }) } as Response;
  }) as unknown as typeof fetch;
  return posts;
}

beforeEach(() => {
  vi.restoreAllMocks();
  push.mockClear();
});

describe("AccessRequestList", () => {
  it("shows the empty state when nothing is pending", async () => {
    stubFetch([]);
    render(<AccessRequestList />);
    await waitFor(() =>
      expect(screen.getByText("You have no pending requests.")).toBeTruthy(),
    );
  });

  it("names the firm, the advisor, the household and the expiry", async () => {
    stubFetch([req()]);
    render(<AccessRequestList />);
    await screen.findByRole("heading", { name: "Northgate Advisors" });
    expect(
      screen.getByText(/Dana Reed at Northgate Advisors/),
    ).toBeTruthy();
    expect(screen.getByText(/John & Jane Cooper/)).toBeTruthy();
    expect(screen.getByText(/expires on September 23, 2026/)).toBeTruthy();
  });

  it("names the firm alone when Clerk could not resolve the advisor", async () => {
    // advisorName degrades to null on a Clerk failure — the sentence must
    // still read, not render "null at Northgate Advisors".
    stubFetch([req({ advisorName: null })]);
    render(<AccessRequestList />);
    await screen.findByRole("heading", { name: "Northgate Advisors" });
    expect(screen.queryByText(/null/)).toBeNull();
  });

  it("omits the expiry line for a request that never expires", async () => {
    stubFetch([req({ expiresAt: null })]);
    render(<AccessRequestList />);
    await screen.findByRole("heading", { name: "Northgate Advisors" });
    expect(screen.queryByText(/expires on/)).toBeNull();
  });

  it("POSTs an accept and lands the client in the portal", async () => {
    const posts = stubFetch([req()]);
    render(<AccessRequestList />);
    fireEvent.click(await screen.findByText("Accept"));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0].url).toBe("/api/portal/requests");
    expect(posts[0].body).toEqual({ bindingId: "b1", action: "accept" });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/portal/organizer"));
  });

  it("drops a declined request without navigating away", async () => {
    // The other request in the list is still the client's to answer.
    const posts = stubFetch([req(), req({ bindingId: "b2", firmName: "Halyard Wealth" })]);
    render(<AccessRequestList />);
    await screen.findByRole("heading", { name: "Halyard Wealth" });
    fireEvent.click(screen.getAllByText("Decline")[0]);
    await waitFor(() => expect(posts[0].body).toEqual({ bindingId: "b1", action: "decline" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Northgate Advisors" })).toBeNull());
    expect(screen.getByRole("heading", { name: "Halyard Wealth" })).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
  });

  it("surfaces the server's reason for a refused accept instead of navigating", async () => {
    stubFetch([req()], {
      status: 409,
      body: { error: "This request has expired. Ask your advisor to send a new one." },
    });
    render(<AccessRequestList />);
    fireEvent.click(await screen.findByText("Accept"));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/expired/i));
    expect(push).not.toHaveBeenCalled();
  });

  it("offers a retry when the list cannot be loaded", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    render(<AccessRequestList />);
    await waitFor(() => expect(screen.getByText("Try again")).toBeTruthy());
  });
});
