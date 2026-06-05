// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { test, expect, vi } from "vitest";
import {
  ScenarioDrawerProvider,
  useScenarioDrawer,
} from "../scenario-drawer-provider";

function Probe() {
  const { open, toggle } = useScenarioDrawer();
  return (
    <button onClick={toggle}>{open ? "open" : "closed"}</button>
  );
}

test("defaults closed and toggles open", () => {
  render(
    <ScenarioDrawerProvider>
      <Probe />
    </ScenarioDrawerProvider>,
  );
  const btn = screen.getByRole("button");
  expect(btn).toHaveTextContent("closed");
  fireEvent.click(btn);
  expect(btn).toHaveTextContent("open");
});

test("throws when used outside the provider", () => {
  // The hook is intentionally strict (unlike the no-op scenario-mode context)
  // so a missing-provider bug surfaces loudly. Swallow React's error log.
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(() => render(<Probe />)).toThrow(/ScenarioDrawerProvider/);
  spy.mockRestore();
});
