// mobile/app/profile.tsx
//
// Profile screen — household (primary/spouse contact) section for now.
// Family (Task 12) and trusts (Task 12) sections land on this same screen
// next; a privacy screen (Task 13) and the More-tab entry point (Task 14)
// come after. Push screen (Stack sibling of (tabs), outside the MeGate
// provider that scopes useMe() to the tab bar's subtree) — editEnabled is
// fetched locally, fail-closed, same pattern as recurrings.tsx /
// recurring/[id].tsx / category/[id].tsx / plaid/[itemId].tsx.
//
// Pure form-state + patch diffing lives in src/profile/household.ts
// (household.test.ts): toFields() seeds editable state from the fetched
// contacts, householdPatch() diffs edited state back down to only the
// changed roles/fields, and validateFields() is the Save-gate for the
// firstName-required invariant (the API's crm_household_contacts.first_name
// is NOT NULL; householdPatch() never emits it blank, so this is what stops
// a blanked firstName from being silently dropped on Save).

import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type { PortalHouseholdDTO, PortalMeDTO } from "@contracts";
import { useApi } from "@/api/context";
import { fetchHousehold, fetchMe, updateHousehold } from "@/api/portal";
import { Tile } from "@/home/tiles";
import { EmptyState } from "@/ui/empty-state";
import { toFields, validateFields, householdPatch, summaryLine, type ContactFields } from "@/profile/household";

function Field({
  label, value, onChangeText, editable, keyboardType, autoCapitalize,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  editable: boolean;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words";
}) {
  return (
    <View className="mt-3">
      <Text className="text-ink-3 text-xs uppercase tracking-wide mb-1">{label}</Text>
      {editable ? (
        <TextInput
          className="bg-card-2 text-ink border border-hair rounded-xl px-3 py-2"
          placeholderTextColor="#848a98"
          value={value}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
        />
      ) : (
        <Text className="text-ink">{value || "—"}</Text>
      )}
    </View>
  );
}

function ContactCard({
  title, fields, onChange, editable,
}: {
  title: string;
  fields: ContactFields;
  onChange: (f: ContactFields) => void;
  editable: boolean;
}) {
  function set<K extends keyof ContactFields>(key: K, value: ContactFields[K]) {
    onChange({ ...fields, [key]: value });
  }
  return (
    <Tile title={title}>
      <Field label="First name" value={fields.firstName} onChangeText={(v) => set("firstName", v)} editable={editable} autoCapitalize="words" />
      <Field label="Last name" value={fields.lastName} onChangeText={(v) => set("lastName", v)} editable={editable} autoCapitalize="words" />
      <Field label="Email" value={fields.email} onChangeText={(v) => set("email", v)} editable={editable} keyboardType="email-address" autoCapitalize="none" />
      <Field label="Phone" value={fields.phone} onChangeText={(v) => set("phone", v)} editable={editable} keyboardType="phone-pad" />
    </Tile>
  );
}

export default function Profile() {
  const api = useApi();
  const router = useRouter();

  // This screen is a Stack sibling of (tabs), outside the MeGate provider
  // that scopes `useMe()` to the tab bar's subtree — fetch editEnabled
  // directly rather than crashing on a missing context. Fails closed: every
  // edit affordance (TextInputs, Save/Cancel) stays hidden until this
  // resolves true; a failure just leaves the screen read-only.
  const [me, setMe] = useState<PortalMeDTO | null>(null);
  const [household, setHousehold] = useState<PortalHouseholdDTO | null>(null);
  const [error, setError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [editedPrimary, setEditedPrimary] = useState<ContactFields | null>(null);
  const [editedSpouse, setEditedSpouse] = useState<ContactFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  const load = useCallback(async () => {
    try {
      setError(false);
      const data = await fetchHousehold(api);
      setHousehold(data);
      setEditedPrimary(toFields(data.primary));
      setEditedSpouse(toFields(data.spouse));
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
        // Edit affordances simply stay hidden; the rest of the screen still works.
      });
    return () => {
      live = false;
    };
  }, [api]);

  const editEnabled = me?.editEnabled === true;

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const patch = household
    ? householdPatch(
        { primary: household.primary, spouse: household.spouse },
        { primary: editedPrimary, spouse: editedSpouse },
      )
    : null;
  const canSave = patch !== null && validateFields(editedPrimary) && validateFields(editedSpouse);

  function handleCancel() {
    if (!household) return;
    setEditedPrimary(toFields(household.primary));
    setEditedSpouse(toFields(household.spouse));
    setSaveError(false);
  }

  async function handleSave() {
    if (!patch || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      await updateHousehold(api, patch);
      await load();
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  const summary = household ? summaryLine(household.filingStatus, household.lifeExpectancy) : null;
  const noContacts = household !== null && !editedPrimary && !editedSpouse;

  return (
    <ScrollView
      className="flex-1 bg-paper px-4"
      contentContainerStyle={{ paddingTop: 64, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#aab0bc" />}
    >
      <View className="flex-row items-center mb-4">
        <Pressable onPress={() => router.back()} hitSlop={8} className="mr-2 -ml-2 p-2">
          <Ionicons name="chevron-back" size={24} color="#f4f5f7" />
        </Pressable>
        <Text className="text-ink text-2xl font-semibold">Profile</Text>
      </View>

      {household === null && !error ? (
        <View className="py-24 items-center">
          <ActivityIndicator />
        </View>
      ) : household === null && error ? (
        <View className="py-24 items-center">
          <Text className="text-ink-2">Couldn't load your profile.</Text>
          <Text className="text-ink-4 mt-1">Pull down to retry.</Text>
        </View>
      ) : household ? (
        <>
          {error ? (
            <Text className="text-warn mb-3">Couldn't refresh. Pull down to try again.</Text>
          ) : null}

          {summary ? (
            <Tile title="Household">
              <Text className="text-ink-2">{summary}</Text>
            </Tile>
          ) : null}

          {editedPrimary ? (
            <ContactCard title="Primary" fields={editedPrimary} onChange={setEditedPrimary} editable={editEnabled} />
          ) : null}
          {editedSpouse ? (
            <ContactCard title="Spouse" fields={editedSpouse} onChange={setEditedSpouse} editable={editEnabled} />
          ) : null}

          {noContacts ? <EmptyState title="No household contacts on file" /> : null}

          {saveError ? <Text className="text-crit mt-2">Couldn't save that change.</Text> : null}
          {patch !== null && !canSave ? (
            <Text className="text-warn mt-2">First name is required.</Text>
          ) : null}

          {editEnabled && patch !== null ? (
            <View className="flex-row mt-4">
              <Pressable
                className={`flex-1 border border-hair rounded-xl px-4 py-2.5 mr-3 ${saving ? "opacity-50" : ""}`}
                onPress={handleCancel}
                disabled={saving}
              >
                <Text className="text-ink-2 text-center">Cancel</Text>
              </Pressable>
              <Pressable
                className={`flex-1 bg-accent rounded-xl px-4 py-2.5 items-center ${saving || !canSave ? "opacity-50" : ""}`}
                onPress={() => void handleSave()}
                disabled={saving || !canSave}
              >
                {saving ? <ActivityIndicator /> : <Text className="text-paper font-semibold">Save</Text>}
              </Pressable>
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
