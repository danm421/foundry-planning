// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

import ModePickerClient from "../mode-picker-client";

function mockFetchOnce(json: unknown, ok = true) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok,
      status: ok ? 201 : 400,
      json: async () => json,
    }),
  );
}

function lastRequestBody(): Record<string, unknown> {
  const call = vi.mocked(fetch).mock.calls[0];
  const init = call[1] as RequestInit;
  return JSON.parse(init.body as string);
}

beforeEach(() => {
  pushMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("mode picker", () => {
  it("offers Statement chat as a third option", () => {
    render(
      <ModePickerClient clientId="c1" scenarios={[]} defaultScenarioId={null} />,
    );
    expect(
      screen.getByRole("radio", { name: /statement chat/i }),
    ).toBeInTheDocument();
  });

  it("keeps the chat option enabled with no scenarios, unlike Updating (C7)", () => {
    render(
      <ModePickerClient clientId="c1" scenarios={[]} defaultScenarioId={null} />,
    );
    expect(
      screen.getByRole("radio", { name: /statement chat/i }),
    ).toBeEnabled();
    expect(screen.getByRole("radio", { name: /updating/i })).toBeDisabled();
  });

  it("routes a statement-chat import to the chat surface", async () => {
    mockFetchOnce({ import: { id: "imp-1" } });
    render(
      <ModePickerClient clientId="c1" scenarios={[]} defaultScenarioId={null} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: /statement chat/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(pushMock).toHaveBeenCalledWith("/clients/c1/details/import/imp-1/chat");
  });

  it("still sends a supported mode value to the API", async () => {
    mockFetchOnce({ import: { id: "imp-1" } });
    render(
      <ModePickerClient clientId="c1" scenarios={[]} defaultScenarioId={null} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: /statement chat/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    const body = lastRequestBody();
    expect(body.mode).toBe("onboarding");
    expect(body.mode).not.toBe("chat");
    expect(body.surface).toBe("chat");
  });

  it("sends mode 'updating' for a chat import when a scenario is already selected, never 'chat'", async () => {
    mockFetchOnce({ import: { id: "imp-2" } });
    render(
      <ModePickerClient
        clientId="c1"
        scenarios={[{ id: "s1", name: "Base", isBaseCase: true }]}
        defaultScenarioId="s1"
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: /statement chat/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    const body = lastRequestBody();
    expect(body.mode).toBe("updating");
    expect(body.mode).not.toBe("chat");
    expect(body.scenarioId).toBe("s1");
    expect(body.surface).toBe("chat");
  });

  it("leaves the onboarding card's create-and-navigate behavior byte-identical (C10)", async () => {
    mockFetchOnce({ import: { id: "imp-3" } });
    render(
      <ModePickerClient clientId="c1" scenarios={[]} defaultScenarioId={null} />,
    );
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    const body = lastRequestBody();
    expect(body.mode).toBe("onboarding");
    expect(body.surface).toBeUndefined();
    expect(pushMock).toHaveBeenCalledWith("/clients/c1/details/import/imp-3");
  });
});
