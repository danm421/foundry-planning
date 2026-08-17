// @vitest-environment jsdom
//
// G6 — the grant editor's client-side validation. The editor is the only screen
// an advisor uses to enter equity, and until now it checked almost nothing: the
// numbers it accepted went straight into the projection.
//
// Each test types into the REAL editor and asserts on the "Save Grant" button,
// which the editor disables while `validateEditor` returns a message. Every
// test starts from a state where the button is genuinely ENABLED — otherwise a
// disabled button would make the assertion pass no matter what the rule does.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

import GrantsTab from "../grants-tab";

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ grants: [] }) });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const saveBtn = () => screen.getByRole("button", { name: /Save Grant/ }) as HTMLButtonElement;
const err = () => document.querySelector("p.text-amber-400")?.textContent ?? "";

function change(el: Element, value: string) {
  fireEvent.change(el, { target: { value } });
}

/** Open the Add-grant editor and fill in a valid single-row NQSO grant. */
async function openValidNqso() {
  render(<GrantsTab clientId="client-123" accountId="acct-so" scenarioActive={false} />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /\+ Add grant/ })); });

  const editor = screen.getByText("Add Grant").closest("div") as HTMLElement;
  const grantType = editor.querySelector("select") as HTMLSelectElement;
  await act(async () => { change(grantType, "nqso"); });

  const dates = () => Array.from(editor.querySelectorAll('input[type="date"]')) as HTMLInputElement[];
  await act(async () => { change(dates()[0], "2025-01-01"); });                 // grant date
  await act(async () => { change(dates()[1], "2035-01-01"); });                 // expiration
  await act(async () => { change(screen.getByPlaceholderText("e.g. 10000"), "1000"); });  // shares granted
  await act(async () => { change(screen.getByPlaceholderText("e.g. 15.00"), "10"); });    // strike

  // One vesting row that matches the shares granted.
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Add vest tranche/ })); });
  await act(async () => { change(rowDate(), "2028-01-01"); });
  await act(async () => { change(rowNum("shares"), "1000"); });

  return editor;
}

const rowDate = () => document.querySelector('table input[type="date"]') as HTMLInputElement;
function rowNum(which: "shares" | "exercised" | "sold"): HTMLInputElement {
  const nums = Array.from(document.querySelectorAll('table input[type="number"]')) as HTMLInputElement[];
  return { shares: nums[0], exercised: nums[1], sold: nums[2] }[which];
}

describe("Grant editor — a timing needs its companion field (F29/F40)", () => {
  /** The one `<select>` offering `value`. Throws if the option is gone, so a
   *  removed menu item fails loudly instead of quietly asserting nothing. */
  function selectOffering(value: string): HTMLSelectElement {
    const all = Array.from(document.querySelectorAll("select")) as HTMLSelectElement[];
    const found = all.filter((s) => Array.from(s.options).some((o) => o.value === value));
    if (found.length !== 1) throw new Error(`expected 1 <select> offering "${value}", found ${found.length}`);
    return found[0];
  }
  const timingSelects = () => ({
    exercise: selectOffering("year_before_expiration"),
    sell: selectOffering("hold_then_sell_year"),
  });

  it("refuses hold-then-sell with a blank year", async () => {
    await openValidNqso();
    expect(saveBtn()).toBeEnabled();

    await act(async () => { change(timingSelects().sell, "hold_then_sell_year"); });

    expect(saveBtn()).toBeDisabled();
    expect(err()).toMatch(/Sell year is required/i);

    await act(async () => { change(screen.getByPlaceholderText("e.g. 2030"), "2032"); });
    expect(saveBtn()).toBeEnabled();
  });

  it("refuses percent-per-year with a blank percentage", async () => {
    await openValidNqso();
    await act(async () => { change(timingSelects().sell, "percent_per_year"); });

    expect(saveBtn()).toBeDisabled();
    expect(err()).toMatch(/Sell % per year must be above zero/i);

    await act(async () => { change(screen.getByPlaceholderText("e.g. 25"), "25"); });
    expect(saveBtn()).toBeEnabled();
  });

  it("refuses a zero percentage, which is the same silence", async () => {
    await openValidNqso();
    await act(async () => { change(timingSelects().sell, "percent_per_year"); });
    await act(async () => { change(screen.getByPlaceholderText("e.g. 25"), "0"); });

    expect(saveBtn()).toBeDisabled();
  });

  it("refuses a specific exercise year with a blank year", async () => {
    await openValidNqso();
    await act(async () => { change(timingSelects().exercise, "specific_year"); });

    expect(saveBtn()).toBeDisabled();
    expect(err()).toMatch(/Exercise year is required/i);

    await act(async () => { change(screen.getByPlaceholderText("e.g. 2028"), "2030"); });
    expect(saveBtn()).toBeEnabled();
  });
});

describe("Grant editor — the rows must add up to the grant (F39/F34)", () => {
  it("refuses to save a grant with no vesting rows", async () => {
    await openValidNqso();
    expect(saveBtn()).toBeEnabled();

    // Remove the only row.
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Remove tranche/ })); });

    expect(saveBtn()).toBeDisabled();
    expect(err()).toMatch(/at least one vesting row/i);
  });

  it("refuses rows that do not sum to Shares Granted", async () => {
    await openValidNqso();
    expect(saveBtn()).toBeEnabled();

    // 1,000 granted, one 400-share row: the plan would vest 400 while the
    // report kept printing 1,000.
    await act(async () => { change(rowNum("shares"), "400"); });

    expect(saveBtn()).toBeDisabled();
    expect(err()).toMatch(/Vesting rows total 400 of 1,000 shares granted/i);
  });

  it("accepts rows that sum across several tranches", async () => {
    await openValidNqso();
    await act(async () => { change(rowNum("shares"), "600"); });
    expect(saveBtn()).toBeDisabled();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Add vest tranche/ })); });
    const dates = Array.from(document.querySelectorAll('table input[type="date"]')) as HTMLInputElement[];
    const nums = Array.from(document.querySelectorAll('table input[type="number"]')) as HTMLInputElement[];
    await act(async () => { change(dates[1], "2029-01-01"); });
    await act(async () => { change(nums[3], "400"); });

    expect(saveBtn()).toBeEnabled();
  });
});

describe("Grant editor — impossible share entries (F41)", () => {
  it("starts enabled on a valid grant, then refuses more exercised than the row holds", async () => {
    await openValidNqso();
    // The control that makes the rest of this test meaningful.
    expect(saveBtn()).toBeEnabled();

    await act(async () => { change(rowNum("exercised"), "10000"); });

    expect(saveBtn()).toBeDisabled();
    expect(err()).toMatch(/exercised shares cannot exceed the row's shares/i);
  });

  it("refuses more sold than exercised", async () => {
    await openValidNqso();
    await act(async () => { change(rowNum("exercised"), "100"); });
    expect(saveBtn()).toBeEnabled();

    await act(async () => { change(rowNum("sold"), "400"); });

    expect(saveBtn()).toBeDisabled();
    expect(err()).toMatch(/sold shares cannot exceed the exercised shares/i);
  });

  it("allows the ordinary part-exercised, part-sold row", async () => {
    await openValidNqso();
    await act(async () => { change(rowNum("exercised"), "400"); });
    await act(async () => { change(rowNum("sold"), "400"); });

    expect(saveBtn()).toBeEnabled();
    expect(err()).toBe("");
  });
});
