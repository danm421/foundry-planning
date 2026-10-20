// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { PasswordManagerGuard } from "../password-manager-guard";

const IGNORED = {
  "data-1p-ignore": "",
  "data-lpignore": "true",
  "data-bwignore": "",
  "data-form-type": "other",
  "data-protonpass-ignore": "true",
};

function expectIgnored(el: Element) {
  for (const [name, value] of Object.entries(IGNORED)) {
    expect(el.getAttribute(name), name).toBe(value);
  }
}

function expectUntouched(el: Element) {
  for (const name of Object.keys(IGNORED)) {
    expect(el.hasAttribute(name), name).toBe(false);
  }
}

// MutationObserver callbacks run as a microtask after the DOM change.
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("PasswordManagerGuard", () => {
  it("marks fields already on the page when it mounts", () => {
    const { container } = render(
      <>
        <PasswordManagerGuard />
        <input aria-label="Amount" />
        <textarea aria-label="Notes" />
      </>,
    );
    expectIgnored(container.querySelector("input")!);
    expectIgnored(container.querySelector("textarea")!);
    expect(container.querySelector("input")!.getAttribute("autocomplete")).toBe("off");
  });

  it("marks fields that mount later, like a dialog's", async () => {
    render(<PasswordManagerGuard />);
    const dialog = document.createElement("div");
    dialog.innerHTML = `<form><input name="spouseRetirementAge" /><input type="password" /></form>`;
    document.body.appendChild(dialog);
    await flush();
    dialog.querySelectorAll("input").forEach(expectIgnored);
  });

  it("keeps a field's own autocomplete hint", () => {
    const { container } = render(
      <>
        <PasswordManagerGuard />
        <input autoComplete="postal-code" aria-label="Zip" />
      </>,
    );
    const input = container.querySelector("input")!;
    expectIgnored(input);
    expect(input.getAttribute("autocomplete")).toBe("postal-code");
  });

  it("leaves real login fields and Clerk's fields alone", async () => {
    render(<PasswordManagerGuard />);
    const box = document.createElement("div");
    box.innerHTML = `
      <input autocomplete="username" />
      <input type="password" autocomplete="current-password" />
      <input autocomplete="one-time-code" />
      <input class="cl-formFieldInput cl-input" name="emailAddress" />
      <input type="hidden" name="id" />`;
    document.body.appendChild(box);
    await flush();
    box.querySelectorAll("input").forEach(expectUntouched);
  });
});
