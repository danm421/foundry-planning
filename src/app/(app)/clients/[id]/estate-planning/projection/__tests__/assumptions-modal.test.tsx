// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PlanSettings } from "@/engine/types";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/clients/c1/estate-planning",
}));

import { AssumptionsModal } from "../assumptions-modal";

const FIXTURE: PlanSettings = {
  flatFederalRate: 0.24,
  flatStateRate: 0.05,
  inflationRate: 0.025,
  planStartYear: 2026,
  planEndYear: 2080,
  taxEngineMode: "flat",
  estateAdminExpenses: 50_000,
  flatStateEstateRate: 0,
};

describe("AssumptionsModal", () => {
  beforeEach(() => {
    refreshMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Save submits a PUT with the edited payload, then closes and refreshes", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();

    render(
      <AssumptionsModal open clientId="c1" planSettings={FIXTURE} onClose={onClose} />,
    );

    // Edit inflation rate from 0.025 -> 0.03
    const inflationInput = screen.getByLabelText("Inflation rate");
    await user.clear(inflationInput);
    await user.type(inflationInput, "0.03");

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/clients/c1/plan-settings");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body as string);
    expect(body.inflationRate).toBeCloseTo(0.03);
    // Other fields are also included since modal submits the full edited form.
    expect(body.flatFederalRate).toBeCloseTo(0.24);
    expect(body.planEndYear).toBe(2080);
    expect(body.taxEngineMode).toBe("flat");

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("Surfaces backend error message on non-OK response", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Plan start year cannot be before current year (2026)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onClose = vi.fn();

    render(
      <AssumptionsModal open clientId="c1" planSettings={FIXTURE} onClose={onClose} />,
    );

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/cannot be before current year/i),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
