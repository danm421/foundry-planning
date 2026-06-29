// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MedicareDialogTab } from "../medicare-dialog-tab";

describe("MedicareDialogTab estimate toggle", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("hides the prior-year MAGI field when the estimate checkbox is checked", () => {
    render(<MedicareDialogTab clientId="c1" owner="client" existing={null} ownerDob="1958-01-01" onSaved={() => {}} />);
    expect(screen.getByLabelText(/prior year magi/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/estimate prior-year magi/i));
    expect(screen.queryByLabelText(/prior year magi/i)).not.toBeInTheDocument();
  });

  it("includes estimatePriorYearMagiFromProjection in the save payload", async () => {
    render(<MedicareDialogTab clientId="c1" owner="client" existing={null} ownerDob="1958-01-01" onSaved={() => {}} />);
    fireEvent.click(screen.getByLabelText(/estimate prior-year magi/i));
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const body = JSON.parse((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.estimatePriorYearMagiFromProjection).toBe(true);
  });

  it("renders default values when no existing coverage", () => {
    render(<MedicareDialogTab clientId="c1" owner="client" existing={null} onSaved={() => {}} />);
    expect(screen.getByLabelText(/enrollment year/i)).toHaveValue(null);
    expect(screen.getByLabelText(/coverage type/i)).toHaveValue("original");
    expect(screen.getByLabelText(/medigap monthly/i)).toHaveValue(170);
    expect(screen.getByLabelText(/part d monthly/i)).toHaveValue(46);
  });

  it("pre-fills enrollment year as DOB + 65 when ownerDob is provided", () => {
    render(
      <MedicareDialogTab
        clientId="c1"
        owner="client"
        existing={null}
        ownerDob="1960-04-12"
        onSaved={() => {}}
      />,
    );
    expect(screen.getByLabelText(/enrollment year/i)).toHaveValue(2025);
  });

  it("calls fetch on Save with the entered values", async () => {
    const onSaved = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<MedicareDialogTab clientId="c1" owner="client" existing={null} onSaved={onSaved} />);

    fireEvent.change(screen.getByLabelText(/enrollment year/i), { target: { value: 2030 } });
    fireEvent.change(screen.getByLabelText(/medigap monthly/i),  { target: { value: 200 } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, opts] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/clients/c1/medicare-coverage");
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.enrollmentYear).toBe(2030);
    expect(body.medigapMonthlyAt65).toBe(200);
  });
});
