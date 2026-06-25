// @vitest-environment jsdom
import { it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: refreshMock }) }));
const portalFetchMock = vi.fn();
vi.mock("@/components/portal/portal-mode-context", () => ({
  usePortalFetch: () => portalFetchMock,
}));

import { BudgetAmountInput } from "@/components/portal/budget-amount-input";

beforeEach(() => {
  refreshMock.mockReset();
  portalFetchMock.mockReset();
  portalFetchMock.mockResolvedValue({ ok: true });
});

it("PUTs the parsed amount on blur and refreshes", async () => {
  render(<BudgetAmountInput categoryId="l-groceries" value={null} label="Groceries" />);
  const input = screen.getByLabelText("Budget for Groceries") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "750" } });
  fireEvent.blur(input);
  await waitFor(() => {
    const put = portalFetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(JSON.parse(put![1].body)).toEqual({ categoryId: "l-groceries", monthlyAmount: 750 });
  });
  await waitFor(() => expect(refreshMock).toHaveBeenCalled());
});

it("clears the budget (null) when emptied", async () => {
  render(<BudgetAmountInput categoryId="l-groceries" value={400} label="Groceries" />);
  const input = screen.getByLabelText("Budget for Groceries") as HTMLInputElement;
  expect(input.value).toBe("400");
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.blur(input);
  await waitFor(() => {
    const put = portalFetchMock.mock.calls.find((c) => c[1]?.method === "PUT");
    expect(JSON.parse(put![1].body)).toEqual({ categoryId: "l-groceries", monthlyAmount: null });
  });
});

it("does not PUT when the value is unchanged", async () => {
  render(<BudgetAmountInput categoryId="l-groceries" value={400} label="Groceries" />);
  fireEvent.blur(screen.getByLabelText("Budget for Groceries"));
  await new Promise((r) => setTimeout(r, 0));
  expect(portalFetchMock).not.toHaveBeenCalled();
});

it("Escape reverts the draft without saving", async () => {
  render(<BudgetAmountInput categoryId="l-groceries" value={400} label="Groceries" />);
  const input = screen.getByLabelText("Budget for Groceries") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "999" } });
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input.value).toBe("400");
  await new Promise((r) => setTimeout(r, 0));
  expect(portalFetchMock).not.toHaveBeenCalled();
});

it("re-syncs the input when the value prop changes after a refresh", () => {
  const { rerender } = render(
    <BudgetAmountInput categoryId="l-groceries" value={400} label="Groceries" />,
  );
  expect((screen.getByLabelText("Budget for Groceries") as HTMLInputElement).value).toBe("400");
  rerender(<BudgetAmountInput categoryId="l-groceries" value={550} label="Groceries" />);
  expect((screen.getByLabelText("Budget for Groceries") as HTMLInputElement).value).toBe("550");
});
