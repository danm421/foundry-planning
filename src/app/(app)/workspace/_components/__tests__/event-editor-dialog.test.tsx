// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EventEditorDialog } from "../event-editor-dialog";

type FakeResponse = {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
};
const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<FakeResponse>>();

const BLANK = {
  subject: "",
  start: "2026-10-28T09:00",
  end: "2026-10-28T09:30",
  attendees: [],
  meetingUrl: null,
};

const MS = { id: "ms-1", provider: "microsoft" as const, label: "hartwell" };
const GOOGLE = { id: "g-1", provider: "google" as const, label: "gmail" };

const REVIEW = {
  subject: "Annual review",
  start: "2026-10-27T10:00",
  end: "2026-10-27T11:30",
  attendees: ["pat@example.com"],
  meetingUrl: "https://teams.microsoft.com/l/meetup-join/abc",
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ suggestions: [] }),
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const save = () => screen.getByRole("button", { name: "Save" });

describe("EventEditorDialog — create", () => {
  it("submits the subject, the times, the attendees and the Teams choice", async () => {
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <EventEditorDialog mode="create" accounts={[MS]} initial={BLANK} onSave={onSave} onClose={() => {}} />,
    );

    await user.type(screen.getByLabelText("Subject"), "Plan review");
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "14:00" },
    });
    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "14:30" },
    });
    await user.type(screen.getByLabelText("Attendees"), "pat@example.com{Enter}");
    await user.click(screen.getByLabelText("Add a Teams link"));
    await user.click(save());

    expect(onSave).toHaveBeenCalledWith({
      connectionId: "ms-1",
      subject: "Plan review",
      start: "2026-10-28T14:00",
      end: "2026-10-28T14:30",
      attendees: ["pat@example.com"],
      video: true,
    });
  });

  it("an end time before the start disables Save and says why", () => {
    render(
      <EventEditorDialog
        mode="create"
        initial={{ ...BLANK, subject: "Call" }}
        onSave={vi.fn()}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "08:00" },
    });
    expect(screen.getByText("End time must be after the start time.")).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it("moving the start keeps the meeting's length", () => {
    render(
      <EventEditorDialog
        mode="create"
        initial={{ ...BLANK, subject: "Call" }}
        onSave={vi.fn()}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "15:00" },
    });
    expect(screen.getByLabelText("End")).toHaveValue("15:30");
    expect(save()).toBeEnabled();
  });

  it("an end at midnight is the end of the day, not its start", async () => {
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <EventEditorDialog
        mode="create"
        initial={{ ...BLANK, subject: "Late" }}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "23:00" },
    });
    fireEvent.change(screen.getByLabelText("End"), {
      target: { value: "00:00" },
    });
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        start: "2026-10-28T23:00",
        end: "2026-10-29T00:00",
      }),
    );
  });

  it("Enter adds only a typed email, once however it's cased", async () => {
    const user = userEvent.setup();
    render(<EventEditorDialog mode="create" initial={BLANK} onSave={vi.fn()} onClose={() => {}} />);
    const input = screen.getByLabelText("Attendees");
    await user.type(input, "not-an-email{Enter}");
    expect(screen.queryByRole("list", { name: "Invited" })).toBeNull();
    await user.clear(input);
    await user.type(input, "pat@example.com{Enter}");
    await user.type(input, "PAT@Example.com{Enter}");
    const chips = within(screen.getByRole("list", { name: "Invited" })).getAllByRole("listitem");
    expect(chips.map((c) => c.textContent)).toEqual(["pat@example.com"]);

    await user.click(screen.getByRole("button", { name: "Remove pat@example.com" }));
    expect(screen.queryByRole("list", { name: "Invited" })).toBeNull();
  });

  it("typing 'pa' asks for suggestions after the pause, and clicking one adds its chip", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        suggestions: [{ email: "pat@example.com", name: "Pat Hartley", kind: "client" }],
      }),
    });
    const user = userEvent.setup();
    render(<EventEditorDialog mode="create" initial={BLANK} onSave={vi.fn()} onClose={() => {}} />);

    await user.type(screen.getByLabelText("Attendees"), "pa");
    expect(fetchMock).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/workspace/attendee-suggestions?q=pa",
        expect.anything(),
      ),
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(await screen.findByRole("button", { name: /Pat Hartley/ }));
    const chips = within(screen.getByRole("list", { name: "Invited" })).getAllByRole("listitem");
    expect(chips.map((c) => c.textContent)).toEqual(["pat@example.com"]);
    expect(screen.getByLabelText("Attendees")).toHaveValue("");
  });

  it("does not ask for suggestions under two characters", async () => {
    const user = userEvent.setup();
    render(<EventEditorDialog mode="create" initial={BLANK} onSave={vi.fn()} onClose={() => {}} />);
    await user.type(screen.getByLabelText("Attendees"), "p");
    await new Promise((r) => setTimeout(r, 300));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("a failed save keeps the dialog open with the reason", async () => {
    const onSave = vi.fn(async () => {
      throw new Error("500");
    });
    const user = userEvent.setup();
    render(
      <EventEditorDialog
        mode="create"
        initial={{ ...BLANK, subject: "Call" }}
        onSave={onSave}
        onClose={() => {}}
      />,
    );
    await user.click(save());
    expect(await screen.findByText("Couldn't save the meeting. Try again.")).toBeInTheDocument();
    expect(save()).toBeEnabled();
  });
});

