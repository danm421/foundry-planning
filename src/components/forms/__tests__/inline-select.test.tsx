// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  // Supplementary coverage (review finding on Task 4): the brief's 7 tests
  // above never discriminate `preventDefault`, and never click the open
  // <select> at all — see task-4-report.md for the mutation evidence that
  // motivated these. `fireEvent.click()` returns the result of
  // `dispatchEvent`, which is `false` when a handler called
  // `preventDefault()` on the (cancelable) click event — that's the
  // discriminator used below, since jsdom has no real navigation to observe.

  it("prevents default on the trigger button click", () => {
    render(
      <InlineSelect display="Cooper" value="client" options={OPTIONS}
        onSelect={vi.fn()} label="owner for Schwab" canEdit />,
    );
    const trigger = screen.getByRole("button", { name: "Change owner for Schwab" });
    expect(fireEvent.click(trigger)).toBe(false);
  });

  it("prevents default on the open select's click", async () => {
    const user = userEvent.setup();
    render(
      <InlineSelect display="Cooper" value="client" options={OPTIONS}
        onSelect={vi.fn()} label="owner for Schwab" canEdit />,
    );
    await user.click(screen.getByRole("button"));
    const combobox = screen.getByRole("combobox");
    expect(fireEvent.click(combobox)).toBe(false);
  });

  it("stops propagation on the open select's click so an enclosing Link does not navigate", async () => {
    const user = userEvent.setup();
    const ancestorClick = vi.fn();
    render(
      <div onClick={ancestorClick}>
        <InlineSelect display="Cooper" value="client" options={OPTIONS}
          onSelect={vi.fn()} label="owner for Schwab" canEdit />
      </div>,
    );
    await user.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("combobox"));
    expect(ancestorClick).not.toHaveBeenCalled();
  });
});
