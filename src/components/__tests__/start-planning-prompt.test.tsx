// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StartPlanningPrompt } from "../start-planning-prompt";

const replaceMock = vi.fn();
const pushMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock, push: pushMock }),
}));

const HOUSEHOLD = { id: "hh-1", name: "Cooper & Susan Sample" };

beforeEach(() => {
  replaceMock.mockReset();
  pushMock.mockReset();
});

it("names the household and offers all four start paths", () => {
  render(<StartPlanningPrompt household={HOUSEHOLD} />);

  expect(screen.getByRole("dialog", { name: /household created/i })).toBeInTheDocument();
  expect(screen.getByText("Cooper & Susan Sample")).toBeInTheDocument();
  for (const name of [/quick start/i, /detailed setup/i, /ai import/i, /empty client/i]) {
    expect(screen.getByRole("button", { name })).toBeInTheDocument();
  }
});

it("routes to /clients/new with the chosen path pre-selected", () => {
  render(<StartPlanningPrompt household={HOUSEHOLD} />);

  fireEvent.click(screen.getByRole("button", { name: /ai import/i }));

  expect(replaceMock).toHaveBeenCalledWith("/clients/new?crmHouseholdId=hh-1&path=import");
  expect(pushMock).not.toHaveBeenCalled();
});

it("carries the right path for each card", () => {
  const cases: [RegExp, string][] = [
    [/quick start/i, "quick"],
    [/detailed setup/i, "detailed"],
    [/empty client/i, "empty"],
  ];
  for (const [name, path] of cases) {
    replaceMock.mockReset();
    const { unmount } = render(<StartPlanningPrompt household={HOUSEHOLD} />);
    fireEvent.click(screen.getByRole("button", { name }));
    expect(replaceMock).toHaveBeenCalledWith(
      `/clients/new?crmHouseholdId=hh-1&path=${path}`,
    );
    unmount();
  }
});

it("sends 'Not now' to the new CRM record", () => {
  render(<StartPlanningPrompt household={HOUSEHOLD} />);

  fireEvent.click(screen.getByRole("button", { name: /not now/i }));

  expect(replaceMock).toHaveBeenCalledWith("/crm/households/hh-1");
});

it("treats Escape exactly like 'Not now'", () => {
  render(<StartPlanningPrompt household={HOUSEHOLD} />);

  fireEvent.keyDown(window, { key: "Escape" });

  expect(replaceMock).toHaveBeenCalledWith("/crm/households/hh-1");
});

it("treats a backdrop click exactly like 'Not now'", () => {
  render(<StartPlanningPrompt household={HOUSEHOLD} />);

  fireEvent.click(screen.getByTestId("dialog-overlay"));

  expect(replaceMock).toHaveBeenCalledWith("/crm/households/hh-1");
});