describe("EventEditorDialog — which calendar", () => {
  const two = [MS, GOOGLE];
  const renderCreate = (onSave = vi.fn(async () => {}), accounts = two) =>
    render(
      <EventEditorDialog
        mode="create"
        accounts={accounts}
        initial={{ ...BLANK, subject: "Call" }}
        onSave={onSave}
        onClose={() => {}}
      />,
    );

  beforeEach(() => localStorage.clear());

  it("with two accounts, picking Google offers a Meet link and saves to Google", async () => {
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    renderCreate(onSave);
    expect(screen.getByLabelText("Add a Teams link")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Calendar"), "g-1");
    await user.click(screen.getByLabelText("Add a Google Meet link"));
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "g-1", video: true }));
    expect(localStorage.getItem("workspace.lastAccount")).toBe("g-1");
  });

  it("with one account there is no select", () => {
    renderCreate(vi.fn(), [GOOGLE]);
    expect(screen.queryByLabelText("Calendar")).toBeNull();
    expect(screen.getByLabelText("Add a Google Meet link")).toBeInTheDocument();
  });

  it("starts on the last account used, when it is still offered", () => {
    localStorage.setItem("workspace.lastAccount", "g-1");
    renderCreate();
    expect(screen.getByLabelText("Calendar")).toHaveValue("g-1");
  });

  it("ignores a last account that is no longer offered", () => {
    localStorage.setItem("workspace.lastAccount", "gone");
    renderCreate();
    expect(screen.getByLabelText("Calendar")).toHaveValue("ms-1");
  });
});

