// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { WalkthroughProvider } from "../walkthrough-provider";
import { useWalkthrough } from "../walkthrough-context";

const push = vi.fn();
let pathname = "/clients";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  usePathname: () => pathname,
}));

function Probe() {
  const w = useWalkthrough();
  return (
    <div>
      <span data-testid="active">{w.active?.id ?? "none"}</span>
      <span data-testid="step">{w.stepIndex}</span>
      <button onClick={() => w.start("add-household")}>start</button>
      <button onClick={() => w.next()}>next</button>
      <button onClick={() => w.exit()}>exit</button>
    </div>
  );
}

beforeEach(() => {
  push.mockClear();
  pathname = "/clients";
});

describe("WalkthroughProvider state machine", () => {
  it("start() activates the tour at step 0", () => {
    render(
      <WalkthroughProvider>
        <Probe />
      </WalkthroughProvider>,
    );
    act(() => void screen.getByText("start").click());
    expect(screen.getByTestId("active").textContent).toBe("add-household");
    expect(screen.getByTestId("step").textContent).toBe("0");
  });

  it("manual next() advances the step index", () => {
    render(
      <WalkthroughProvider>
        <Probe />
      </WalkthroughProvider>,
    );
    act(() => void screen.getByText("start").click());
    act(() => void screen.getByText("next").click());
    expect(screen.getByTestId("step").textContent).toBe("1");
  });

  it("exit() clears the tour", () => {
    render(
      <WalkthroughProvider>
        <Probe />
      </WalkthroughProvider>,
    );
    act(() => void screen.getByText("start").click());
    act(() => void screen.getByText("exit").click());
    expect(screen.getByTestId("active").textContent).toBe("none");
  });

  it("next() past the last step completes and clears the tour", () => {
    render(
      <WalkthroughProvider>
        <Probe />
      </WalkthroughProvider>,
    );
    act(() => void screen.getByText("start").click());
    for (let i = 0; i < 5; i++) act(() => void screen.getByText("next").click());
    expect(screen.getByTestId("active").textContent).toBe("none");
  });

  it("auto-advances when the target route arrives (advanceOn:navigate)", () => {
    const { rerender } = render(
      <WalkthroughProvider>
        <Probe />
      </WalkthroughProvider>,
    );
    act(() => void screen.getByText("start").click());
    expect(screen.getByTestId("step").textContent).toBe("0");

    act(() => {
      pathname = "/crm/new";
      rerender(
        <WalkthroughProvider>
          <Probe />
        </WalkthroughProvider>,
      );
    });

    expect(screen.getByTestId("step").textContent).toBe("1");
  });

  it("Escape key ends an active tour", () => {
    render(
      <WalkthroughProvider>
        <Probe />
      </WalkthroughProvider>,
    );
    act(() => void screen.getByText("start").click());
    expect(screen.getByTestId("active").textContent).toBe("add-household");

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(screen.getByTestId("active").textContent).toBe("none");
  });
});
