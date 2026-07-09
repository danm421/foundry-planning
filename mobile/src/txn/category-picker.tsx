// mobile/src/txn/category-picker.tsx
//
// Modal category chooser, shared by the Transactions screen for two jobs:
// filtering the list (onPick receives the picked category) and
// recategorizing a single row (onPick applies it to that row; with
// allowUncategorized, onPick(null) clears the row's category).
// The caller decides what onPick does — this component only presents +
// picks. Categories are fetched once, the first time the modal opens.

import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from "react-native";
import type { PortalCategoryDTO } from "@contracts";
import { useApi } from "@/api/context";
import { fetchCategories } from "@/api/portal";
import { Row } from "@/ui/row";
import { CategoryDot } from "@/ui/category-dot";
import type { CategoryPick } from "./use-transactions";

export function CategoryPickerModal({
  visible,
  onClose,
  onPick,
  allowUncategorized = false,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (category: CategoryPick) => void;
  /** Show the "Uncategorized" (onPick(null)) row. True for row
   *  recategorize, where null unambiguously means "clear this
   *  transaction's category". Omit for filter mode: the server has no
   *  "categoryId is null" filter param, so onPick(null) there would just
   *  silently clear the filter — matches the web filter dropdown, which
   *  offers no Uncategorized option either. */
  allowUncategorized?: boolean;
}) {
  const api = useApi();
  const [categories, setCategories] = useState<PortalCategoryDTO[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!visible || categories !== null) return;
    let live = true;
    fetchCategories(api)
      .then((cats) => {
        if (live) setCategories(cats);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [visible, categories, api]);

  const groups = (categories ?? []).filter((c) => c.kind === "group");
  const leavesFor = (groupId: string) => (categories ?? []).filter((c) => c.kind === "category" && c.parentId === groupId);

  function pick(c: PortalCategoryDTO) {
    onPick({ id: c.id, name: c.name, color: c.color });
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={onClose} />
      <View className="bg-paper rounded-t-2xl px-4 pt-4 pb-8" style={{ maxHeight: "75%" }}>
        <View className="flex-row justify-between items-center mb-2">
          <Text className="text-ink text-lg font-semibold">Choose a category</Text>
          <Pressable onPress={onClose} hitSlop={8}>
            <Text className="text-accent-ink">Close</Text>
          </Pressable>
        </View>

        {categories === null && !error ? (
          <View className="py-12 items-center">
            <ActivityIndicator />
          </View>
        ) : categories === null && error ? (
          <View className="py-12 items-center">
            <Text className="text-ink-2">Couldn't load categories.</Text>
          </View>
        ) : (
          <ScrollView>
            {allowUncategorized ? <Row label="Uncategorized" onPress={() => onPick(null)} /> : null}
            {groups.map((g) => {
              const leaves = leavesFor(g.id);
              if (leaves.length === 0) return null;
              return (
                <View key={g.id} className="mt-3">
                  <View className="flex-row items-center mb-1">
                    <CategoryDot color={g.color} size={12} />
                    <Text className="text-ink-3 text-xs uppercase tracking-wide ml-2">{g.name}</Text>
                  </View>
                  {leaves.map((leaf) => (
                    <Row
                      key={leaf.id}
                      leading={<CategoryDot color={leaf.color} />}
                      label={leaf.name}
                      onPress={() => pick(leaf)}
                    />
                  ))}
                </View>
              );
            })}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
}
