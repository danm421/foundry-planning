// @vitest-environment jsdom
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

import { CrmImportWizard } from "../crm-import-wizard";

// The grid the preview endpoint hands back, echoed by the wizard on every
// remap. Two columns so the mapping picker has something to re-point.
const UPLOADED = {
  header: ["First Name", "Last Name"],
  dataRows: [["Jane", "Smith"]],
};

function previewResult() {
  return {
    rows: [
      {
        rowIndex: 0,
        household: { name: "Jane Smith", nameIsCustom: false, status: "prospect" },
        primary: { role: "primary", firstName: "Jane", lastName: "Smith" },
        errors: [],
        warnings: [],
      },
    ],
    duplicates: [],
    partialDedupCorpus: false,
    truncated: false,
  };
}

function res(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/**
 * jsdom's `new FormData(form)` reads a file input's file list off the internal
 * impl object, but RTL/user-event set `files` on the JS wrapper — so the real
 * File never reaches `data.get("file")` and the wizard bails with "Choose a CSV
 * file first." before it ever fetches. Shim the two methods the wizard uses.
 * fetch is stubbed, so the body this produces is never serialized.
 */
class FormDataShim {
  private entries = new Map<string, unknown>();
  constructor(form?: HTMLFormElement) {
    for (const el of Array.from(form?.elements ?? [])) {
      const input = el as HTMLInputElement;
      if (!input.name) continue;
      this.entries.set(input.name, input.type === "file" ? input.files?.[0] : input.value);
    }
  }
  get(name: string) {
    return this.entries.get(name) ?? null;
  }
  append(name: string, value: unknown) {
    this.entries.set(name, value);
  }
}

/** Swapped per test so the second (remap) call can fail on demand. */
let remapResponse: () => unknown;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  remapResponse = () => res(200, { preview: previewResult() });
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/preview")) {
      return res(200, {
        file: UPLOADED,
        mapping: { primaryFirst: 0, primaryLast: 1 },
        preview: previewResult(),
      });
    }
    if (u.includes("/remap")) return remapResponse();
    if (u.includes("/commit")) return res(200, { created: 1, skipped: 0 });
    throw new Error(`unexpected fetch: ${u}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("FormData", FormDataShim);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function commitButton() {
  return screen.getByRole("button", { name: /commit import/i });
}

/** Upload a file and land on the Review step with a healthy preview. */
async function reachReview() {
  const user = userEvent.setup();
  render(<CrmImportWizard />);
  const input = screen.getByLabelText(/csv file/i) as HTMLInputElement;
  await user.upload(
    input,
    new File(["First Name,Last Name\nJane,Smith\n"], "clients.csv", { type: "text/csv" }),
  );
  fireEvent.submit(input.closest("form")!);
  await screen.findByRole("button", { name: /commit import/i });
}

/** Re-point a non-required field, which fires a remap. */
function remapBySettingCity(column: string) {
  fireEvent.change(screen.getByLabelText(/^city$/i), { target: { value: column } });
}

describe("CrmImportWizard — a failed remap must not leave a committable stale preview", () => {
  it("disables Commit after a remap fails", async () => {
    await reachReview();
    expect(commitButton()).toBeEnabled();

    remapResponse = () => res(500, { error: "Could not rebuild the preview. Please try again." });
    remapBySettingCity("1");

    // The alert and the disabled state land in the same render as
    // setRefreshing(false), so asserting once the alert is on screen pins the
    // SETTLED state — not the transient `refreshing` disable, which would make
    // this pass with the stale-preview guard removed.
    await screen.findByRole("alert");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(commitButton()).toBeDisabled();
  });

  it("re-enables Commit once a later remap succeeds", async () => {
    await reachReview();

    remapResponse = () => res(500, { error: "boom" });
    remapBySettingCity("1");
    await screen.findByRole("alert");
    expect(commitButton()).toBeDisabled();

    remapResponse = () => res(200, { preview: previewResult() });
    remapBySettingCity("0");
    // Can only go true once BOTH the stale flag and `refreshing` have cleared,
    // so it also proves the previous test's disable wasn't permanent.
    await waitFor(() => expect(commitButton()).toBeEnabled());
  });

  it("shows the remap endpoint's own error message, not a bare status", async () => {
    await reachReview();
    remapResponse = () => res(400, { error: "Import preview rate limit exceeded" });
    remapBySettingCity("1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Import preview rate limit exceeded",
    );
  });

  it("falls back to the status code when the remap error body isn't a string", async () => {
    await reachReview();
    // The remap route's 400 path returns a zod `flatten()` object, not a string.
    remapResponse = () => res(400, { error: { formErrors: [], fieldErrors: {} } });
    remapBySettingCity("1");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      /could not rebuild the preview \(400\)/i,
    );
  });
});
