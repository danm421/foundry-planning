// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CalendarPaneState } from "../calendar-pane-state";

const MICROSOFT_CONNECT_URL = "/api/workspace/microsoft/connect";
const GOOGLE_CONNECT_URL = "/api/workspace/google/connect";

describe("CalendarPaneState", () => {
  it("connect: the fixed copy, with a button for Google and one for Microsoft 365", () => {
    render(<CalendarPaneState state="connect" googleEnabled />);
    expect(screen.getByText("Bring in your calendar and to-dos")).toBeInTheDocument();
    expect(
      screen.getByText("Connect any of your addresses — Google or Microsoft 365. You can add more later."),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Google" })).toHaveAttribute("href", GOOGLE_CONNECT_URL);
    expect(screen.getByRole("link", { name: "Connect Microsoft 365" })).toHaveAttribute(
      "href",
      MICROSOFT_CONNECT_URL,
    );
  });

  it("connect: with Google not set up, only Microsoft 365 is offered", () => {
    render(<CalendarPaneState state="connect" googleEnabled={false} />);
    expect(screen.queryByRole("link", { name: "Connect Google" })).toBeNull();
    expect(screen.getAllByRole("link")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Connect Microsoft 365" })).toHaveAttribute(
      "href",
      MICROSOFT_CONNECT_URL,
    );
  });

  it("(Review Focus 5) impersonating: the fixed copy, and nothing to connect", () => {
    render(<CalendarPaneState state="impersonating" googleEnabled />);
    expect(screen.getByText("Hidden while you're signed in as someone else")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Workspace never shows an advisor's Google or Microsoft calendar or to-dos to Foundry staff.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("needs reconnect: says the sign-in expired and links to reconnect", () => {
    render(<CalendarPaneState state="needs_reconnect" googleEnabled={false} />);
    expect(screen.getByText("Your Microsoft sign-in expired.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", MICROSOFT_CONNECT_URL);
  });

  it("unavailable: says it couldn't load, not 'busy', and Retry calls back", () => {
    const onRetry = vi.fn();
    render(<CalendarPaneState state="unavailable" googleEnabled={false} onRetry={onRetry} />);
    expect(screen.getByText("Couldn't load your calendar from Microsoft.")).toBeInTheDocument();
    expect(screen.getByText("If this keeps happening, ask your firm's admin.")).toBeInTheDocument();
    expect(screen.queryByText(/busy/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
