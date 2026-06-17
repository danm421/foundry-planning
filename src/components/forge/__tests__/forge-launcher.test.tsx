// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ScenarioDrawerProvider } from "@/components/scenario/scenario-drawer-provider";
import { ForgeProvider } from "../forge-provider";
import { ForgeLauncher } from "../forge-launcher";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients/c1/overview",
  useSearchParams: () => new URLSearchParams(""),
}));

describe("ForgeLauncher", () => {
  it("renders an AI launcher wired to aria-controls=forge-panel and toggles open", () => {
    render(
      <ScenarioDrawerProvider>
        <ForgeProvider clientId="c1">
          <ForgeLauncher />
        </ForgeProvider>
      </ScenarioDrawerProvider>,
    );

    const btn = screen.getByRole("button", { name: /open forge/i });
    expect(btn).toHaveAttribute("aria-controls", "forge-panel");
    expect(btn).toHaveAttribute("aria-expanded", "false");

    act(() => btn.click());
    // Once open, the launcher hides itself (the panel owns close); querying by
    // its open-label returns nothing.
    expect(screen.queryByRole("button", { name: /open forge/i })).toBeNull();
  });
});
