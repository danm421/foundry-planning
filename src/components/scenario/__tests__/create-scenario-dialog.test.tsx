// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CreateScenarioDialog } from "../create-scenario-dialog";

const pushSpy = vi.fn();
const refreshSpy = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushSpy, refresh: refreshSpy }),
}));

const CLIENT_ID = "client-123";

const SCENARIOS = [
  { id: "base", name: "Base case", isBaseCase: true },
  { id: "s1", name: "Roth conversion", isBaseCase: false },
  { id: "s2", name: "Early retirement", isBaseCase: false },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pushSpy.mockReset();
  refreshSpy.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  // Force a stable URL so URL parsing in submit() is deterministic.
  window.history.replaceState({}, "", "/clients/client-123");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CreateScenarioDialog", () => {
  it("renders nothing when open is false", () => {
    const { container } = render(
      <CreateScenarioDialog
        clientId={CLIENT_ID}
        scenarios={SCENARIOS}
        open={false}
        onClose={() => {}}
      />,
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders dialog with name input, copy-from select, Cancel + Create buttons when open", () => {
    render(
      <CreateScenarioDialog
        clientId={CLIENT_ID}
        scenarios={SCENARIOS}
        open
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInTheDocument();
    expect(screen.getByLabelText("Copy from")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create" })).toBeInTheDocument();
  });

  it("Create button is disabled when name is empty or whitespace", async () => {
    const user = userEvent.setup();
    render(
      <CreateScenarioDialog
        clientId={CLIENT_ID}
        scenarios={SCENARIOS}
        open
        onClose={() => {}}
      />,
    );
    const createBtn = screen.getByRole("button", { name: "Create" });
    expect(createBtn).toBeDisabled();

    // Whitespace only should still be disabled.
    await user.type(screen.getByLabelText("Name"), "   ");
    expect(createBtn).toBeDisabled();

    // Real text enables it.
    await user.type(screen.getByLabelText("Name"), "Roth");
    expect(createBtn).not.toBeDisabled();
  });

  it("submits POST with { name, copyFrom } and on success navigates to ?scenario=<new-id> + calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        scenario: { id: "new-scn-1", name: "Roth", isBaseCase: false },
      }),
    });

    render(
      <CreateScenarioDialog
        clientId={CLIENT_ID}
        scenarios={SCENARIOS}
        open
        onClose={onClose}
      />,
    );

    await user.type(screen.getByLabelText("Name"), "Roth");
    await user.selectOptions(screen.getByLabelText("Copy from"), "base");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/clients/${CLIENT_ID}/scenarios`,
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Roth", copyFrom: "base" }),
      }),
    );

    await waitFor(() => expect(pushSpy).toHaveBeenCalledTimes(1));
    const pushedUrl = pushSpy.mock.calls[0][0] as string;
    expect(pushedUrl).toContain("scenario=new-scn-1");
    // router.refresh() must follow the push so the chip row's server-fetched
    // scenarios list picks up the new row — otherwise the new scenario lands
    // in the URL but no chip exists for it.
    expect(refreshSpy).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("on submit failure displays the error message; dialog stays open; Create button re-enables", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    fetchMock.mockResolvedValueOnce({
      ok: false,
      json: async () => ({
        error: { formErrors: ["name must not be empty"], fieldErrors: {} },
      }),
    });

    render(
      <CreateScenarioDialog
        clientId={CLIENT_ID}
        scenarios={SCENARIOS}
        open
        onClose={onClose}
      />,
    );

    await user.type(screen.getByLabelText("Name"), "Roth");
    await user.click(screen.getByRole("button", { name: "Create" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("name must not be empty");
    // Dialog still mounted.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // onClose was NOT called on error.
    expect(onClose).not.toHaveBeenCalled();
    // Create button re-enabled.
    expect(screen.getByRole("button", { name: "Create" })).not.toBeDisabled();
  });

  it("pressing ESC calls onClose", () => {
    const onClose = vi.fn();
    render(
      <CreateScenarioDialog
        clientId={CLIENT_ID}
        scenarios={SCENARIOS}
        open
        onClose={onClose}
      />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop click calls onClose", () => {
    const onClose = vi.fn();
    render(
      <CreateScenarioDialog
        clientId={CLIENT_ID}
        scenarios={SCENARIOS}
        open
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not POST when name is whitespace-only", () => {
    render(
      <CreateScenarioDialog
        clientId={CLIENT_ID}
        scenarios={SCENARIOS}
        open
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "   " },
    });
    const form = screen.getByRole("dialog").querySelector("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form!);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
