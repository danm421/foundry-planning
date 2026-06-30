// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";

import AddRelocationForm from "../add-relocation-form";

const refreshMock = vi.fn();
let searchParamsMock: URLSearchParams;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => searchParamsMock,
  usePathname: () => "/clients/client-123",
}));

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  refreshMock.mockReset();
  searchParamsMock = new URLSearchParams("");
  fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: "reloc-1" }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddRelocationForm — draft mode", () => {
  it("calls onSubmitDraft with a Relocation object, skips fetch, and closes the dialog", async () => {
    const onSubmitDraft = vi.fn();
    const onSaved = vi.fn();

    render(
      <AddRelocationForm
        clientId="client-123"
        onClose={() => {}}
        onSaved={onSaved}
        onSubmitDraft={onSubmitDraft}
      />,
    );

    // Form fields are pre-filled (default destination state + derived name +
    // next-year). Submit straight through the form element.
    fireEvent.submit(document.getElementById("relocation-form")!);

    await waitFor(() => expect(onSubmitDraft).toHaveBeenCalledTimes(1));

    const technique = onSubmitDraft.mock.calls[0][0];
    expect(typeof technique.id).toBe("string");
    expect(technique.id.length).toBeGreaterThan(0);
    expect(typeof technique.destinationState).toBe("string");
    expect(technique.name.length).toBeGreaterThan(0);

    // Draft mode must NOT persist via fetch.
    expect(fetchMock).not.toHaveBeenCalled();

    // onSaved must have been called to close the dialog.
    expect(onSaved).toHaveBeenCalledTimes(1);
  });
});
