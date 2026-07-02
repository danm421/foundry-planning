// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

let mockPath = "/clients";
vi.mock("next/navigation", () => ({ usePathname: () => mockPath, useRouter: () => ({ push: vi.fn() }) }));
// Stub the heavy children to a sentinel so we only assert mount/suppress.
vi.mock("../forge-panel", () => ({ ForgePanel: () => <div data-testid="panel" /> }));
vi.mock("../forge-launcher", () => ({ ForgeLauncher: () => <div data-testid="launcher" /> }));
vi.mock("../forge-provider", () => ({ ForgeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
// Defensive: ForgePanel is mocked above so useWalkthrough is never invoked here,
// but mock the walkthrough context too so this test stays safe if that mock is
// ever removed (panel imports useWalkthrough — Task 9 handoff).
vi.mock("../walkthrough-context", () => ({
  useWalkthrough: () => ({ active: null, stepIndex: 0, currentStep: null, start: vi.fn(), next: vi.fn(), exit: vi.fn() }),
}));

import { GlobalForgeMount } from "../global-forge-mount";

describe("GlobalForgeMount", () => {
  it("renders on the /clients list", () => {
    mockPath = "/clients";
    const { queryByTestId } = render(<GlobalForgeMount enabled />);
    expect(queryByTestId("launcher")).not.toBeNull();
  });
  it("suppresses itself on a client-scoped route", () => {
    mockPath = "/clients/abc-123/cashflow";
    const { queryByTestId } = render(<GlobalForgeMount enabled />);
    expect(queryByTestId("launcher")).toBeNull();
  });
  it("renders nothing when disabled", () => {
    mockPath = "/clients";
    const { queryByTestId } = render(<GlobalForgeMount enabled={false} />);
    expect(queryByTestId("launcher")).toBeNull();
  });
});
