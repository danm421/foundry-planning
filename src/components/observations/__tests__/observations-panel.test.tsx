// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import ObservationsPanel, { type ObservationItem } from "../observations-panel";

const CLIENT_ID = "11111111-1111-1111-1111-111111111111";

const OBSERVATION: ObservationItem = {
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  section: "observation",
  topic: "retirement",
  title: null,
  body: "On track to retire at {{client_retirement_age}}.",
  status: "open",
  owner: null,
  priority: null,
  targetDate: null,
  source: "manual",
  sortOrder: 0,
};

const NEXT_STEP: ObservationItem = {
  id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  section: "next_step",
  topic: "tax",
  title: "Review Roth conversion",
  body: "Evaluate a partial Roth conversion this year.",
  status: "open",
  owner: "advisor",
  priority: "high",
  targetDate: "2026-12-31",
  source: "manual",
  sortOrder: 0,
};

function makeFetchMock() {
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url.includes("/token-values")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ values: { client_retirement_age: "65" } }),
      } as Response);
    }
    if (url.endsWith("/observations") && method === "POST") {
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({ ...OBSERVATION, id: "new-id", body: "Quick note" }),
      } as Response);
    }
    // GET refetch after a mutation.
    if (url.endsWith("/observations")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => [OBSERVATION, NEXT_STEP],
      } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response);
  });
}

describe("ObservationsPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the observation topic heading, the next-step status button, and resolves tokens", async () => {
    global.fetch = makeFetchMock() as unknown as typeof fetch;

    render(<ObservationsPanel clientId={CLIENT_ID} initialItems={[OBSERVATION, NEXT_STEP]} />);

    // Observations are grouped under a fixed topic heading.
    expect(screen.getByText("Retirement")).toBeInTheDocument();

    // Each next step exposes a status button that cycles open → in_progress → done.
    expect(screen.getByRole("button", { name: /status:/i })).toBeInTheDocument();

    // Tokens resolve after the mount fetch of token-values.
    await waitFor(() => {
      expect(screen.getByText(/On track to retire at 65/)).toBeInTheDocument();
    });
  });

  it("posts a new observation to the observations endpoint on quick-add", async () => {
    const fetchFn = makeFetchMock();
    global.fetch = fetchFn as unknown as typeof fetch;
    const user = userEvent.setup();

    render(<ObservationsPanel clientId={CLIENT_ID} initialItems={[OBSERVATION, NEXT_STEP]} />);

    const input = screen.getByPlaceholderText(/add an observation/i);
    await user.type(input, "Quick note{Enter}");

    await waitFor(() => {
      expect(fetchFn).toHaveBeenCalledWith(
        expect.stringContaining(`/api/clients/${CLIENT_ID}/observations`),
        expect.objectContaining({ method: "POST" }),
      );
    });

    const postCall = fetchFn.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    const postedBody = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(postedBody).toEqual({ section: "observation", body: "Quick note" });
  });
});
