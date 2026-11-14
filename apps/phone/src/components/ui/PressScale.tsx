import { useRef, type ReactNode } from "react";
import { Animated, Pressable, StyleSheet, type StyleProp, type ViewStyle } from "react-native";
import { springs } from "./motion";
import { browseLayout } from "./tokens";

type Props = {
  label: string;
  hint?: string;
  value?: string;
  longPressLabel?: string;
  actions?: { name: string; label: string; run: () => void }[];
  onPress: () => void;
  onLongPress?: () => void;
  onPressIn?: () => void;
  disabled?: boolean;
  grow?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
};

export function PressScale({ label, hint, value, longPressLabel, actions, onPress, onLongPress, onPressIn, disabled, grow, style, children }: Props) {
  const scale = useRef(new Animated.Value(1)).current;
  const exposed = actions
    ? [
        { name: "activate", run: onPress },
        ...(onLongPress ? [{ name: "longpress", label: longPressLabel, run: onLongPress }] : []),
        ...actions,
      ]
    : null;
  const to = (value: number) => Animated.spring(scale, { toValue: value, ...springs.barPress, useNativeDriver: true }).start();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityValue={value ? { text: value } : undefined}
      accessibilityActions={exposed?.map((action) => ("label" in action && action.label ? { name: action.name, label: action.label } : { name: action.name }))}
      onAccessibilityAction={exposed ? (event) => exposed.find((action) => action.name === event.nativeEvent.actionName)?.run() : undefined}
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      style={grow ? styles.grow : undefined}
      onPress={onPress}
      onLongPress={onLongPress}
      onPressIn={() => {
        onPressIn?.();
        to(browseLayout.barControlScale);
      }}
      onPressOut={() => to(1)}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({ grow: { flex: 1 } });
