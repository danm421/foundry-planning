// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { WidgetChrome } from "../widget-chrome";

const baseProps = {
  instanceId: "11111111-1111-4111-8111-111111111111",
  title: "Portfolio Assets",
  kind: "portfolio" as const,
  hidden: false,
  collapsed: false,
  markdownBody: undefined,
  onToggleHidden: vi.fn(),
  onToggleCollapsed: vi.fn(),
  onMarkdownChange: vi.fn(),
};

describe("WidgetChrome", () => {
  it("renders title + drag handle + hide + collapse", () => {
    const { getByLabelText, getByText } = render(
      <WidgetChrome {...baseProps}>
        <div>body</div>
      </WidgetChrome>,
    );
    expect(getByText("Portfolio Assets")).toBeTruthy();
    expect(getByLabelText("Drag to reorder")).toBeTruthy();
    expect(getByLabelText("Hide widget")).toBeTruthy();
    expect(getByLabelText("Collapse widget")).toBeTruthy();
  });

  it("calls onToggleHidden when hide clicked", () => {
    const onToggleHidden = vi.fn();
    const { getByLabelText } = render(
      <WidgetChrome {...baseProps} onToggleHidden={onToggleHidden}>
        <div>body</div>
      </WidgetChrome>,
    );
    fireEvent.click(getByLabelText("Hide widget"));
    expect(onToggleHidden).toHaveBeenCalledWith("11111111-1111-4111-8111-111111111111");
  });

  it("renders as hidden row when hidden=true", () => {
    const { getByLabelText, queryByText } = render(
      <WidgetChrome {...baseProps} hidden>
        <div>BODY</div>
      </WidgetChrome>,
    );
    expect(queryByText("BODY")).toBeNull();
    expect(getByLabelText("Show widget")).toBeTruthy();
  });

  it("renders textarea + read body for text kind", () => {
    const onMarkdownChange = vi.fn();
    const { getByRole } = render(
      <WidgetChrome
        {...baseProps}
        kind="text"
        title="Text block"
        markdownBody="Hello"
        onMarkdownChange={onMarkdownChange}
      >
        <div>body</div>
      </WidgetChrome>,
    );
    const ta = getByRole("textbox") as HTMLTextAreaElement;
    expect(ta.value).toBe("Hello");
    fireEvent.change(ta, { target: { value: "World" } });
    expect(onMarkdownChange).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      "World",
    );
  });
});
