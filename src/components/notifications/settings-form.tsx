"use client";

import { Fragment, useState, type ReactElement } from "react";
import { useFormStatus } from "react-dom";
import {
  NOTIFICATION_GROUPS,
  CATEGORY_LABELS,
  DATE_DIGEST_CADENCES,
  type NotificationCategory,
  type NotificationGroup,
  type DateDigestCadence,
  type NotificationPrefsMap,
} from "@/lib/notifications/catalog";
import { FieldTooltip } from "@/components/forms/field-tooltip";
import { savePreferencesAction } from "@/app/(app)/alerts/actions";

type Channel = "inApp" | "email";

const CHANNELS: Channel[] = ["inApp", "email"];

/**
 * `heading` is the visible column heading; `spoken` is the tail of every
 * checkbox's accessible name, which has to name the column because the visible
 * row text names only the row.
 */
const CHANNEL_COPY: Record<Channel, { heading: string; spoken: string }> = {
  inApp: { heading: "In app", spoken: "in app" },
  email: { heading: "Email", spoken: "email" },
};

/** Weekly opens on Monday and monthly on the 1st — see scan/birthdays.ts. */
const CADENCE_LABELS: Record<DateDigestCadence, string> = {
  daily: "Every day",
  weekly: "Weekly, on Monday",
  monthly: "Monthly, on the 1st",
};

/**
 * One cell of the matrix. The <label> wraps the box so the whole cell is a hit
 * target rather than the 16px control, and carries the accessible name — the
 * visible row text names the row but not the column, and a bare checkbox with
 * neither would announce as an unnamed control.
 */
function ChannelCheckbox({
  name,
  label,
  checked,
  onChange,
}: {
  name?: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}): ReactElement {
  return (
    <label className="flex cursor-pointer items-center justify-center py-2">
      <span className="sr-only">{label}</span>
      <input
        type="checkbox"
        name={name}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 shrink-0 accent-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      />
    </label>
  );
}

function SaveButton(): ReactElement {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="btn-primary text-[14px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:cursor-not-allowed disabled:opacity-50"
    >
      {pending ? "Saving…" : "Save preferences"}
    </button>
  );
}

/**
 * Controlled rather than uncontrolled, because the per-group master toggles
 * have to drive their children. Controlled checkboxes still submit normally:
 * a checked box contributes its `name`, an unchecked one is absent — which is
 * exactly what parseSettingsPayload is built around.
 */
export default function SettingsForm({
  prefs,
  cadence,
}: {
  prefs: NotificationPrefsMap;
  cadence: DateDigestCadence;
}): ReactElement {
  const [channels, setChannels] = useState<NotificationPrefsMap>(prefs);

  function setOne(category: NotificationCategory, channel: Channel, value: boolean) {
    setChannels((prev) => ({
      ...prev,
      [category]: { ...prev[category], [channel]: value },
    }));
  }

  /** A master toggle is "on" only when every category under it is on. */
  function groupAllOn(group: NotificationGroup, channel: Channel): boolean {
    return group.categories.every((c) => channels[c][channel]);
  }

  function toggleGroup(group: NotificationGroup, channel: Channel) {
    const next = !groupAllOn(group, channel);
    setChannels((prev) => {
      const out = { ...prev };
      for (const c of group.categories) out[c] = { ...out[c], [channel]: next };
      return out;
    });
  }

  return (
    <form action={savePreferencesAction} className="flex flex-col gap-5">
      <div className="divide-y divide-hair rounded-[var(--radius-sm)] border border-hair bg-card">
        {NOTIFICATION_GROUPS.map((group) => (
          <section key={group.id} className="px-5 py-5">
            <h2 className="text-[15px] font-semibold text-ink">{group.label}</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">{group.description}</p>

            {/* minmax(0,…) rather than a bare 1fr: a bare fr track floors at its
                content's min-width, so a long category label would push the two
                checkbox columns off the card instead of wrapping. */}
            <div className="mt-3 grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center">
              <span />
              {CHANNELS.map((channel) => (
                <span
                  key={channel}
                  className="text-center text-[11px] uppercase tracking-[0.08em] text-ink-3"
                >
                  {CHANNEL_COPY[channel].heading}
                </span>
              ))}

              {/* Master row. 18 categories x 2 channels is 36 controls; without
                  these, turning a whole group off is six clicks. Not a
                  submitted field — it only drives the children, which post.
                  Visible text is a bare "All" because the group heading sits
                  directly above it; the accessible name below names the group
                  and the channel, since a screen reader reaches the control
                  without that context. */}
              <span className="py-2 text-[13px] font-medium text-ink-2">All</span>
              {CHANNELS.map((channel) => (
                <ChannelCheckbox
                  key={channel}
                  label={`All ${group.label} ${CHANNEL_COPY[channel].spoken}`}
                  checked={groupAllOn(group, channel)}
                  onChange={() => toggleGroup(group, channel)}
                />
              ))}

              <span className="col-span-3 mb-1 h-px bg-hair" />

              {group.categories.map((category) => (
                <Fragment key={category}>
                  <span className="py-2 pr-4 text-[14px] text-ink">
                    {CATEGORY_LABELS[category]}
                  </span>
                  {CHANNELS.map((channel) => (
                    <ChannelCheckbox
                      key={channel}
                      name={`${channel}:${category}`}
                      label={`${CATEGORY_LABELS[category]} ${CHANNEL_COPY[channel].spoken}`}
                      checked={channels[category][channel]}
                      onChange={(next) => setOne(category, channel, next)}
                    />
                  ))}
                </Fragment>
              ))}
            </div>

            {group.id === "dates" ? (
              <div className="mt-4 flex items-center gap-2 border-t border-hair pt-4">
                <label
                  htmlFor="dateDigestCadence"
                  className="flex items-center gap-1.5 text-[14px] text-ink"
                >
                  How often
                  <FieldTooltip text="Birthdays and milestone ages arrive as one digest, never one alert per client. Daily covers that day, weekly opens Monday and covers seven days, monthly opens on the 1st and covers the rest of the month." />
                </label>
                <select
                  id="dateDigestCadence"
                  name="dateDigestCadence"
                  defaultValue={cadence}
                  className="ml-1 rounded-[var(--radius-sm)] border border-hair bg-card-2 px-2 py-1.5 text-[14px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {DATE_DIGEST_CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {CADENCE_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
          </section>
        ))}
      </div>

      <div>
        <SaveButton />
      </div>
    </form>
  );
}
