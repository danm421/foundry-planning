// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SettingsForm from "../settings-form";
import { mergePrefs } from "@/lib/notifications/prefs";
import { NOTIFICATION_CATEGORIES, CATEGORY_LABELS } from "@/lib/notifications/catalog";

vi.mock("@/app/(app)/alerts/actions", () => ({ savePreferencesAction: vi.fn() }));

// Every checkbox's accessible name is "<category label> in app" / "<category
// label> email" — the row name alone is ambiguous now that both channels are
// labelled, so the queries below always name the channel too.
const RISK_IN_APP = [
  "Risk level changed in app",
  "Plan demands more growth than capacity allows in app",
  "Suitability review due in app",
];

describe("SettingsForm", () => {
  it("renders every category in the catalog, both channels", () => {
    render(<SettingsForm prefs={mergePrefs({})} cadence="weekly" />);
    for (const c of NOTIFICATION_CATEGORIES) {
      expect(screen.getByLabelText(`${CATEGORY_LABELS[c]} in app`)).toBeInTheDocument();
      expect(screen.getByLabelText(`${CATEGORY_LABELS[c]} email`)).toBeInTheDocument();
    }
  });

  it("names each checkbox the way parseSettingsPayload reads it", () => {
    render(<SettingsForm prefs={mergePrefs({})} cadence="weekly" />);
    expect(screen.getByLabelText("Client birthdays in app")).toHaveAttribute(
      "name",
      "inApp:client_birthday",
    );
    expect(screen.getByLabelText("Client birthdays email")).toHaveAttribute(
      "name",
      "email:client_birthday",
    );
    // The master drives its children and must NOT post a field of its own —
    // the parser keys off the catalog and would never read it anyway.
    expect(screen.getByLabelText("All Risk in app")).not.toHaveAttribute("name");
  });

  it("shows the group master as on only when EVERY child is on", () => {
    render(
      <SettingsForm
        prefs={mergePrefs({ risk_level_changed: { inApp: false, email: true } })}
        cadence="weekly"
      />,
    );
    // Two of Risk's three children are on in-app, one is off. A master built on
    // `.some` instead of `.every` reads as ON here; `.every` reads OFF.
    expect(screen.getByLabelText("All Risk in app")).not.toBeChecked();
    // Mirror image on the other channel: one of three is ON for email, so
    // `.some` reads ON and `.every` reads OFF.
    expect(screen.getByLabelText("All Risk email")).not.toBeChecked();
    // An untouched group keeps the shipped defaults, so its in-app master is on
    // — that is what fails a master hardcoded to false.
    expect(screen.getByLabelText("All Dates in app")).toBeChecked();
    expect(screen.getByLabelText("All Dates email")).not.toBeChecked();
  });

  it("turns a whole group off in one click", async () => {
    const user = userEvent.setup();
    render(<SettingsForm prefs={mergePrefs({})} cadence="weekly" />);
    await user.click(screen.getByLabelText("All Risk in app"));
    // All THREE children, not just the first — a loop that writes only
    // `categories[0]` reddens on the others.
    for (const label of RISK_IN_APP) {
      expect(screen.getByLabelText(label)).not.toBeChecked();
    }
    expect(screen.getByLabelText("All Risk in app")).not.toBeChecked();
  });

  it("turns a whole group on without touching the other channel", async () => {
    const user = userEvent.setup();
    // One Risk child starts with in-app OFF while the rest of the column is on.
    // That asymmetry is the whole point: with the shipped defaults both
    // channels agree in the direction a cascade writes, so a toggleGroup that
    // ignored its `channel` and wrote BOTH would still pass. Here it flips this
    // child's in-app back on and reddens.
    render(
      <SettingsForm
        prefs={mergePrefs({ risk_level_changed: { inApp: false } })}
        cadence="weekly"
      />,
    );
    // Email ships off everywhere, so this click is an off -> on cascade.
    await user.click(screen.getByLabelText("All Risk email"));
    expect(screen.getByLabelText("Risk level changed email")).toBeChecked();
    expect(screen.getByLabelText("Suitability review due email")).toBeChecked();
    expect(screen.getByLabelText("Risk level changed in app")).not.toBeChecked();
  });

  it("clears the master when a single child is unchecked", async () => {
    const user = userEvent.setup();
    render(<SettingsForm prefs={mergePrefs({})} cadence="weekly" />);
    await user.click(screen.getByLabelText("Risk level changed in app"));
    expect(screen.getByLabelText("All Risk in app")).not.toBeChecked();
    // ...and only that child moved — a setOne that wrote the whole group reddens.
    expect(screen.getByLabelText("Suitability review due in app")).toBeChecked();
  });

  it("leaves other groups alone", async () => {
    const user = userEvent.setup();
    render(<SettingsForm prefs={mergePrefs({})} cadence="weekly" />);
    await user.click(screen.getByLabelText("All Risk in app"));
    expect(screen.getByLabelText("All Dates in app")).toBeChecked();
    expect(screen.getByLabelText("Client birthdays in app")).toBeChecked();
  });

  it("offers the cadence selector once, inside the Dates group", () => {
    render(<SettingsForm prefs={mergePrefs({})} cadence="monthly" />);
    const select = screen.getByRole("combobox");
    expect(select).toHaveValue("monthly");
    expect(select).toHaveAttribute("name", "dateDigestCadence");
    // A count of one does not say WHERE it is; bind it to the Dates section so
    // a selector hung off the wrong group reddens.
    const dates = screen.getByRole("heading", { name: "Dates" }).closest("section");
    expect(dates).toContainElement(select);
  });
});
