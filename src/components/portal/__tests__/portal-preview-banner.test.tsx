// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import PortalPreviewBanner from "../portal-preview-banner";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  push.mockClear();
});

describe("PortalPreviewBanner", () => {
  it("names the client and reflects the edit toggle", () => {
    const { getByText } = render(
      <PortalPreviewBanner clientId="c1" clientName="Pat Client" editEnabled={false} />,
    );
    expect(getByText("Pat Client")).toBeTruthy();
    expect(getByText("off")).toBeTruthy();
  });

  it("Close preview closes the tab", () => {
    const close = vi.spyOn(window, "close").mockImplementation(() => {});
    const { getByRole } = render(
      <PortalPreviewBanner clientId="c1" clientName="Pat Client" editEnabled />,
    );
    fireEvent.click(getByRole("button", { name: "Close preview" }));
    expect(close).toHaveBeenCalled();
  });

  it("falls back to the advisor portal tab when the window won't close", () => {
    vi.useFakeTimers();
    vi.spyOn(window, "close").mockImplementation(() => {});
    const { getByRole } = render(
      <PortalPreviewBanner clientId="c1" clientName="Pat Client" editEnabled />,
    );
    fireEvent.click(getByRole("button", { name: "Close preview" }));
    vi.runAllTimers();
    expect(push).toHaveBeenCalledWith("/clients/c1/portal");
  });
});
