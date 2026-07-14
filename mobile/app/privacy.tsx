// mobile/app/privacy.tsx
//
// Privacy & sharing screen — the three advisor-sharing toggles (transactions,
// budget, recurring bills) plus a note on what's always visible regardless of
// sharing choices. Push screen (Stack sibling of (tabs), outside the MeGate
// provider that scopes `useMe()` to the tab bar's subtree).
//
// Editability here is gated on `mode` from fetchSettings, NOT `useMe()`: this
// is an advisor act-as preview concern (sharing is the client's decision, so
// an advisor viewing as a client can see the choices but not change them),
// and `mode` is the correct + sufficient signal — no need for fetchMe/
// editEnabled the way profile.tsx/recurrings.tsx use it for their own
// (unrelated) edit affordances.
//
// Toggle logic is a straight port of the web's privacy-toggles.tsx: flip the
// local flag immediately, PUT the single changed key, and revert + show an
// error line if the request rejects. mobile's ApiClient.put() already throws
// on a non-2xx response (src/api/client.ts), so a bare `.catch()` here covers
// what the web version needed an explicit `res.ok` check for.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Switch, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { PortalPrivacy, PortalSettingsDTO } from "@contracts";
import { useApi } from "@/api/context";
import { fetchSettings, updatePrivacy } from "@/api/portal";

const ROWS: ReadonlyArray<{
  key: keyof PortalPrivacy;
  label: string;
  description: string;
}> = [
  {
    key: "shareTransactions",
    label: "Transactions",
    description: "Your transaction feed, including the to-review queue.",
  },
  {
    key: "shareBudgets",
    label: "Budget",
    description: "Budget amounts and spending by category.",
  },
  {
    key: "shareRecurrings",
    label: "Recurring bills",
    description: "The bills and subscriptions you track.",
  },
];

function PrivacyRow({
  label, description, on, disabled, onToggle, last,
}: {
  label: string;
  description: string;
  on: boolean;
  disabled: boolean;
  onToggle: (next: boolean) => void;
  last: boolean;
}) {
  return (
    <View className={`flex-row items-center justify-between py-3 ${last ? "" : "border-b border-hair"}`}>
      <View className="flex-1 mr-3">
        <Text className="text-ink">{label}</Text>
        <Text className="text-ink-3 text-xs mt-0.5">{description}</Text>
      </View>
      <View className="flex-row items-center">
        <Text className="text-ink-3 text-xs mr-2">{on ? "Shared" : "Private"}</Text>
        <Switch value={on} onValueChange={onToggle} disabled={disabled} />
      </View>
    </View>
  );
}

export default function Privacy() {
  const api = useApi();
  const router = useRouter();

  const [settings, setSettings] = useState<PortalSettingsDTO | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(false);
      setSettings(await fetchSettings(api));
    } catch {
      setError(true);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const readOnly = settings?.mode === "advisor";

  function flip(key: keyof PortalPrivacy, next: boolean) {
    if (!settings || readOnly) return;
    setSaveError(null);
    const prev = settings.privacy;
    setSettings({ ...settings, privacy: { ...prev, [key]: next } });
    updatePrivacy(api, { [key]: next }).catch(() => {
      setSettings((s) => (s ? { ...s, privacy: prev } : s));
      setSaveError("Couldn't save that change.");
    });
  }

  return (
    <ScrollView
      className="flex-1 bg-paper px-4"
      contentContainerStyle={{ paddingTop: 64, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#aab0bc" />}
    >
      <View className="mb-4">
        <View className="flex-row items-center">
          <Pressable onPress={() => router.back()} hitSlop={8} className="mr-2 -ml-2 p-2">
            <Ionicons name="chevron-back" size={24} color="#f4f5f7" />
          </Pressable>
          <Text className="text-ink text-2xl font-semibold">Privacy & sharing</Text>
        </View>
        <Text className="text-ink-3 mt-1">
          Choose what your advisor can see from your budgeting tools.
        </Text>
        {readOnly ? (
          <Text className="text-ink-3 text-xs mt-2">Only the client can change these</Text>
        ) : null}
      </View>

      {settings === null && !error ? (
        <View className="py-24 items-center">
          <ActivityIndicator />
        </View>
      ) : settings === null && error ? (
        <View className="py-24 items-center">
          <Text className="text-ink-2">Couldn't load your settings.</Text>
          <Text className="text-ink-4 mt-1">Pull down to retry.</Text>
        </View>
      ) : settings ? (
        <>
          {error ? (
            <Text className="text-warn mb-3">Couldn't refresh. Pull down to try again.</Text>
          ) : null}

          <View className="bg-card border border-hair rounded-2xl px-4">
            {ROWS.map((row, i) => (
              <PrivacyRow
                key={row.key}
                label={row.label}
                description={row.description}
                on={settings.privacy[row.key]}
                disabled={readOnly}
                onToggle={(next) => flip(row.key, next)}
                last={i === ROWS.length - 1}
              />
            ))}
          </View>
          {saveError ? <Text className="text-crit mt-2">{saveError}</Text> : null}

          <View className="bg-card-2 border border-hair rounded-2xl px-4 py-4 mt-4">
            <Text className="text-ink-2 text-xs font-semibold uppercase tracking-wide mb-1">
              Always visible to your advisor
            </Text>
            <Text className="text-ink-3 leading-relaxed">
              Accounts and balances, net worth, investments, and your household
              profile stay visible — your financial plan is built on them.
            </Text>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
