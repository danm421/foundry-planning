// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

import AdvisorGrantList from "../advisor-grant-list";

const ROWS = [
  { userId: "adv_1", displayName: "Pat Advisor", role: "Member", brandingEnabled: true },
  { userId: "adv_2", displayName: "Sam Advisor", role: "Member", brandingEnabled: false },
];

function stubFetch(ok: boolean) {
  const fetchMock = vi.fn().mockResolvedValue({ ok, status: ok ? 200 : 500 });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  mockRefresh.mockClear();
});

describe("AdvisorGrantList", () => {
  it("renders a placeholder when there are no other advisors", () => {
    render(<AdvisorGrantList rows={[]} />);
    expect(screen.getByText("No other advisors in this firm yet.")).toBeInTheDocument();
  });

  it("renders one row per advisor, defaulting an unenabled advisor's switch to off", () => {
    render(<AdvisorGrantList rows={ROWS} />);
    const onSwitch = screen.getByRole("switch", { name: "Allow custom branding for Pat Advisor" });
    const offSwitch = screen.getByRole("switch", { name: "Allow custom branding for Sam Advisor" });
    expect(onSwitch).toBeChecked();
    expect(offSwitch).not.toBeChecked();
  });

  it("links Edit brand to the admin querystring route for that advisor", () => {
    render(<AdvisorGrantList rows={ROWS} />);
    const links = screen.getAllByText("Edit brand");
    expect(links[0].closest("a")?.getAttribute("href")).toBe(
      "/settings/branding?advisorUserId=adv_1",
    );
  });

  it("PATCHes the enabled endpoint with only {enabled} and calls router.refresh() on success", async () => {
    const fetchMock = stubFetch(true);
    render(<AdvisorGrantList rows={ROWS} />);
    const offSwitch = screen.getByRole("switch", { name: "Allow custom branding for Sam Advisor" });

    fireEvent.click(offSwitch);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/advisor-branding/adv_2/enabled",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ enabled: true }),
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    expect(offSwitch).toBeChecked();
  });

  it("reverts the optimistic flip and shows an error when the PATCH fails", async () => {
    stubFetch(false);
    render(<AdvisorGrantList rows={ROWS} />);
    const onSwitch = screen.getByRole("switch", { name: "Allow custom branding for Pat Advisor" });

    fireEvent.click(onSwitch);
    expect(onSwitch).not.toBeChecked(); // optimistic flip applied immediately

    await waitFor(() => expect(screen.getByText("Couldn't save that change.")).toBeInTheDocument());
    expect(onSwitch).toBeChecked(); // reverted
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
