// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { FirstRunCard } from "../first-run-card";

vi.mock("@/components/forge/walkthrough-context", () => ({
  useWalkthrough: () => ({ start: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

beforeEach(() => {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) }),
  ) as unknown as typeof fetch;
});

describe("FirstRunCard", () => {
  it("renders nothing when hidden", () => {
    const { container } = render(<FirstRunCard card={{ kind: "hidden" }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers guided setup when there is no client yet", () => {
    render(<FirstRunCard card={{ kind: "no_client" }} />);
    expect(screen.getByRole("button", { name: /start guided setup/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /i'll explore first/i })).toBeTruthy();
  });

  it("shows resumable progress mid-setup", () => {
    render(
      <FirstRunCard
        card={{
          kind: "in_progress",
          clientId: "c1",
          householdName: "Johnson",
          completedSteps: 4,
          totalSteps: 9,
        }}
      />,
    );
    expect(screen.getByText(/Johnson/)).toBeTruthy();
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("4");
    expect(bar.getAttribute("aria-valuemax")).toBe("9");
    expect(screen.getByRole("link", { name: /resume setup/i })).toBeTruthy();
  });

  it("celebrates completion with a link to the projection", () => {
    render(<FirstRunCard card={{ kind: "done", clientId: "c1" }} />);
    const link = screen.getByRole("link", { name: /view projection/i });
    expect(link.getAttribute("href")).toBe("/clients/c1/solver");
  });
});
