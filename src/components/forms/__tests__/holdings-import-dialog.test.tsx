// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";

vi.mock("@/lib/investments/holdings-client", () => ({
  readHoldingsSpreadsheet: vi.fn(),
  readHoldingsStatement: vi.fn(),
  importHoldings: vi.fn(),
}));

import { HoldingsImportDialog } from "../holdings-import-dialog";
import {
  importHoldings,
  readHoldingsSpreadsheet,
  readHoldingsStatement,
} from "@/lib/investments/holdings-client";
import { HOLDINGS_IMPORT_HEADER_ROW } from "@/lib/investments/holdings-import";

function renderDialog(existingCount = 0) {
  const onImported = vi.fn();
  const onClose = vi.fn();
  const view = render(
    <HoldingsImportDialog
      clientId="client-1"
      accountId="acct-1"
      existingCount={existingCount}
      onImported={onImported}
      onClose={onClose}
    />,
  );
  return { ...view, onImported, onClose };
}

/** Pick a file through the dialog's hidden input. */
function chooseFile(container: HTMLElement, name = "holdings.csv") {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], name)] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(importHoldings).mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllGlobals());

describe("HoldingsImportDialog", () => {
  it("copies the tab-separated header row", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Copy headers" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(HOLDINGS_IMPORT_HEADER_ROW));
    expect(await screen.findByText(/Copied/)).toBeTruthy();
  });

  it("reviews a spreadsheet's positions, lets one be left out, and imports the rest", async () => {
    vi.mocked(readHoldingsSpreadsheet).mockResolvedValue({
      holdings: [
        { ticker: "VTI", shares: 10, price: 300, marketValue: 3000 },
        { ticker: "BND", shares: 5, price: 70 },
      ],
      warnings: ["Row 4 (XYZ): no shares or market value — skipped."],
    });
    const { container, onImported } = renderDialog();

    chooseFile(container);

    expect(await screen.findByText("Row 4 (XYZ): no shares or market value — skipped.")).toBeTruthy();
    expect(screen.getByText("$3,350")).toBeTruthy(); // 3,000 + 5 × 70
    fireEvent.click(screen.getByRole("button", { name: "Leave out BND" }));
    fireEvent.click(screen.getByRole("button", { name: "Import 1 holding" }));

    await waitFor(() => expect(onImported).toHaveBeenCalled());
    expect(importHoldings).toHaveBeenCalledWith("client-1", "acct-1", {
      source: "spreadsheet",
      mode: "replace",
      holdings: [{ ticker: "VTI", shares: 10, price: 300, marketValue: 3000 }],
    });
  });

  it("asks replace-or-add when the account already has holdings", async () => {
    vi.mocked(readHoldingsSpreadsheet).mockResolvedValue({ holdings: [{ ticker: "VTI", shares: 1 }], warnings: [] });
    const { container } = renderDialog(3);

    chooseFile(container);
    fireEvent.click(await screen.findByLabelText("Add these alongside them"));
    fireEvent.click(screen.getByRole("button", { name: "Import 1 holding" }));

    await waitFor(() =>
      expect(importHoldings).toHaveBeenCalledWith("client-1", "acct-1", expect.objectContaining({ mode: "append" })),
    );
    expect(screen.getByText("This account already has 3 holdings.")).toBeTruthy();
  });

  it("stays on the upload step and says so when a file holds no positions", async () => {
    vi.mocked(readHoldingsSpreadsheet).mockResolvedValue({ holdings: [], warnings: [] });
    const { container } = renderDialog();

    chooseFile(container);

    expect((await screen.findByRole("alert")).textContent).toBe("No positions were found in that file.");
    expect(screen.getByRole("button", { name: "Choose spreadsheet" })).toBeTruthy();
  });

  it("lists a statement's accounts when none matches this one, and Back returns to the list", async () => {
    vi.mocked(readHoldingsStatement).mockResolvedValue({
      accounts: [
        { name: "Joint", last4: "1111", holdings: [{ ticker: "AAPL", shares: 1, marketValue: 190 }] },
        { name: "IRA", last4: "2222", holdings: [{ ticker: "VTI", shares: 2, marketValue: 600 }] },
      ],
      matchIndex: null,
      warnings: [],
    });
    const { container } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Statement" }));
    chooseFile(container, "statement.pdf");
    const list = await screen.findByRole("list");
    fireEvent.click(within(list).getByText("IRA"));

    expect(await screen.findByRole("button", { name: "Import 1 holding" })).toBeTruthy();
    expect(screen.getByText("VTI")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText(/That statement holds 2 accounts/)).toBeTruthy();
  });

  it("goes straight to the statement account whose last 4 match", async () => {
    vi.mocked(readHoldingsStatement).mockResolvedValue({
      accounts: [
        { name: "Joint", last4: "1111", holdings: [{ ticker: "AAPL", shares: 1 }] },
        { name: "IRA", last4: "2222", holdings: [{ ticker: "VTI", shares: 2 }] },
      ],
      matchIndex: 1,
      warnings: [],
    });
    const { container } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Statement" }));
    chooseFile(container, "statement.pdf");

    expect(await screen.findByText("VTI")).toBeTruthy();
    expect(screen.queryByText("AAPL")).toBeNull();
  });

  it("says plainly when the firm has no AI features", async () => {
    vi.mocked(readHoldingsStatement).mockRejectedValue(new Error("ai_import_not_entitled"));
    const { container } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "Statement" }));
    chooseFile(container, "statement.pdf");

    expect((await screen.findByRole("alert")).textContent).toBe("AI features aren't enabled for this firm.");
  });
});
