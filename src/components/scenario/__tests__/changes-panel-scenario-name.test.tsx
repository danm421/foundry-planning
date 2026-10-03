// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ScenarioNameEditor } from "@/components/scenario/changes-panel-scenario-name";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

function renderEditor(name = "New Shore House") {
  return render(<ScenarioNameEditor clientId="c1" scenarioId="s1" name={name} />);
}

function openEditor() {
  fireEvent.click(screen.getByRole("button", { name: /rename scenario/i }));
  return screen.getByLabelText("Scenario name") as HTMLInputElement;
}

describe("ScenarioNameEditor", () => {
  beforeEach(() => {
    refreshMock.mockClear();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })) as typeof fetch;
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the name as a button that opens an inline editor", () => {
    renderEditor();
    const input = openEditor();
    expect(input.value).toBe("New Shore House");
    expect(input.maxLength).toBe(60);
  });

  it("Enter saves the trimmed name through the scenario route and refreshes", async () => {
    renderEditor();
    const input = openEditor();
    fireEvent.change(input, { target: { value: "  Lake House  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(refreshMock).toHaveBeenCalledTimes(1));
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("/api/clients/c1/scenarios/s1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Lake House" });
    // The new name shows straight away, before the refreshed prop arrives.
    expect(screen.getByRole("button", { name: "Rename scenario Lake House" })).toBeInTheDocument();
  });

  it("Escape cancels without saving", () => {
    renderEditor();
    const input = openEditor();
    fireEvent.change(input, { target: { value: "Something else" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.getByRole("button", { name: "Rename scenario New Shore House" })).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("an unchanged or blank name closes the editor without a request", () => {
    renderEditor();
    fireEvent.blur(openEditor());
    const input = openEditor();
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.blur(input);
    expect(screen.getByRole("button", { name: "Rename scenario New Shore House" })).toBeInTheDocument();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("keeps the editor open with an error when the save fails", async () => {
    globalThis.fetch = vi.fn(async () => new Response("{}", { status: 500 })) as typeof fetch;
    renderEditor();
    const input = openEditor();
    fireEvent.change(input, { target: { value: "Lake House" } });
    fireEvent.blur(input);
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't rename");
    expect(screen.getByLabelText("Scenario name")).toHaveValue("Lake House");
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
