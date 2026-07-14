// mobile/app/recurring/[id].tsx
//
// Recurring bill/income detail modal: rules, 12-month timeline, per-year
// metrics, and (when editable) Edit/Delete. No single-item GET exists for
// recurrings, so the detail row is found client-side out of the same
// fetchRecurrings() list payload the list screen uses (small dataset, by
// design). Root-level modal (Stack sibling of (tabs), outside MeGate) —
// editEnabled is fetched locally (fail-closed), same pattern as
// category/[id].tsx / plaid/[itemId].tsx.
//
// Detail body (`DetailBody`) plus the Task 10 create/edit form
// (`RecurringForm`, in src/recurrings/recurring-form.tsx): id === "new" goes
// straight to the form seeded with emptyForm(); an existing row's Edit
// action switches `mode` to "edit" with the form seeded via fromRow(r). Any
// other unmatched id (e.g. deleted-elsewhere) falls through to the
// not-found EmptyState below.

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import type { PortalMeDTO, RecurringRowDTO, RecurringsDTO } from "@contracts";
import { useApi } from "@/api/context";
import { deleteRecurring, fetchMe, fetchRecurrings } from "@/api/portal";
import { formatMoney } from "@/ui/money";
import { formatDay } from "@/ui/date";
import { EmptyState } from "@/ui/empty-state";
import { ruleChips } from "@/recurrings/logic";
import { emptyForm, fromRow } from "@/recurrings/form";
import { RecurringForm, categoryFromRow } from "@/recurrings/recurring-form";

/** "2026-07" -> "J". Mirrors the web RecurringTimeline's monthAbbr, trimmed
 *  to the single initial the mobile strip shows under each dot. */
function monthInitial(ym: string): string {
  return new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })[0];
}

/** Plain-View dot strip, one dot per timeline entry (12 for a year window).
 *  Paid = filled accent circle; unpaid = hollow (bg-card-2 + border-hair) —
 *  filled-vs-hollow so the state doesn't rely on color alone. */
function TimelineStrip({ timeline }: { timeline: RecurringRowDTO["timeline"] }) {
  return (
    <View className="flex-row">
      {timeline.map((t) => (
        <View key={t.month} className="flex-1 items-center">
          <View
            className={
              t.paid
                ? "h-2.5 w-2.5 rounded-full bg-accent"
                : "h-2.5 w-2.5 rounded-full bg-card-2 border border-hair"
            }
          />
          <Text className="text-ink-4 text-[10px] mt-1">{monthInitial(t.month)}</Text>
        </View>
      ))}
    </View>
  );
}

