// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WalkthroughProvider, navigateToStep } from "../walkthrough-provider";
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
      {/* `active`/`step` are asserted on by the original tests; `active-id`/
          `step-index` are the names the persistence tests use. Both names
          expose the same value — neither set may be renamed away. */}
      <span data-testid="active">{w.active?.id ?? "none"}</span>
      <span data-testid="active-id">{w.active?.id ?? "none"}</span>
      <span data-testid="step">{w.stepIndex}</span>
      <span data-testid="step-index">{w.stepIndex}</span>
      <button onClick={() => w.start("add-household")}>start</button>
      <button onClick={() => w.next()}>next</button>
      <button data-testid="back" onClick={() => w.back()}>
        back
      </button>
      <button data-testid="exit" onClick={() => w.exit()}>
        exit
      </button>
    </div>
  );
}

beforeEach(() => {
  push.mockClear();
  pathname = "/clients";
  // Without this the persistence tests below leave `foundry.walkthrough` set
  // and every later test in this file mounts with a tour already running.
  sessionStorage.clear();
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

  it("restores an in-flight tour from sessionStorage on mount", () => {
    sessionStorage.setItem(
      "foundry.walkthrough",
      JSON.stringify({ id: "add-household", stepIndex: 2 }),
    );
    render(
      <WalkthroughProvider>
        <Probe />
      </WalkthroughProvider>,
    );
    expect(screen.getByTestId("step-index").textContent).toBe("2");
    expect(screen.getByTestId("active-id").textContent).toBe("add-household");
  });

  it("clears persisted state when the tour exits", async () => {
    sessionStorage.setItem(
      "foundry.walkthrough",
      JSON.stringify({ id: "add-household", stepIndex: 2 }),
    );
    render(
      <WalkthroughProvider>
        <Probe />
      </WalkthroughProvider>,
    );
    await userEvent.click(screen.getByTestId("exit"));
    expect(sessionStorage.getItem("foundry.walkthrough")).toBeNull();
  });

  it("back() steps to the previous index and stops at zero", async () => {
    sessionStorage.setItem(
      "foundry.walkthrough",
      JSON.stringify({ id: "add-household", stepIndex: 2 }),
    );
    render(
      <WalkthroughProvider>
        <Probe />
      </WalkthroughProvider>,
    );
    await userEvent.click(screen.getByTestId("back"));
    expect(screen.getByTestId("step-index").textContent).toBe("1");
    await userEvent.click(screen.getByTestId("back"));
    await userEvent.click(screen.getByTestId("back"));
    expect(screen.getByTestId("step-index").textContent).toBe("0");
  });
});

describe("navigateToStep", () => {
  it("does not navigate when already on the step's route", () => {
    const push = vi.fn();
    navigateToStep("/crm/new", "/crm/new", push);
    expect(push).not.toHaveBeenCalled();
  });

  it("never pushes a wildcard pattern as a literal URL", () => {
    const push = vi.fn();
    // already on a matching wizard route — nothing to do
    navigateToStep("/clients/:id/onboarding/:step", "/clients/abc/onboarding/accounts", push);
    expect(push).not.toHaveBeenCalled();
    // NOT on a matching route — still must not push ":id" as a real segment
    navigateToStep("/clients/:id/onboarding/:step", "/home", push);
    expect(push).not.toHaveBeenCalled();
  });

  it("pushes a literal route when elsewhere", () => {
    const push = vi.fn();
    navigateToStep("/crm/new", "/home", push);
    expect(push).toHaveBeenCalledWith("/crm/new");
  });
});
