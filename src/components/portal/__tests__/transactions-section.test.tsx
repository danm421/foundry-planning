// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const listMock = vi.fn((_p: unknown): any => null);
vi.mock("@/components/portal/transactions-list", () => ({ default: (p: unknown) => { listMock(p); return null; } }));
import TransactionsSection from "@/components/portal/transactions-section";

describe("TransactionsSection", () => {
  it("renders heading and passes editEnabled=false when previewing", () => {
    render(<TransactionsSection clientId="c1" previewing />);
    expect(screen.getByText("Transactions")).toBeTruthy();
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ clientId: "c1", editEnabled: false }));
  });
});
