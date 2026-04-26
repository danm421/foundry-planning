// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import { SnapshotBanner } from "../snapshot-banner";

const setSideMock = vi.fn();

vi.mock("@/hooks/use-compare-state", () => ({
  useCompareState: () => ({
    left: "base",
    right: "snap:abc",
    toggleSet: new Set<string>(),
    setSide: setSideMock,
    setToggle: vi.fn(),
  }),
}));

describe("SnapshotBanner", () => {
  beforeEach(() => {
    setSideMock.mockClear();
  });

  it("renders the snapshot name, frozen-by user, and frozen-at date", () => {
    render(
      <SnapshotBanner
        clientId="c1"
        side="right"
        snapshotName="Manual A"
        frozenBy="user_2qXyZ"
        frozenAt={new Date("2026-04-25T12:00:00Z")}
      />,
    );
    const banner = screen.getByTestId("snapshot-banner-right");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("Manual A");
    expect(banner).toHaveTextContent("user_2qXyZ");
    // Allow either MM/DD/YYYY or M/D/YYYY locale rendering — assert year is present
    expect(banner).toHaveTextContent(/2026/);
  });

  it("accepts an ISO string and renders the parsed date", () => {
    render(
      <SnapshotBanner
        clientId="c1"
        side="right"
        snapshotName="Manual A"
        frozenBy="user_2qXyZ"
        frozenAt={"2026-04-25T12:00:00Z"}
      />,
    );
    const banner = screen.getByTestId("snapshot-banner-right");
    expect(banner).toHaveTextContent(/2026/);
  });

  it("Return-to-live button calls setSide(side, null)", () => {
    render(
      <SnapshotBanner
        clientId="c1"
        side="right"
        snapshotName="Manual A"
        frozenBy="user_2qXyZ"
        frozenAt={new Date("2026-04-25T12:00:00Z")}
      />,
    );
    fireEvent.click(screen.getByText("[Return to live]"));
    expect(setSideMock).toHaveBeenCalledTimes(1);
    expect(setSideMock).toHaveBeenCalledWith("right", null);
  });

  it("renders a left-side banner with side-specific testid + click target", () => {
    render(
      <SnapshotBanner
        clientId="c1"
        side="left"
        snapshotName="Last quarter"
        frozenBy="user_abc"
        frozenAt={new Date("2026-01-15T00:00:00Z")}
      />,
    );
    expect(screen.getByTestId("snapshot-banner-left")).toBeInTheDocument();
    fireEvent.click(screen.getByText("[Return to live]"));
    expect(setSideMock).toHaveBeenCalledWith("left", null);
  });
});
