// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TemplatesPanel } from "../templates-panel";

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
      options: { range: "retirement", showCallout: true },
    },
  ],
});

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
      />,
    );
    fireEvent.click(
      screen.getByLabelText("More actions for Shared by other"),
    );
    expect(screen.queryByText("Delete")).not.toBeInTheDocument();
  });
});
