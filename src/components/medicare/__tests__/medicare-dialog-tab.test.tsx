// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MedicareDialogTab } from "../medicare-dialog-tab";

describe("MedicareDialogTab", () => {
  it("renders default values when no existing coverage", () => {
    render(<MedicareDialogTab clientId="c1" owner="client" existing={null} onSaved={() => {}} />);
    expect(screen.getByLabelText(/enrollment year/i)).toHaveValue(null);
    expect(screen.getByLabelText(/coverage type/i)).toHaveValue("original");
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
