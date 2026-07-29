// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "../toast";
import DetailsViewModeToggle from "../details-view-mode-toggle";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
  useSearchParams: () => new URLSearchParams(),
}));

function renderToggle(mode: "detailed" | "map" = "detailed") {
  return render(
    <ToastProvider>
      <DetailsViewModeToggle clientId="C1" mode={mode} />
    </ToastProvider>,
  );
}

describe("DetailsViewModeToggle", () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    vi.unstubAllGlobals();
  });

  it("renders both options with the current mode pressed", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderToggle("detailed");
    expect(screen.getByRole("button", { name: "Map" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Detailed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  // Load-bearing: the reviewed finding was that clicking Map then immediately
  // Detailed — before the first PATCH resolves — used to fire two concurrent
  // requests (the old guard only became true *after* the request settled).
  // A fetch mock that resolves immediately would never land the second click
  // inside the request window, so this uses a manually-resolved promise to
  // pin the race.
  it("does not fire a second PATCH while the first is still in flight", async () => {
    let resolveFetch!: (value: { ok: boolean }) => void;
    const inFlight = new Promise<{ ok: boolean }>((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(inFlight);
    vi.stubGlobal("fetch", fetchMock);

    renderToggle("detailed");

    fireEvent.click(screen.getByRole("button", { name: "Map" }));
    // The first click's fetch is still unresolved here — this is the window
    // the old code left unguarded.
    fireEvent.click(screen.getByRole("button", { name: "Detailed" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch({ ok: true });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(push).toHaveBeenCalledWith("/clients/C1/details/map");
  });

  it("reverts to the previous mode and toasts on a failed PATCH", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      text: () => Promise.resolve("server error"),
    });
    vi.stubGlobal("fetch", fetchMock);

    renderToggle("detailed");
    fireEvent.click(screen.getByRole("button", { name: "Map" }));

    await screen.findByText("Couldn't switch view");
    expect(screen.getByRole("button", { name: "Detailed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(push).not.toHaveBeenCalled();
  });
});
