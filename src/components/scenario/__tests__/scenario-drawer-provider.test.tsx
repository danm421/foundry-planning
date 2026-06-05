// @vitest-environment jsdom
import { render, screen, fireEvent } from "@testing-library/react";
import { test, expect } from "vitest";
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
