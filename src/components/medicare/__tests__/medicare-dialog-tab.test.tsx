// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MedicareDialogTab } from "../medicare-dialog-tab";

describe("MedicareDialogTab estimate toggle", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })) as unknown as typeof fetch);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("starts with the estimate box checked and the prior-year MAGI field hidden", () => {
    render(<MedicareDialogTab clientId="c1" owner="client" existing={null} ownerDob="1958-01-01" onSaved={() => {}} />);
    expect(screen.getByLabelText(/estimate prior-year magi/i)).toBeChecked();
    expect(screen.queryByLabelText(/prior year magi/i)).not.toBeInTheDocument();
  });

  it("keeps a saved unchecked box unchecked and shows the MAGI field", () => {
    const existing = {
      owner: "client" as const, enrollmentYear: 2023, coverageType: "original" as const,
      medigapMonthlyAt65: 170, partDPlanMonthlyAt65: 46, priorYearMagi: 250000,
      estimatePriorYearMagiFromProjection: false,
    };
    render(<MedicareDialogTab clientId="c1" owner="client" existing={existing} onSaved={() => {}} />);
    expect(screen.getByLabelText(/estimate prior-year magi/i)).not.toBeChecked();
    expect(screen.getByLabelText(/prior year magi/i)).toHaveValue(250000);
  });

  it("sends the estimate flag in the save payload, true unless unchecked", async () => {
    render(<MedicareDialogTab clientId="c1" owner="client" existing={null} ownerDob="1958-01-01" onSaved={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).estimatePriorYearMagiFromProjection).toBe(true);

    await vi.waitFor(() => expect(screen.getByRole("button", { name: /save/i })).toBeEnabled());
    fireEvent.click(screen.getByLabelText(/estimate prior-year magi/i));
    expect(screen.getByLabelText(/prior year magi/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).estimatePriorYearMagiFromProjection).toBe(false);
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
