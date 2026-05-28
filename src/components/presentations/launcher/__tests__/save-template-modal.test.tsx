// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SaveTemplateModal } from "../save-template-modal";

describe("SaveTemplateModal", () => {
  it("calls onSave with name + visibility", () => {
    const onSave = vi.fn();
    render(
      <SaveTemplateModal
        open
        initialName=""
        onSave={onSave}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "New Template" },
    });
    fireEvent.click(screen.getByLabelText("Shared with firm"));
    fireEvent.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith({
      name: "New Template",
      visibility: "shared",
    });
  });

  it("disables Save when name is blank", () => {
    render(
      <SaveTemplateModal
        open
        initialName=""
        onSave={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText("Save")).toBeDisabled();
  });
});
