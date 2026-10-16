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
  it("offers Fact finder import as a third option, and no statement chat", () => {
    render(
      <ModePickerClient clientId="c1" scenarios={[]} defaultScenarioId={null} />,
    );
    expect(
      screen.getByRole("radio", { name: /fact finder import/i }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /statement chat/i })).toBeNull();
    expect(
      screen.getByText(
        "Drop statements or a fact finder. Review it all as one editable fact finder before anything touches the plan.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the fact finder option enabled with no scenarios, unlike Updating (C7)", () => {
    render(
      <ModePickerClient clientId="c1" scenarios={[]} defaultScenarioId={null} />,
    );
    expect(
      screen.getByRole("radio", { name: /fact finder import/i }),
    ).toBeEnabled();
    expect(screen.getByRole("radio", { name: /updating/i })).toBeDisabled();
  });

  it("opens a new fact finder import on the fact finder screen", async () => {
    mockFetchOnce({ import: { id: "imp-1" } });
    render(
      <ModePickerClient clientId="c1" scenarios={[]} defaultScenarioId={null} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: /fact finder import/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    expect(pushMock).toHaveBeenCalledWith("/clients/c1/details/import/imp-1/fact-finder");
  });

  it("sends mode 'onboarding' with no scenario and surface 'fact_finder', never mode 'chat'", async () => {
    mockFetchOnce({ import: { id: "imp-1" } });
    render(
      <ModePickerClient clientId="c1" scenarios={[]} defaultScenarioId={null} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: /fact finder import/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    const body = lastRequestBody();
    expect(body.mode).toBe("onboarding");
    expect(body.mode).not.toBe("chat");
    expect(body.scenarioId).toBeNull();
    expect(body.surface).toBe("fact_finder");
  });

  it("sends no scenario even when the client has a base case selected by default (R2)", async () => {
    mockFetchOnce({ import: { id: "imp-2" } });
    render(
      <ModePickerClient
        clientId="c1"
        scenarios={[{ id: "s1", name: "Base", isBaseCase: true }]}
        defaultScenarioId="s1"
      />,
    );
    await userEvent.click(screen.getByRole("radio", { name: /fact finder import/i }));
    await userEvent.click(screen.getByRole("button", { name: /continue/i }));
    const body = lastRequestBody();
    expect(body.mode).toBe("onboarding");
    expect(body.scenarioId).toBeNull();
    expect(body.surface).toBe("fact_finder");
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
