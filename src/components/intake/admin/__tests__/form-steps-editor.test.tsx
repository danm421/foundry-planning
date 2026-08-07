// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import FormStepsEditor from "../form-steps-editor";
import { DEFAULT_INTAKE_SECTIONS } from "@/lib/intake/sections";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

beforeEach(() => {
  mockRefresh.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => ({}) })) as never,
  );
});

const body = () => JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string);

describe("FormStepsEditor", () => {
  it("seeds from the saved default", () => {
    render(<FormStepsEditor initial={["family", "risk"]} />);
    expect(screen.getByRole("checkbox", { name: /^risk/i })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: /^goals$/i })).not.toBeChecked();
  });

  it("seeds from the system default when nothing is saved", () => {
    render(<FormStepsEditor initial={null} />);
    for (const key of DEFAULT_INTAKE_SECTIONS) {
      expect(screen.getByRole("checkbox", { name: new RegExp(`^${key}`, "i") })).toBeChecked();
    }
    expect(screen.getByRole("checkbox", { name: /^risk/i })).not.toBeChecked();
  });

  it("PUTs sections ALONE — never the email columns", async () => {
    // The settings route is a partial update. Sending the email fields from
    // here would let this card overwrite the other card with stale values.
    render(<FormStepsEditor initial={["family"]} />);
    fireEvent.click(screen.getByRole("button", { name: /save as my default/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(body()).toEqual({ sections: ["family"] });
  });

  it("saves what is on screen after a toggle", async () => {
    render(<FormStepsEditor initial={["family"]} />);
    fireEvent.click(screen.getByRole("checkbox", { name: /^documents$/i }));
    fireEvent.click(screen.getByRole("button", { name: /save as my default/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(body().sections).toEqual(["family", "documents"]);
  });

  it("Reset to default PUTs null, not a copy of today's default set", async () => {
    render(<FormStepsEditor initial={["family"]} />);
    fireEvent.click(screen.getByRole("button", { name: /reset to default/i }));

    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(body()).toEqual({ sections: null });
    expect(screen.getByRole("checkbox", { name: /^goals$/i })).toBeChecked();
  });

  it("surfaces a failed save instead of reporting success", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, json: async () => ({}) })) as never);
    render(<FormStepsEditor initial={["family"]} />);
    fireEvent.click(screen.getByRole("button", { name: /save as my default/i }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
