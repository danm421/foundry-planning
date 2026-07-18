// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ToastProvider } from "../toast";
import { HouseholdStatusSelect } from "../household-status-select";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

function renderSelect() {
  return render(
    <ToastProvider>
      <HouseholdStatusSelect
        householdId="H1"
        householdName="Smith Household"
        status="prospect"
      />
    </ToastProvider>,
  );
}

describe("HouseholdStatusSelect", () => {
  beforeEach(() => {
    refresh.mockClear();
    vi.unstubAllGlobals();
  });

  it("renders the current status with all options", () => {
    vi.stubGlobal("fetch", vi.fn());
    renderSelect();
    const select = screen.getByRole("combobox", {
      name: "Status for Smith Household",
    }) as HTMLSelectElement;
    expect(select.value).toBe("prospect");
    const labels = screen.getAllByRole("option").map((o) => o.textContent);
    expect(labels).toEqual(["Prospect", "Active", "Inactive", "Archived"]);
  });

  it("PATCHes the household and refreshes on change", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    renderSelect();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "active" } });

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith("/api/crm/households/H1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "active" }),
    });
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("active");
  });

  it("reverts the value and shows a toast when the update fails", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Household not found" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSelect();

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "active" } });

    await screen.findByText("Household not found");
    expect((screen.getByRole("combobox") as HTMLSelectElement).value).toBe("prospect");
    expect(refresh).not.toHaveBeenCalled();
  });
});
