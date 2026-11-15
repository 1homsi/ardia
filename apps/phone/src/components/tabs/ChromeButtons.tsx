import { StyleSheet, View } from "react-native";
import { newIncognitoTab, newRegularTab, newTab, reopenLastClosed } from "../../state/browse/store";
import { capsule, ChromeSurface, PressScale, rolesFor, startLayout, Symbol, type MenuItem, type SymbolName } from "../ui";

export function plusMenuItems(incognito: boolean, canReopen: boolean): MenuItem[] {
  return [
    ...(incognito
      ? [
          { label: "New Tab", icon: "plus" as const, onPress: newRegularTab },
          { label: "New Incognito Tab", icon: "eyes" as const, onPress: newTab },
        ]
      : [{ label: "New Incognito Tab", icon: "eyes" as const, onPress: newIncognitoTab }]),
    ...(canReopen ? [{ label: "Reopen Closed Tab", icon: "arrowUturnBackward" as const, onPress: reopenLastClosed }] : []),
  ];
}

type Look = { dark: boolean; incognito?: boolean };

export function GlassCircleButton({ icon, label, testID, diameter = startLayout.barCircle, dark, incognito = false, onPress }: Look & { icon: SymbolName; label: string; testID: string; diameter?: number; onPress: () => void }) {
  const size = { width: diameter, height: diameter };
  return (
    <PressScale label={label} onPress={onPress} style={[styles.centered, size]}>
      <ChromeSurface testID={testID} shape="circle" cornerRadius={capsule(diameter)} incognito={incognito} dark={dark} style={[styles.centered, size]}>
        <View pointerEvents="none">
          <Symbol name={icon} size={startLayout.circleGlyph} color={rolesFor(dark).label} />
        </View>
      </ChromeSurface>
    </PressScale>
  );
}

export function GlassPlusButton({ width, label, testID, dark, incognito = false, onPress, onLongPress }: Look & { width: number; label: string; testID: string; onPress: () => void; onLongPress: () => void }) {
  const size = { width, height: startLayout.barPlus.height };
  return (
    <PressScale label={label} hint="Touch and hold for more options." onPress={onPress} onLongPress={onLongPress} style={size}>
      <ChromeSurface testID={testID} shape="capsule" cornerRadius={capsule(size.height)} incognito={incognito} dark={dark} style={[styles.centered, size]}>
        <View pointerEvents="none">
          <Symbol name="plus" size={startLayout.plusGlyph} color={rolesFor(dark).label} />
        </View>
      </ChromeSurface>
    </PressScale>
  );
}

const styles = StyleSheet.create({
  centered: { alignItems: "center", justifyContent: "center" },
});
