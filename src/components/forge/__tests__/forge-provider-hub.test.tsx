// src/components/forge/__tests__/forge-provider-hub.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { useEffect } from "react";
import { render, screen, act } from "@testing-library/react";
import { ScenarioDrawerProvider } from "@/components/scenario/scenario-drawer-provider";
import { ForgeProvider, useForge } from "../forge-provider";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/clients/c1/overview",
  useSearchParams: () => new URLSearchParams(""),
}));

let forge!: ReturnType<typeof useForge>;
function Probe() {
  const value = useForge();
  // Hand the context to the test after each commit: a render-time write to a
  // module variable trips react-hooks/globals.
  useEffect(() => {
    forge = value;
  });
  return <span data-testid="tab">{value.tab}</span>;
}
const mount = () =>
  render(
    <ScenarioDrawerProvider>
      <ForgeProvider clientId="c1">
        <Probe />
      </ForgeProvider>
    </ScenarioDrawerProvider>,
  );

describe("ForgeProvider — Knowledge Hub state", () => {
  it("starts on the Chat tab", () => {
    mount();
    expect(screen.getByTestId("tab").textContent).toBe("chat");
  });

  it("openHubVideo switches to the Hub with a fresh target each call", () => {
    mount();
    act(() => forge.openHubVideo("add-one-time-expense", 30));
    expect(forge.tab).toBe("hub");
    expect(forge.hubTarget).toMatchObject({ slug: "add-one-time-expense", at: 30 });
    const first = forge.hubTarget!.nonce;
    act(() => forge.openHubVideo("add-one-time-expense", 30));
    expect(forge.hubTarget!.nonce).not.toBe(first);
  });

  it("askInChat switches to Chat carrying the draft; clearChatDraft empties it", () => {
    mount();
    act(() => forge.setTab("hub"));
    act(() => forge.askInChat("roth"));
    expect(forge.tab).toBe("chat");
    expect(forge.chatDraft).toBe("roth");
    act(() => forge.clearChatDraft());
    expect(forge.chatDraft).toBeNull();
  });
});
