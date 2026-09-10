// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import HouseholdSwitcher from "@/components/portal/household-switcher";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const one = [{ clientId: "c1", label: "The Reed Household · Northgate Advisors" }];
const two = [...one, { clientId: "c2", label: "The Alvarez Household · Latimer Wealth" }];

/** Two options whose HOUSEHOLD halves are identical — the multi-firm client
 *  this control exists for. The firm half is what keeps them apart. */
const colliding = [
  { clientId: "c1", label: "The Reed Household · Northgate Advisors" },
  { clientId: "c2", label: "The Reed Household · Latimer Wealth" },
];

type Sent = { url: string; method?: string; body: unknown };

/** Records every POST and answers it with `response`. */
function stubFetch(response: { status: number } = { status: 200 }): Sent[] {
  const sent: Sent[] = [];
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
    return {
      ok: response.status < 400,
      status: response.status,
      json: async () => ({}),
    } as Response;
  }) as unknown as typeof fetch;
  return sent;
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
  refresh.mockClear();
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function picker(): HTMLSelectElement {
  return screen.getByRole("combobox", { name: /household/i }) as HTMLSelectElement;
}

describe("HouseholdSwitcher", () => {
  it("renders nothing for a client with one household", () => {
    const { container } = render(<HouseholdSwitcher households={one} activeClientId="c1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing at all when there are no households", () => {
    const { container } = render(<HouseholdSwitcher households={[]} activeClientId="" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders a picker with both households when there are two", () => {
    render(<HouseholdSwitcher households={two} activeClientId="c1" />);
    expect(picker()).toBeInTheDocument();
    expect(screen.getByText("The Alvarez Household · Latimer Wealth")).toBeInTheDocument();
    expect(picker().value).toBe("c1");
  });

  // O3: a control with no accessible name is unreachable by name for anyone
  // navigating by voice or screen reader. `getByRole` alone would pass on one.
  it("gives the picker an accessible name", () => {
    render(<HouseholdSwitcher households={two} activeClientId="c1" />);
    expect(screen.getByRole("combobox", { name: /household/i })).toBeInTheDocument();
  });

  it("keeps colliding household names apart by naming the firm", () => {
    render(<HouseholdSwitcher households={colliding} activeClientId="c1" />);
    const labels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual([
      "The Reed Household · Northgate Advisors",
      "The Reed Household · Latimer Wealth",
    ]);
    expect(new Set(labels).size).toBe(2);
  });

  it("POSTs the chosen household and refreshes the route", async () => {
    const sent = stubFetch();
    render(<HouseholdSwitcher households={two} activeClientId="c1" />);
    fireEvent.change(picker(), { target: { value: "c2" } });

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(sent).toEqual([
      {
        url: "/api/portal/active-household",
        method: "POST",
        body: { clientId: "c2" },
      },
    ]);
    expect(picker().value).toBe("c2");
  });

  it("does not POST when the same household is re-chosen", async () => {
    const sent = stubFetch();
    render(<HouseholdSwitcher households={two} activeClientId="c1" />);
    fireEvent.change(picker(), { target: { value: "c1" } });

    await waitFor(() => expect(sent).toEqual([]));
    expect(refresh).not.toHaveBeenCalled();
  });

  // A silent failure reads as a dead control: the client presses, nothing
  // moves, and they have no idea whether they switched.
  it("says the household is gone on a 404 and snaps back", async () => {
    stubFetch({ status: 404 });
    render(<HouseholdSwitcher households={two} activeClientId="c1" />);
    fireEvent.change(picker(), { target: { value: "c2" } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/no longer connected/i));
    expect(refresh).not.toHaveBeenCalled();
    expect(picker().value).toBe("c1");
  });

  it("says something actionable on any other failure and snaps back", async () => {
    stubFetch({ status: 500 });
    render(<HouseholdSwitcher households={two} activeClientId="c1" />);
    fireEvent.change(picker(), { target: { value: "c2" } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/try again/i));
    expect(picker().value).toBe("c1");
  });

  it("survives a thrown fetch rather than leaving the control stuck", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    render(<HouseholdSwitcher households={two} activeClientId="c1" />);
    fireEvent.change(picker(), { target: { value: "c2" } });

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/try again/i));
    expect(picker().value).toBe("c1");
    expect(picker()).not.toBeDisabled();
  });
});
