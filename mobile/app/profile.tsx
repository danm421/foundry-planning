// mobile/app/profile.tsx
//
// Profile screen — household (primary/spouse contact), family, and trusts
// sections. A privacy screen (Task 13) and the More-tab entry point (Task 14)
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
//
// Family section mirrors src/profile/family.ts (family.test.ts): the API's
// relationship enum (src/db/schema.ts familyRelationshipEnum) has more
// values than the mobile picker's 4-option subset (child/parent/sibling/
// other) — fromMember() maps anything outside that subset to "other" so the
// edit form's picker always has somewhere valid to show, but PUT
// /api/portal/family/[id] only patches whatever key is *present* on the
// body. `relationshipTouched` below is the dirty flag that keeps an
// untouched "other" seed (really "grandchild", etc.) from being written back
// over the real value — see saveFamily().
//
// Trusts section is rename-only (parity with the web portal's
// profile-trusts-list.tsx): no add/delete.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import type {
  FamilyMemberInput, PortalFamilyMemberDTO, PortalFamilyRelationshipOption,
  PortalHouseholdDTO, PortalMeDTO, PortalTrustDTO,
} from "@contracts";
import { useApi } from "@/api/context";
import { ApiError } from "@/api/client";
import {
  addFamilyMember, deleteFamilyMember, fetchFamily, fetchHousehold, fetchMe, fetchTrusts,
  renameTrust, updateFamilyMember, updateHousehold,
} from "@/api/portal";
import { Tile } from "@/home/tiles";
import { EmptyState } from "@/ui/empty-state";
import { formatMoney } from "@/ui/money";
import { toFields, validateFields, householdPatch, summaryLine, type ContactFields } from "@/profile/household";
import {
  RELATIONSHIP_OPTIONS, emptyFamilyForm, fromMember, validateFamily, toFamilyBody, type FamilyFormState,
} from "@/profile/family";