function DetailBody({
  r,
  editEnabled,
  onEdit,
  onDelete,
  deleting,
  deleteError,
}: {
  r: RecurringRowDTO;
  editEnabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  deleteError: string | null;
}) {
  return (
    <>
      <Text className="text-ink text-xl font-semibold">{r.name}</Text>
      <View className="flex-row justify-between items-baseline mt-2">
        <Text className="text-ink text-3xl font-semibold">{formatMoney(r.predicted)}</Text>
        {r.nextPaymentDate ? (
          <Text className="text-ink-3">around {formatDay(r.nextPaymentDate)}</Text>
        ) : null}
      </View>

      <View className="flex-row flex-wrap gap-2 mt-4">
        {ruleChips(r).map((chip) => (
          <View key={chip} className="bg-card-2 border border-hair rounded-full px-3 py-1">
            <Text className="text-ink-2 text-xs">{chip}</Text>
          </View>
        ))}
      </View>

      {r.timeline.length > 0 ? (
        <View className="mt-6">
          <Text className="text-ink-3 text-xs uppercase tracking-wide mb-2">History</Text>
          <TimelineStrip timeline={r.timeline} />
        </View>
      ) : null}

      {r.metricsByYear.length > 0 ? (
        <View className="mt-6">
          <Text className="text-ink-3 text-xs uppercase tracking-wide mb-2">Key metrics</Text>
          <View className="flex-row py-1">
            <Text className="flex-1 text-ink-4 text-xs">Year</Text>
            <Text className="w-24 text-ink-4 text-xs text-right">Spent/yr</Text>
            <Text className="w-24 text-ink-4 text-xs text-right">Avg/txn</Text>
          </View>
          {r.metricsByYear.map((m) => (
            <View key={m.year} className="flex-row py-1.5 border-t border-hair">
              <Text className="flex-1 text-ink-2 text-sm">{m.year}</Text>
              <Text className="w-24 text-ink text-sm text-right">{formatMoney(m.total)}</Text>
              <Text className="w-24 text-ink text-sm text-right">{formatMoney(m.avg)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {deleteError ? <Text className="text-crit mt-4">{deleteError}</Text> : null}

      {editEnabled ? (
        <View className="flex-row mt-6">
          <Pressable
            className={`flex-1 border border-hair rounded-xl px-4 py-2 mr-3 ${deleting ? "opacity-50" : ""}`}
            onPress={onEdit}
            disabled={deleting}
          >
            <Text className="text-ink-2 text-center">Edit</Text>
          </Pressable>
          <Pressable
            className={`flex-1 border border-hair rounded-xl px-4 py-2 ${deleting ? "opacity-50" : ""}`}
            onPress={onDelete}
            disabled={deleting}
          >
            <Text className="text-crit text-center">{deleting ? "Deleting…" : "Delete"}</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

export default function RecurringDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const api = useApi();
  const router = useRouter();

  const [data, setData] = useState<RecurringsDTO | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<"detail" | "edit">("detail");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // The modal is a Stack sibling of (tabs), outside the MeGate provider that
  // scopes `useMe()` to the tab bar's subtree — fetch editEnabled directly
  // rather than crashing on a missing context. Fails closed: no edit/delete
  // affordance until this resolves true.
  const [me, setMe] = useState<PortalMeDTO | null>(null);

  const load = useCallback(async () => {
    try {
      setError(false);
      setData(await fetchRecurrings(api));
    } catch {
      setError(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let live = true;
    fetchMe(api)
      .then((m) => {
        if (live) setMe(m);
      })
      .catch(() => {
        // Edit/delete affordances simply stay hidden; the rest of the modal still works.
      });
    return () => {
      live = false;
    };
  }, [api]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const editEnabled = me?.editEnabled === true;
  const r = data?.recurrings.find((row) => row.id === id) ?? null;

  function handleDelete() {
    if (!r || deleting) return;
    Alert.alert("Delete recurring?", r.name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setDeleting(true);
            setDeleteError(null);
            try {
              await deleteRecurring(api, r.id);
              router.back();
            } catch {
              setDeleteError("Couldn't delete this recurring. Try again.");
              setDeleting(false);
            }
          })();
        },
      },
    ]);
  }

  return (
    <View className="flex-1 bg-paper">
      <View className="flex-row justify-end px-4 pt-4">
        <Pressable onPress={() => router.back()} hitSlop={8}>
          <Text className="text-accent-ink">Close</Text>
        </Pressable>
      </View>

      <ScrollView
        className="flex-1 px-4"
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#aab0bc" />}
      >
        {data === null && !error ? (
          <View className="py-24 items-center">
            <ActivityIndicator />
          </View>
        ) : data === null && error ? (
          <View className="py-24 items-center">
            <Text className="text-ink-2">Couldn't load this recurring.</Text>
            <Text className="text-ink-4 mt-1">Pull down to retry.</Text>
          </View>
        ) : data ? (
          <>
            {error ? (
              <Text className="text-warn mb-3">Couldn't refresh. Pull down to try again.</Text>
            ) : null}

            {r ? (
              mode === "detail" ? (
                <DetailBody
                  r={r}
                  editEnabled={editEnabled}
                  onEdit={() => setMode("edit")}
                  onDelete={handleDelete}
                  deleting={deleting}
                  deleteError={deleteError}
                />
              ) : (
                <RecurringForm
                  mode="edit"
                  recurringId={r.id}
                  initial={fromRow(r)}
                  initialCategory={categoryFromRow(r)}
                  onCancel={() => setMode("detail")}
                />
              )
            ) : id === "new" ? (
              <RecurringForm
                mode="create"
                initial={emptyForm()}
                initialCategory={null}
                onCancel={() => router.back()}
              />
            ) : (
              <EmptyState title="Recurring not found" hint="It may have been removed." />
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}
