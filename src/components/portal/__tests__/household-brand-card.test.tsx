// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import HouseholdBrandCard from "../household-brand-card";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const CHOICES = [
  { value: "firm", label: "Acme Wealth (firm)" },
  { value: "user_jane", label: "Smith Wealth" },
];

describe("HouseholdBrandCard", () => {
  beforeEach(() => refresh.mockClear());

  it("shows the household's brand and saves a new pick", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) }));
    render(<HouseholdBrandCard clientId="c1" choices={CHOICES} initialValue="user_jane" />);

    const select = screen.getByLabelText("Brand") as HTMLSelectElement;
    expect(select.value).toBe("user_jane");
    expect(screen.getByText("The portal and new sends start on this brand.")).toBeInTheDocument();

    fireEvent.change(select, { target: { value: "firm" } });

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/clients/c1/brand", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ brand: "firm" }),
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });

  it("puts the old brand back and says why when the save is refused", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "That brand isn't available to you for this household." }),
    }));
    render(<HouseholdBrandCard clientId="c1" choices={CHOICES} initialValue="user_jane" />);

    fireEvent.change(screen.getByLabelText("Brand"), { target: { value: "firm" } });

    expect(await screen.findByRole("alert")).toHaveTextContent("That brand isn't available to you for this household.");
    expect((screen.getByLabelText("Brand") as HTMLSelectElement).value).toBe("user_jane");
    expect(refresh).not.toHaveBeenCalled();
  });
});
