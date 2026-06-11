// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TemplatesPanel } from "../templates-panel";
import type { LoadedTemplate } from "../use-launcher-state";

const t = (
  id: string,
  name: string,
  creator: string,
  visibility: "shared" | "private",
) => ({
  id,
  name,
  visibility,
  createdByUserId: creator,
  pages: [
    {
      pageId: "cashFlow" as const,
      options: { range: "full", showCallout: true },
    },
  ],
});

const defaultBuiltInProps = {
  builtIn: [] as LoadedTemplate[],
  builtInHidden: [] as LoadedTemplate[],
  onDismissBuiltin: vi.fn(),
  onRestoreBuiltin: vi.fn(),
};

describe("TemplatesPanel", () => {
  it("renders shared and private sections", () => {
    render(
      <TemplatesPanel
        shared={[t("s1", "Shared 1", "u1", "shared")]}
        mine={[t("p1", "Private 1", "me", "private")]}
        loadedTemplateId={null}
        currentUserId="me"
        onLoad={vi.fn()}
        onRename={vi.fn()}
        onChangeVisibility={vi.fn()}
        onDelete={vi.fn()}
        onSaveAsNew={vi.fn()}
        {...defaultBuiltInProps}
      />,
    );
    expect(screen.getByText("Shared 1")).toBeInTheDocument();
    expect(screen.getByText("Private 1")).toBeInTheDocument();
  });

  it("clicking a template name calls onLoad", () => {
    const onLoad = vi.fn();
    render(
      <TemplatesPanel
        shared={[t("s1", "Shared 1", "u1", "shared")]}
        mine={[]}
        loadedTemplateId={null}
        currentUserId="me"
        onLoad={onLoad}
        onRename={vi.fn()}
        onChangeVisibility={vi.fn()}
        onDelete={vi.fn()}
        onSaveAsNew={vi.fn()}
        {...defaultBuiltInProps}
      />,
    );
    fireEvent.click(screen.getByText("Shared 1"));
    expect(onLoad).toHaveBeenCalledWith("s1");
  });

  it("hides delete for templates the user didn't create", () => {
    render(
      <TemplatesPanel
        shared={[t("s1", "Shared by other", "other", "shared")]}
        mine={[]}
        loadedTemplateId={null}
        currentUserId="me"
        onLoad={vi.fn()}
        onRename={vi.fn()}
        onChangeVisibility={vi.fn()}
        onDelete={vi.fn()}
        onSaveAsNew={vi.fn()}
        {...defaultBuiltInProps}
      />,
    );
    fireEvent.click(
      screen.getByLabelText("More actions for Shared by other"),
    );
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });
});

const builtIn: LoadedTemplate[] = [
  { id: "builtin:foundation-plan", name: "Foundation Plan", visibility: "shared", createdByUserId: "system", builtIn: true, slug: "foundation-plan", pages: [] },
];
const hidden: LoadedTemplate[] = [
  { id: "builtin:cash-flow-details", name: "Cash Flow Details", visibility: "shared", createdByUserId: "system", builtIn: true, slug: "cash-flow-details", pages: [] },
];

function renderPanel(over: Partial<React.ComponentProps<typeof TemplatesPanel>> = {}) {
  const props = {
    shared: [], mine: [], builtIn, builtInHidden: hidden,
    loadedTemplateId: null, currentUserId: "user_test",
    onLoad: vi.fn(), onRename: vi.fn(), onChangeVisibility: vi.fn(),
    onDelete: vi.fn(), onDismissBuiltin: vi.fn(), onRestoreBuiltin: vi.fn(),
    onSaveAsNew: vi.fn(), ...over,
  };
  render(<TemplatesPanel {...props} />);
  return props;
}

describe("TemplatesPanel built-ins", () => {
  it("renders the Starter templates section with the visible built-in", () => {
    renderPanel();
    expect(screen.getByText("Starter templates")).toBeTruthy();
    expect(screen.getByText("Foundation Plan")).toBeTruthy();
  });

  it("Hide calls onDismissBuiltin with the slug", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByLabelText("More actions for Foundation Plan"));
    fireEvent.click(screen.getByText("Hide"));
    expect(props.onDismissBuiltin).toHaveBeenCalledWith("foundation-plan");
  });

  it("revealing hidden starters and clicking Restore calls onRestoreBuiltin", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByText(/1 hidden/));
    fireEvent.click(screen.getByText("Restore"));
    expect(props.onRestoreBuiltin).toHaveBeenCalledWith("cash-flow-details");
  });
});
