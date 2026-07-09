import { View } from "react-native";
import { tokenToHex } from "@/ui/data-color";
export function CategoryDot({ color, size = 10 }: { color: string | null; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tokenToHex(color) }} />;
}
