// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { CalendarPaneState } from "../calendar-pane-state";

const CONNECT_URL = "/api/workspace/microsoft/connect";
const SETTINGS_URL = "/settings/integrations/microsoft_365";

describe("CalendarPaneState", () => {
  it("firm not approved: a non-admin is told who can turn it on, with no settings link", () => {
    render(<CalendarPaneState state="firm_not_approved" isAdmin={false} />);
    expect(
      screen.getByText("Your firm's admin can turn on Microsoft 365 in Settings → Integrations."),
    ).toBeInTheDocument();
    expect(document.querySelector(`a[href="${SETTINGS_URL}"]`)).toBeNull();
  });

  it("firm not approved: an admin gets the link to the Microsoft 365 settings page", () => {
    render(<CalendarPaneState state="firm_not_approved" isAdmin />);
    expect(screen.getByRole("link", { name: "Connect Microsoft 365" })).toHaveAttribute(
      "href",
      SETTINGS_URL,
    );
  });

  it("member off: asks for the admin", () => {
    render(<CalendarPaneState state="member_off" isAdmin={false} />);
    expect(
      screen.getByText("Ask your firm's admin to turn on Microsoft 365 for you."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("connect: the prompt links to the advisor connect route", () => {
    render(<CalendarPaneState state="connect" isAdmin={false} />);
    expect(screen.getByText("Bring in your Outlook calendar")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your firm has approved Microsoft 365. Sign in once with your work account to see your week and your Outlook to-dos here.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Connect Microsoft 365" })).toHaveAttribute(
      "href",
      CONNECT_URL,
    );
  });

  it("needs reconnect: says the sign-in expired and links to reconnect", () => {
    render(<CalendarPaneState state="needs_reconnect" isAdmin={false} />);
    expect(screen.getByText("Your Microsoft sign-in expired.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute("href", CONNECT_URL);
  });

  it("throttled: says Microsoft is busy and Retry calls back", () => {
    const onRetry = vi.fn();
    render(<CalendarPaneState state="throttled" isAdmin={false} onRetry={onRetry} />);
    expect(
      screen.getByText("Microsoft is busy right now — try again in a minute."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("unavailable: a failure that isn't throttling points to the admin, not 'busy'", () => {
    const onRetry = vi.fn();
    render(<CalendarPaneState state="unavailable" isAdmin={false} onRetry={onRetry} />);
    expect(screen.getByText("Couldn't load your calendar from Microsoft.")).toBeInTheDocument();
    expect(screen.getByText("If this keeps happening, ask your firm's admin.")).toBeInTheDocument();
    expect(screen.queryByText(/busy/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
