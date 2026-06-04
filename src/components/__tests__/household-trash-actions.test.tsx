// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HouseholdTrashActions } from "../household-trash-actions";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/toast", () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock("@/components/dialog-shell", () => ({ default: () => null }));

describe("HouseholdTrashActions menu", () => {
  it("shows Delete for a live household", async () => {
    render(<HouseholdTrashActions householdId="h1" householdName="Smith" deleted={false} />);
    await userEvent.click(screen.getByLabelText("Household actions"));
    expect(screen.getByText("Delete")).toBeTruthy();
    expect(screen.queryByText("Restore")).toBeNull();
  });

  it("shows Restore + Delete permanently for a trashed household", async () => {
    render(<HouseholdTrashActions householdId="h1" householdName="Smith" deleted />);
    await userEvent.click(screen.getByLabelText("Household actions"));
    expect(screen.getByText("Restore")).toBeTruthy();
    expect(screen.getByText("Delete permanently")).toBeTruthy();
  });
});
