// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { test, expect, vi } from "vitest";
import { ScenarioDrawerProvider } from "../scenario-drawer-provider";
import { ScenarioDrawer } from "../scenario-drawer";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

const baseProps = {
  clientId: "c1",
  scenarioId: "s1",
  scenarioName: "Retire at 62",
  changes: [],
  toggleGroups: [],
  cascadeWarnings: [],
  targetNames: {},
};

function renderDrawer(props = baseProps) {
  return render(
    <ScenarioDrawerProvider>
      <ScenarioDrawer {...props} />
    </ScenarioDrawerProvider>,
  );
}

test("renders the handle and the panel scenario name even with zero changes", () => {
  renderDrawer();
  expect(
    screen.getByRole("button", { name: /show changes/i }),
  ).toBeInTheDocument();
  expect(screen.getByText("Retire at 62")).toBeInTheDocument();
});

test("handle toggles aria-expanded open and closed", () => {
  renderDrawer();
  const handle = screen.getByRole("button", { name: /show changes/i });
  expect(handle).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(handle);
  expect(
    screen.getByRole("button", { name: /hide changes/i }),
  ).toHaveAttribute("aria-expanded", "true");
});

test("Escape closes the drawer when open", () => {
  renderDrawer();
  fireEvent.click(screen.getByRole("button", { name: /show changes/i }));
  expect(
    screen.getByRole("button", { name: /hide changes/i }),
  ).toBeInTheDocument();
  fireEvent.keyDown(document.body, { key: "Escape" });
  expect(
    screen.getByRole("button", { name: /show changes/i }),
  ).toBeInTheDocument();
});