function Field({
  label, value, onChangeText, editable, keyboardType, autoCapitalize, placeholder,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  editable: boolean;
  keyboardType?: "default" | "email-address" | "phone-pad";
  autoCapitalize?: "none" | "words";
  placeholder?: string;
}) {
  return (
    <View className="mt-3">
      <Text className="text-ink-3 text-xs uppercase tracking-wide mb-1">{label}</Text>
      {editable ? (
        <TextInput
          className="bg-card-2 text-ink border border-hair rounded-xl px-3 py-2"
          placeholder={placeholder}
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

/** "child" -> "Child", for the relationship segmented row. The raw
 *  (lowercase) value is still what's shown read-only on FamilyCard and what
 *  goes over the wire — this is display-only for the picker. */
function relationshipLabel(r: PortalFamilyRelationshipOption): string {
  return r.charAt(0).toUpperCase() + r.slice(1);
}

function FamilyCard({
  m, editEnabled, onEdit, onDelete, deleting,
}: {
  m: PortalFamilyMemberDTO;
  editEnabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const name = [m.firstName, m.lastName].filter(Boolean).join(" ");
  const sublabel = [m.relationship, m.dateOfBirth].filter((v): v is string => Boolean(v)).join(" · ");
  return (
    <View className="border-t border-hair pt-3 mt-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 mr-2">
          <Text className="text-ink">{name}</Text>
          {sublabel ? <Text className="text-ink-3 text-xs mt-0.5">{sublabel}</Text> : null}
        </View>
        {editEnabled ? (
          <View className="flex-row items-center">
            <Pressable onPress={onEdit} hitSlop={8} disabled={deleting} className="mr-3">
              <Text className="text-accent-ink">Edit</Text>
            </Pressable>
            <Pressable onPress={onDelete} hitSlop={8} disabled={deleting}>
              <Text className="text-crit">{deleting ? "Deleting…" : "Delete"}</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function FamilyEditor({
  form, onChange, onRelationshipChange, onSave, onCancel, saving, error,
}: {
  form: FamilyFormState;
  onChange: (f: FamilyFormState) => void;
  onRelationshipChange: (r: PortalFamilyRelationshipOption) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  function set<K extends keyof FamilyFormState>(key: K, value: FamilyFormState[K]) {
    onChange({ ...form, [key]: value });
  }
  return (
    <View className="border-t border-hair pt-3 mt-3">
      <Field label="First name" value={form.firstName} onChangeText={(v) => set("firstName", v)} editable={!saving} autoCapitalize="words" />
      <Field label="Last name" value={form.lastName} onChangeText={(v) => set("lastName", v)} editable={!saving} autoCapitalize="words" />
      <View className="mt-3">
        <Text className="text-ink-3 text-xs uppercase tracking-wide mb-1">Relationship</Text>
        <View className="flex-row bg-card-2 border border-hair rounded-xl p-1">
          {RELATIONSHIP_OPTIONS.map((opt) => (
            <Pressable
              key={opt}
              className={`flex-1 items-center rounded-lg py-2 ${opt === form.relationship ? "bg-accent-wash" : ""}`}
              onPress={() => onRelationshipChange(opt)}
              disabled={saving}
            >
              <Text className={opt === form.relationship ? "text-accent-ink text-sm font-medium" : "text-ink-3 text-sm"}>
                {relationshipLabel(opt)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
      <Field
        label="Date of birth"
        value={form.dateOfBirth}
        onChangeText={(v) => set("dateOfBirth", v)}
        editable={!saving}
        placeholder="YYYY-MM-DD"
      />
      {error ? <Text className="text-crit mt-2">{error}</Text> : null}
      <View className="flex-row mt-3">
        <Pressable
          className={`flex-1 border border-hair rounded-xl px-4 py-2 mr-3 ${saving ? "opacity-50" : ""}`}
          onPress={onCancel}
          disabled={saving}
        >
          <Text className="text-ink-2 text-center">Cancel</Text>
        </Pressable>
        <Pressable
          className={`flex-1 bg-accent rounded-xl px-4 py-2 items-center ${saving ? "opacity-50" : ""}`}
          onPress={onSave}
          disabled={saving}
        >
          {saving ? <ActivityIndicator /> : <Text className="text-paper font-semibold">Save</Text>}
        </Pressable>
      </View>
    </View>
  );
}

function TrustCard({ t, editEnabled, onRename }: { t: PortalTrustDTO; editEnabled: boolean; onRename: () => void }) {
  return (
    <View className="border-t border-hair pt-3 mt-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-1 mr-2">
          <Text className="text-ink">{t.name}</Text>
          <View className="flex-row items-center mt-0.5 flex-wrap gap-2">
            <Text className="text-ink-3 text-xs">{t.entityType} · {formatMoney(t.value)}</Text>
            {t.isGrantor ? (
              <View className="bg-card-2 border border-hair rounded-full px-2 py-0.5">
                <Text className="text-ink-3 text-xs">grantor trust</Text>
              </View>
            ) : null}
          </View>
        </View>
        {editEnabled ? (
          <Pressable onPress={onRename} hitSlop={8}>
            <Text className="text-accent-ink">Rename</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function TrustEditor({
  value, onChange, onSave, onCancel, saving, error,
}: {
  value: string;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  saving: boolean;
  error: string | null;
}) {
  return (
    <View className="border-t border-hair pt-3 mt-3">
      <Field label="Name" value={value} onChangeText={onChange} editable={!saving} autoCapitalize="words" />
      {error ? <Text className="text-crit mt-2">{error}</Text> : null}
      <View className="flex-row mt-3">
        <Pressable
          className={`flex-1 border border-hair rounded-xl px-4 py-2 mr-3 ${saving ? "opacity-50" : ""}`}
          onPress={onCancel}
          disabled={saving}
        >
          <Text className="text-ink-2 text-center">Cancel</Text>
        </Pressable>
        <Pressable
          className={`flex-1 bg-accent rounded-xl px-4 py-2 items-center ${saving ? "opacity-50" : ""}`}
          onPress={onSave}
          disabled={saving}
        >
          {saving ? <ActivityIndicator /> : <Text className="text-paper font-semibold">Save</Text>}
        </Pressable>
      </View>
    </View>
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

  const [family, setFamily] = useState<PortalFamilyMemberDTO[]>([]);
  // "add" | <id of the member being edited> | null (no form open).
  const [familyTarget, setFamilyTarget] = useState<string | null>(null);
  const [familyForm, setFamilyForm] = useState<FamilyFormState | null>(null);
  // True once the user has actually touched the relationship picker for the
  // member currently being edited — see the module header re: not silently
  // downgrading an unrecognized relationship (e.g. "grandchild") to "other".
  const [relationshipTouched, setRelationshipTouched] = useState(false);
  const [familySaving, setFamilySaving] = useState(false);
  const [familyError, setFamilyError] = useState<string | null>(null);
  const [deletingFamilyId, setDeletingFamilyId] = useState<string | null>(null);

  const [trusts, setTrusts] = useState<PortalTrustDTO[]>([]);
  const [trustEditingId, setTrustEditingId] = useState<string | null>(null);
  const [trustNameDraft, setTrustNameDraft] = useState("");
  const [trustSaving, setTrustSaving] = useState(false);
  const [trustError, setTrustError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setError(false);
      const [data, familyData, trustsData] = await Promise.all([
        fetchHousehold(api),
        fetchFamily(api),
        fetchTrusts(api),
      ]);
      setHousehold(data);
      setEditedPrimary(toFields(data.primary));
      setEditedSpouse(toFields(data.spouse));
      setFamily(familyData);
      setTrusts(trustsData);
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

  function openAddFamily() {
    setFamilyTarget("add");
    setFamilyForm(emptyFamilyForm());
    setRelationshipTouched(false);
    setFamilyError(null);
  }

  function openEditFamily(m: PortalFamilyMemberDTO) {
    setFamilyTarget(m.id);
    setFamilyForm(fromMember(m));
    setRelationshipTouched(false);
    setFamilyError(null);
  }

  function closeFamilyForm() {
    setFamilyTarget(null);
    setFamilyForm(null);
    setRelationshipTouched(false);
    setFamilyError(null);
  }

  function changeFamilyRelationship(r: PortalFamilyRelationshipOption) {
    setFamilyForm((prev) => (prev ? { ...prev, relationship: r } : prev));
    setRelationshipTouched(true);
  }

  async function saveFamily() {
    if (!familyForm || !familyTarget || familySaving) return;
    const validationError = validateFamily(familyForm);
    if (validationError) {
      setFamilyError(validationError);
      return;
    }
    setFamilySaving(true);
    setFamilyError(null);
    try {
      const body = toFamilyBody(familyForm);
      if (familyTarget === "add") {
        await addFamilyMember(api, body);
      } else {
        // Only include relationship in the PATCH if the user actually
        // touched the picker — PUT /api/portal/family/[id] only updates
        // whatever key is present on the body, so omitting it leaves a real
        // "grandchild"/"stepchild"/etc. relationship untouched instead of
        // silently downgrading it to the picker's "other" seed.
        const patchBody: FamilyMemberInput = relationshipTouched
          ? body
          : { firstName: body.firstName, lastName: body.lastName, dateOfBirth: body.dateOfBirth };
        await updateFamilyMember(api, familyTarget, patchBody);
      }
      closeFamilyForm();
      await load();
    } catch (e) {
      setFamilyError(e instanceof ApiError ? e.message : "Couldn't save this family member. Try again.");
    } finally {
      setFamilySaving(false);
    }
  }

  function confirmDeleteFamily(m: PortalFamilyMemberDTO) {
    const name = [m.firstName, m.lastName].filter(Boolean).join(" ");
    Alert.alert("Delete family member?", name, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          void (async () => {
            setDeletingFamilyId(m.id);
            setFamilyError(null);
            try {
              await deleteFamilyMember(api, m.id);
              await load();
            } catch {
              setFamilyError("Couldn't delete this family member. Try again.");
            } finally {
              setDeletingFamilyId(null);
            }
          })();
        },
      },
    ]);
  }

  function openRenameTrust(t: PortalTrustDTO) {
    setTrustEditingId(t.id);
    setTrustNameDraft(t.name);
    setTrustError(null);
  }

  function closeTrustEditor() {
    setTrustEditingId(null);
    setTrustNameDraft("");
    setTrustError(null);
  }

  async function saveTrustName() {
    if (!trustEditingId || trustSaving) return;
    if (trustNameDraft.trim() === "") {
      setTrustError("Name is required.");
      return;
    }
    setTrustSaving(true);
    setTrustError(null);
    try {
      await renameTrust(api, trustEditingId, trustNameDraft.trim());
      closeTrustEditor();
      await load();
    } catch (e) {
      setTrustError(e instanceof ApiError ? e.message : "Couldn't rename this trust. Try again.");
    } finally {
      setTrustSaving(false);
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

          <Tile title="Family">
            {family.length === 0 && familyTarget !== "add" ? (
              <Text className="text-ink-4">No family members on file.</Text>
            ) : null}

            {family.map((m) =>
              familyTarget === m.id && familyForm ? (
                <FamilyEditor
                  key={m.id}
                  form={familyForm}
                  onChange={setFamilyForm}
                  onRelationshipChange={changeFamilyRelationship}
                  onSave={() => void saveFamily()}
                  onCancel={closeFamilyForm}
                  saving={familySaving}
                  error={familyError}
                />
              ) : (
                <FamilyCard
                  key={m.id}
                  m={m}
                  editEnabled={editEnabled}
                  onEdit={() => openEditFamily(m)}
                  onDelete={() => confirmDeleteFamily(m)}
                  deleting={deletingFamilyId === m.id}
                />
              ),
            )}

            {familyTarget === "add" && familyForm ? (
              <FamilyEditor
                form={familyForm}
                onChange={setFamilyForm}
                onRelationshipChange={changeFamilyRelationship}
                onSave={() => void saveFamily()}
                onCancel={closeFamilyForm}
                saving={familySaving}
                error={familyError}
              />
            ) : null}

            {editEnabled && familyTarget === null ? (
              <Pressable className="border border-hair rounded-xl px-4 py-2.5 mt-3" onPress={openAddFamily}>
                <Text className="text-accent-ink text-center">+ Add family member</Text>
              </Pressable>
            ) : null}
          </Tile>

          <Tile title="Trusts">
            {trusts.length === 0 ? <Text className="text-ink-4">No trusts on file.</Text> : null}
            {trusts.map((t) =>
              trustEditingId === t.id ? (
                <TrustEditor
                  key={t.id}
                  value={trustNameDraft}
                  onChange={setTrustNameDraft}
                  onSave={() => void saveTrustName()}
                  onCancel={closeTrustEditor}
                  saving={trustSaving}
                  error={trustError}
                />
              ) : (
                <TrustCard key={t.id} t={t} editEnabled={editEnabled} onRename={() => openRenameTrust(t)} />
              ),
            )}
          </Tile>
        </>
      ) : null}
    </ScrollView>
  );
}
