// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { runProjection } from "@/engine/projection";
import { buildClientData, baseClient, basePlanSettings } from "@/engine/__tests__/fixtures";
import { defaultLtcEvent } from "@/lib/ltc/default-ltc-event";
import { ltcEventName } from "@/lib/ltc/ltc-event-name";
import { LtcEventDialog } from "../ltc-event-dialog";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

const plan = buildClientData({
  client: { ...baseClient, lifeExpectancy: 95, spouseLifeExpectancy: 95 },
  planSettings: { ...basePlanSettings, planEndYear: 2067 },
});
const savedEvent = defaultLtcEvent(plan);

beforeEach(() => {
  fetchMock.mockReset();
  refresh.mockReset();
});
afterEach(cleanup);

function renderDialog(onDone = vi.fn()) {
  render(
    <LtcEventDialog
      clientId="c1"
      scenarioId="s1"
      event={savedEvent}
      tree={plan}
      projectionYears={runProjection(plan)}
      onDone={onDone}
    />,
  );
  return onDone;
}

describe("LtcEventDialog", () => {
  it("Save re-POSTs the whole event as an add, renamed, then closes", async () => {
    fetchMock.mockResolvedValue({ ok: true });
    const onDone = renderDialog();
    const years = screen.getByLabelText(/years of care/i);
    fireEvent.change(years, { target: { value: "4" } });
    fireEvent.blur(years);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/clients/c1/scenarios/s1/changes");
    const people = [{ ...savedEvent.people[0], years: 4 }];
    const next = { ...savedEvent, people };
    expect(JSON.parse(init.body)).toEqual({
      op: "add",
      targetKind: "ltc_event",
      entity: { ...next, name: ltcEventName(next, plan.client) },
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("Cancel closes without saving", () => {
    const onDone = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onDone).toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed save stays open and says so", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const onDone = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(onDone).not.toHaveBeenCalled();
  });
});
