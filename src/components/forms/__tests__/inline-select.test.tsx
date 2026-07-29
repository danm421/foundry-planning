// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InlineSelect } from "../inline-select";

const OPTIONS = [
  { value: "client", label: "Cooper" },
  { value: "joint", label: "Joint" },
];

describe("InlineSelect", () => {
  it("renders the display text as a trigger button when editable", () => {
    render(
      <InlineSelect display="Cooper" value="client" options={OPTIONS}
        onSelect={vi.fn()} label="owner for Schwab" canEdit />,
    );
    expect(screen.getByRole("button", { name: "Change owner for Schwab" }))
      .toHaveTextContent("Cooper");
  });

  it("renders plain text with no button when canEdit is false", () => {
    render(
      <InlineSelect display="Cooper" value="client" options={OPTIONS}
        onSelect={vi.fn()} label="owner for Schwab" canEdit={false} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Cooper")).toBeInTheDocument();
  });

  it("opens a select whose accessible name capitalises the label", async () => {
    const user = userEvent.setup();
    render(
      <InlineSelect display="Cooper" value="client" options={OPTIONS}
        onSelect={vi.fn()} label="owner for Schwab" canEdit />,
    );
    await user.click(screen.getByRole("button"));
    expect(screen.getByRole("combobox", { name: "Owner for Schwab" })).toBeInTheDocument();
  });

  it("dispatches the picked value and closes", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <InlineSelect display="Cooper" value="client" options={OPTIONS}
        onSelect={onSelect} label="owner for Schwab" canEdit />,
    );
    await user.click(screen.getByRole("button"));
    await user.selectOptions(screen.getByRole("combobox"), "joint");
    expect(onSelect).toHaveBeenCalledWith("joint");
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });

  it("renders optgroups", async () => {
    const user = userEvent.setup();
    render(
      <InlineSelect display="Acme LLC" value="ent:e1" label="owner for Schwab" canEdit
        onSelect={vi.fn()}
        options={[
          { label: "Household", options: [{ value: "client", label: "Cooper" }] },
          { label: "Entity", options: [{ value: "ent:e1", label: "Acme LLC" }] },
        ]} />,
    );
    await user.click(screen.getByRole("button"));
    const groups = screen.getByRole("combobox").querySelectorAll("optgroup");
    expect([...groups].map((g) => g.label)).toEqual(["Household", "Entity"]);
  });

  it("stops propagation and prevents default so an enclosing Link does not navigate", async () => {
    const user = userEvent.setup();
    const ancestorClick = vi.fn();
    render(
      <div onClick={ancestorClick}>
        <InlineSelect display="Cooper" value="client" options={OPTIONS}
          onSelect={vi.fn()} label="owner for Schwab" canEdit />
      </div>,
    );
    await user.click(screen.getByRole("button"));
    expect(ancestorClick).not.toHaveBeenCalled();
  });

  it("closes without dispatching on blur", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <>
        <InlineSelect display="Cooper" value="client" options={OPTIONS}
          onSelect={onSelect} label="owner for Schwab" canEdit />
        <button type="button">elsewhere</button>
      </>,
    );
    await user.click(screen.getByRole("button", { name: "Change owner for Schwab" }));
    await user.click(screen.getByRole("button", { name: "elsewhere" }));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
});
