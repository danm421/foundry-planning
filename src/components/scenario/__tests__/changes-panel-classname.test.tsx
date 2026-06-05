// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { test, expect, vi } from "vitest";
import { ChangesPanel } from "../changes-panel";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

test("applies an optional className to the panel aside", () => {
  const { container } = render(
    <ChangesPanel
      clientId="c1"
      scenarioId="s1"
      scenarioName="Retire at 62"
      changes={[]}
      toggleGroups={[]}
      cascadeWarnings={[]}
      targetNames={{}}
      className="h-full"
    />,
  );
  const aside = container.querySelector("aside");
  expect(aside?.className).toContain("h-full");
});
