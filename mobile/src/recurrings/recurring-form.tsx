// mobile/src/recurrings/recurring-form.tsx
//
// Create/edit form for a recurring bill/income rule, used by
// app/recurring/[id].tsx for both id === "new" (mode: "create") and the
// detail modal's Edit action (mode: "edit"). Pure state/validation lives in
// ./form.ts (form.test.ts); this component is the wiring: text inputs,
// segmented matchType/cadence, the monthly anytime Switch, the category
// picker, a 300ms-debounced live match-count preview, and save/cancel.

import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { useApi } from "@/api/context";
import { ApiError } from "@/api/client";
import { createRecurring, previewRecurring, updateRecurring } from "@/api/portal";
import { CategoryDot } from "@/ui/category-dot";
import { CategoryPickerModal } from "@/txn/category-picker";
import type { CategoryPick } from "@/txn/use-transactions";
import { toPreviewQuery, toUpsertBody, validate, type RecurringFormState } from "./form";
import type { RecurringRowDTO } from "@contracts";

const PREVIEW_DEBOUNCE_MS = 300;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View className="mt-4">
      <Text className="text-ink-3 text-xs uppercase tracking-wide mb-1.5">{label}</Text>
      {children}
    </View>
  );
}

function Segmented<T extends string>({
  options, value, onChange, disabled,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row bg-card-2 border border-hair rounded-xl p-1">
      {options.map((o) => (
        <Pressable
          key={o.value}
          className={`flex-1 items-center rounded-lg py-2 ${o.value === value ? "bg-accent-wash" : ""}`}
          onPress={() => onChange(o.value)}
          disabled={disabled}
        >
          <Text className={o.value === value ? "text-accent-ink text-sm font-medium" : "text-ink-3 text-sm"}>
            {o.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export function RecurringForm({
  mode,
  recurringId,
  initial,
  initialCategory,
  onCancel,
}: {
  mode: "create" | "edit";
  /** Required (and only meaningful) when mode === "edit". */
  recurringId?: string;
  initial: RecurringFormState;
  initialCategory: { name: string; color: string | null } | null;
  onCancel: () => void;
}) {
  const api = useApi();
  const router = useRouter();

  const [f, setF] = useState<RecurringFormState>(initial);
  const [category, setCategory] = useState(initialCategory);
  const [pickerVisible, setPickerVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [previewCount, setPreviewCount] = useState<number | null>(null);

  function set<K extends keyof RecurringFormState>(key: K, value: RecurringFormState[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
  }

  // Live match-count preview: 300ms debounce, cleaned up on unmount/change so
  // an in-flight request from a since-superseded query can never clobber a
  // newer one (the `live` flag idiom used throughout this codebase, e.g.
  // app/recurring/[id].tsx's fetchMe effect).
  useEffect(() => {
    const q = toPreviewQuery(f);
    if (!q) {
      setPreviewCount(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      previewRecurring(api, q)
        .then((res) => {
          if (live) setPreviewCount(res.count);
        })
        .catch(() => {
          if (live) setPreviewCount(null);
        });
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [f.matchType, f.pattern, f.amountMin, f.amountMax, api]);

  function pickCategory(c: CategoryPick) {
    setPickerVisible(false);
    if (c) {
      setCategory({ name: c.name, color: c.color });
      set("categoryId", c.id);
    }
  }

  async function handleSave() {
    const err = validate(f);
    if (err) {
      setError(err);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const body = toUpsertBody(f);
      if (mode === "create") {
        await createRecurring(api, body);
      } else {
        await updateRecurring(api, recurringId as string, body);
      }
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save this recurring. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <View>
      <Text className="text-ink text-xl font-semibold">{mode === "create" ? "New recurring" : "Edit recurring"}</Text>

      <Field label="Name">
        <TextInput
          className="bg-card-2 text-ink border border-hair rounded-xl px-3 py-2"
          placeholder="Netflix"
          placeholderTextColor="#848a98"
          value={f.name}
          onChangeText={(v) => set("name", v)}
          editable={!submitting}
        />
      </Field>

      <Field label="Match type">
        <Segmented
          options={[
            { value: "contains", label: "Contains" },
            { value: "exact", label: "Exact" },
          ]}
          value={f.matchType}
          onChange={(v) => set("matchType", v)}
          disabled={submitting}
        />
      </Field>

      <Field label="Pattern">
        <TextInput
          className="bg-card-2 text-ink border border-hair rounded-xl px-3 py-2"
          placeholder="NETFLIX.COM"
          placeholderTextColor="#848a98"
          value={f.pattern}
          onChangeText={(v) => set("pattern", v)}
          editable={!submitting}
          autoCapitalize="none"
        />
      </Field>

      <View className="flex-row mt-4">
        <View className="flex-1 mr-2">
          <Text className="text-ink-3 text-xs uppercase tracking-wide mb-1.5">Min amount</Text>
          <TextInput
            className="bg-card-2 text-ink border border-hair rounded-xl px-3 py-2"
            placeholder="0"
            placeholderTextColor="#848a98"
            keyboardType="decimal-pad"
            value={f.amountMin}
            onChangeText={(v) => set("amountMin", v)}
            editable={!submitting}
          />
        </View>
        <View className="flex-1 ml-2">
          <Text className="text-ink-3 text-xs uppercase tracking-wide mb-1.5">Max amount</Text>
          <TextInput
            className="bg-card-2 text-ink border border-hair rounded-xl px-3 py-2"
            placeholder="0"
            placeholderTextColor="#848a98"
            keyboardType="decimal-pad"
            value={f.amountMax}
            onChangeText={(v) => set("amountMax", v)}
            editable={!submitting}
          />
        </View>
      </View>

      {previewCount !== null ? (
        <Text className="text-ink-4 text-xs mt-2">
          Matches {previewCount} past transaction{previewCount === 1 ? "" : "s"}.
        </Text>
      ) : null}

      <Field label="Cadence">
        <Segmented
          options={[
            { value: "monthly", label: "Monthly" },
            { value: "annually", label: "Annually" },
          ]}
          value={f.cadence}
          onChange={(v) => set("cadence", v)}
          disabled={submitting}
        />
      </Field>

      {f.cadence === "monthly" ? (
        <>
          <View className="flex-row items-center justify-between mt-4">
            <Text className="text-ink">Any day in the month</Text>
            <Switch value={f.anytime} onValueChange={(v) => set("anytime", v)} disabled={submitting} />
          </View>
          {!f.anytime ? (
            <Field label="Due day (1-31)">
              <TextInput
                className="bg-card-2 text-ink border border-hair rounded-xl px-3 py-2"
                placeholder="1"
                placeholderTextColor="#848a98"
                keyboardType="number-pad"
                value={f.dueDay}
                onChangeText={(v) => set("dueDay", v)}
                editable={!submitting}
              />
            </Field>
          ) : null}
        </>
      ) : (
        <Field label="Due month (1-12)">
          <TextInput
            className="bg-card-2 text-ink border border-hair rounded-xl px-3 py-2"
            placeholder="1"
            placeholderTextColor="#848a98"
            keyboardType="number-pad"
            value={f.dueMonth}
            onChangeText={(v) => set("dueMonth", v)}
            editable={!submitting}
          />
        </Field>
      )}

      <Field label="Category">
        <Pressable
          className="flex-row items-center bg-card-2 border border-hair rounded-xl px-3 py-2.5"
          onPress={() => setPickerVisible(true)}
          disabled={submitting}
        >
          {category ? (
            <>
              <CategoryDot color={category.color} />
              <Text className="text-ink ml-2">{category.name}</Text>
            </>
          ) : (
            <Text className="text-ink-4">Choose a category</Text>
          )}
        </Pressable>
      </Field>

      {error ? <Text className="text-crit mt-4">{error}</Text> : null}

      <View className="flex-row mt-6">
        <Pressable
          className={`flex-1 border border-hair rounded-xl px-4 py-2.5 mr-3 ${submitting ? "opacity-50" : ""}`}
          onPress={onCancel}
          disabled={submitting}
        >
          <Text className="text-ink-2 text-center">Cancel</Text>
        </Pressable>
        <Pressable
          className={`flex-1 bg-accent rounded-xl px-4 py-2.5 items-center ${submitting ? "opacity-50" : ""}`}
          onPress={() => void handleSave()}
          disabled={submitting}
        >
          {submitting ? <ActivityIndicator /> : <Text className="text-paper font-semibold">Save</Text>}
        </Pressable>
      </View>

      <CategoryPickerModal visible={pickerVisible} onClose={() => setPickerVisible(false)} onPick={pickCategory} />
    </View>
  );
}

/** Convenience re-export so callers can build initialCategory from a row
 *  without importing RecurringRowDTO twice. */
export function categoryFromRow(r: RecurringRowDTO): { name: string; color: string | null } | null {
  return r.categoryName ? { name: r.categoryName, color: r.categoryColor } : null;
}