describe("EventEditorDialog — edit", () => {
  it("a Google meeting shows the Meet link, and Cancel says Google Calendar", async () => {
    const user = userEvent.setup();
    render(
      <EventEditorDialog
        mode="edit"
        provider="google"
        initial={{ ...REVIEW, meetingUrl: "https://meet.google.com/abc-defg-hij" }}
        onSave={vi.fn()}
        onCancelMeeting={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole("link", { name: /Join the Google Meet/ })).toHaveAttribute(
      "href",
      "https://meet.google.com/abc-defg-hij",
    );
    await user.click(screen.getByRole("button", { name: "Cancel meeting" }));
    expect(
      screen.getByText("Cancel this meeting? Everyone invited gets a cancellation from Google Calendar."),
    ).toBeInTheDocument();
  });

  it("shows the subject read-only, the attendees and the Teams link", () => {
    render(
      <EventEditorDialog
        mode="edit"
        initial={REVIEW}
        onSave={vi.fn()}
        onCancelMeeting={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(screen.queryByRole("textbox", { name: "Subject" })).toBeNull();
    expect(screen.getByText("Annual review")).toBeInTheDocument();
    expect(screen.getByText("pat@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText("Add a Teams link")).toBeNull();
    expect(screen.getByRole("link", { name: /Join the Teams meeting/ })).toHaveAttribute(
      "href",
      REVIEW.meetingUrl,
    );
  });

  it("saves the new date and times", async () => {
    const onSave = vi.fn(async () => {});
    const user = userEvent.setup();
    render(<EventEditorDialog mode="edit" initial={REVIEW} onSave={onSave} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText("Date"), {
      target: { value: "2026-10-29" },
    });
    fireEvent.change(screen.getByLabelText("Start"), {
      target: { value: "13:00" },
    });
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        start: "2026-10-29T13:00",
        end: "2026-10-29T14:30",
      }),
    );
  });

  it("Cancel meeting asks first, and confirming cancels it", async () => {
    const onCancelMeeting = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <EventEditorDialog
        mode="edit"
        initial={REVIEW}
        onSave={vi.fn()}
        onCancelMeeting={onCancelMeeting}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel meeting" }));
    expect(
      screen.getByText("Cancel this meeting? Everyone invited gets a cancellation from Outlook."),
    ).toBeInTheDocument();
    expect(onCancelMeeting).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Cancel meeting" }));
    expect(onCancelMeeting).toHaveBeenCalledTimes(1);
  });

  it("Keep meeting backs out of the confirmation", async () => {
    const onCancelMeeting = vi.fn(async () => {});
    const user = userEvent.setup();
    render(
      <EventEditorDialog
        mode="edit"
        initial={REVIEW}
        onSave={vi.fn()}
        onCancelMeeting={onCancelMeeting}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel meeting" }));
    await user.click(screen.getByRole("button", { name: "Keep meeting" }));
    expect(onCancelMeeting).not.toHaveBeenCalled();
    expect(save()).toBeInTheDocument();
  });

  it("a failed cancel stays open with the reason", async () => {
    const onCancelMeeting = vi.fn(async () => {
      throw new Error("503");
    });
    const user = userEvent.setup();
    render(
      <EventEditorDialog
        mode="edit"
        initial={REVIEW}
        onSave={vi.fn()}
        onCancelMeeting={onCancelMeeting}
        onClose={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Cancel meeting" }));
    await user.click(screen.getByRole("button", { name: "Cancel meeting" }));
    expect(await screen.findByText("Couldn't cancel the meeting. Try again.")).toBeInTheDocument();
  });
});

describe("EventEditorDialog — meetings that run past a day", () => {
  const edit = (start: string, end: string, onSave = vi.fn(async () => {})) => {
    render(
      <EventEditorDialog mode="edit" initial={{ ...REVIEW, start, end }} onSave={onSave} onClose={() => {}} />,
    );
    return onSave;
  };

  it("a Monday-to-Wednesday meeting opens without an error and saves unchanged", async () => {
    const user = userEvent.setup();
    const onSave = edit("2026-10-26T09:00", "2026-10-28T17:00");
    expect(screen.queryByText("End time must be after the start time.")).toBeNull();
    expect(screen.getByText("Oct 28")).toBeInTheDocument();
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ start: "2026-10-26T09:00", end: "2026-10-28T17:00" }),
    );
  });

  it("an overnight meeting opens without an error and saves unchanged", async () => {
    const user = userEvent.setup();
    const onSave = edit("2026-10-27T22:00", "2026-10-28T02:00");
    expect(screen.queryByText("End time must be after the start time.")).toBeNull();
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ start: "2026-10-27T22:00", end: "2026-10-28T02:00" }),
    );
  });

  it("a meeting ending at midnight saves unchanged", async () => {
    const user = userEvent.setup();
    const onSave = edit("2026-10-27T23:00", "2026-10-28T00:00");
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ start: "2026-10-27T23:00", end: "2026-10-28T00:00" }),
    );
  });

  it("moving a multi-day meeting's start or date keeps its length", async () => {
    const user = userEvent.setup();
    const onSave = edit("2026-10-26T09:00", "2026-10-28T17:00");
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "10:00" } });
    fireEvent.change(screen.getByLabelText("Date"), { target: { value: "2026-10-27" } });
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ start: "2026-10-27T10:00", end: "2026-10-29T18:00" }),
    );
  });

  it("a later start can carry a same-day meeting past midnight", async () => {
    const user = userEvent.setup();
    const onSave = edit("2026-10-27T10:00", "2026-10-27T11:30");
    fireEvent.change(screen.getByLabelText("Start"), { target: { value: "23:30" } });
    expect(screen.getByLabelText("End")).toHaveValue("01:00");
    await user.click(save());
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ start: "2026-10-27T23:30", end: "2026-10-28T01:00" }),
    );
  });
});

describe("EventEditorDialog — the cancel confirmation", () => {
  const CONFIRM = "Cancel this meeting? Everyone invited gets a cancellation from Outlook.";
  const renderEdit = (onCancelMeeting = vi.fn(async () => {})) => {
    render(
      <EventEditorDialog
        mode="edit"
        initial={REVIEW}
        onSave={vi.fn()}
        onCancelMeeting={onCancelMeeting}
        onClose={() => {}}
      />,
    );
    return onCancelMeeting;
  };

  it("is announced and takes focus, so a second Enter keeps the meeting", async () => {
    const user = userEvent.setup();
    const onCancelMeeting = renderEdit();
    screen.getByRole("button", { name: "Cancel meeting" }).focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("alert")).toHaveTextContent(CONFIRM);
    expect(screen.getByRole("button", { name: "Keep meeting" })).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(onCancelMeeting).not.toHaveBeenCalled();
    expect(save()).toBeInTheDocument();
    expect(screen.getByLabelText("Start")).toHaveFocus();
  });

  it("a double click on Cancel meeting only asks", async () => {
    const user = userEvent.setup();
    const onCancelMeeting = renderEdit();
    await user.dblClick(screen.getByRole("button", { name: "Cancel meeting" }));
    expect(onCancelMeeting).not.toHaveBeenCalled();
    expect(screen.getByText(CONFIRM)).toBeInTheDocument();
  });
});

