// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ClientAccessProvider } from "@/components/client-access-provider";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh, replace: vi.fn() }),
  usePathname: () => "/clients/c1/details/assumptions",
  useSearchParams: () => new URLSearchParams(""),
}));

import { PlanStartYearSwitch } from "../plan-start-year-switch";

type Props = React.ComponentProps<typeof PlanStartYearSwitch>;
function renderSwitch(over: Partial<Props> = {}, permission: "view" | "edit" = "edit") {
  return render(
    <ClientAccessProvider value={{ permission, access: "own" }}>
      <PlanStartYearSwitch clientId="c1" startsNextYear={false} thisYear={2026} inScenario={false} alreadyDone={[]} {...over} />
    </ClientAccessProvider>,
  );
}
const theSwitch = () => screen.getByRole("switch", { name: "Start the plan next year" }) as HTMLInputElement;

beforeEach(() => {
  refresh.mockReset();
  global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })) as unknown as typeof fetch;
});

describe("PlanStartYearSwitch", () => {
  it("reads off when the plan starts this year, on when it starts next year", () => {
    const { unmount } = renderSwitch();
    expect(theSwitch().checked).toBe(false);
    expect(screen.getByText("January 1, 2026")).toBeInTheDocument();
    unmount();
    renderSwitch({ startsNextYear: true });
    expect(theSwitch().checked).toBe(true);
    expect(screen.getByText("January 1, 2027")).toBeInTheDocument();
  });

  it("turning it on saves next year", async () => {
    renderSwitch();
    fireEvent.click(theSwitch());
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    const [url, init] = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/clients/c1/plan-settings");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(init.body as string)).toEqual({ planStartYear: 2027 });
    expect(theSwitch().checked).toBe(true);
  });

  it("reverts and shows the server message when the save fails", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false, status: 400, json: async () => ({ error: "Plan start year must be 2027 or 2028" }),
    })) as unknown as typeof fetch;
    renderSwitch();
    fireEvent.click(theSwitch());
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Plan start year must be 2027 or 2028"));
    expect(theSwitch().checked).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("is disabled without edit permission", () => {
    renderSwitch({}, "view");
    expect(theSwitch()).toBeDisabled();
    fireEvent.click(theSwitch());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("notes that it covers every scenario", () => {
    renderSwitch({ inScenario: true });
    expect(screen.getByText("Applies to the base plan and every scenario.")).toBeInTheDocument();
  });

  it("lists this year's items when on", () => {
    renderSwitch({
      startsNextYear: true,
      alreadyDone: [{ kind: "asset_sale", label: "Sell the rental", year: 2026 }],
    });
    expect(
      screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Dated 2026: counted as already done"),
    ).toBeInTheDocument();
    expect(screen.getByText("Sell the rental")).toBeInTheDocument();
  });
});
