import { createElement, forwardRef, useImperativeHandle, useRef, type ComponentType, type Ref } from "react";
import { requireNativeViewManager, requireOptionalNativeModule } from "expo-modules-core";
import { TextInput, type NativeSyntheticEvent, type TextInputProps, type ViewProps } from "react-native";

export type CompletionOffer = { query: string; completion: string };

export type CompletingFieldHandle = {
  focus(): void;
  blur(): void;
  setText(text: string, selectsAll?: boolean): void;
};

type SharedInputProps = Pick<
  TextInputProps,
  | "placeholder"
  | "placeholderTextColor"
  | "keyboardType"
  | "returnKeyType"
  | "autoCapitalize"
  | "autoCorrect"
  | "autoFocus"
  | "editable"
  | "maxLength"
  | "accessibilityLabel"
>;

export type CompletingFieldProps = ViewProps &
  SharedInputProps & {
    text: string;
    offer?: CompletionOffer | null;
    highlightColor?: string;
    selectsAllOnFocus?: boolean;
    color?: string;
    fontSize?: number;
    fontWeight?: "regular" | "medium" | "semibold" | "bold";
    onTypedChange?: (typed: string) => void;
    onSubmit?: (displayed: string) => void;
    onFocusChange?: (focused: boolean) => void;
    onSuffixChange?: (suffix: string) => void;
  };

type NativeProps = Omit<CompletingFieldProps, "onTypedChange" | "onSubmit" | "onFocusChange" | "onSuffixChange"> & {
  ref?: Ref<CompletingFieldHandle>;
  onTypedChange?: (event: NativeSyntheticEvent<{ typed: string }>) => void;
  onSubmit?: (event: NativeSyntheticEvent<{ displayed: string }>) => void;
  onFocusChange?: (event: NativeSyntheticEvent<{ focused: boolean }>) => void;
  onSuffixChange?: (event: NativeSyntheticEvent<{ suffix: string }>) => void;
};

const hasNative = requireOptionalNativeModule("ArdiaPhoneCompletingField") !== null;

let nativeView: ComponentType<NativeProps> | undefined;
const view = () => (nativeView ??= requireNativeViewManager<NativeProps>("ArdiaPhoneCompletingField"));

export const completingFieldIsNative = () => hasNative;

const fallbackWeights = { regular: "400", medium: "500", semibold: "600", bold: "700" } as const;

export const CompletingField = forwardRef<CompletingFieldHandle, CompletingFieldProps>(function CompletingField(props, ref) {
  const { onTypedChange, onSubmit, onFocusChange, onSuffixChange, text, offer, highlightColor, selectsAllOnFocus, color, fontSize, fontWeight, style, ...rest } = props;
  const native = useRef<CompletingFieldHandle>(null);
  const input = useRef<TextInput>(null);
  useImperativeHandle(
    ref,
    () => ({
      focus: () => (hasNative ? native.current?.focus() : input.current?.focus()),
      blur: () => (hasNative ? native.current?.blur() : input.current?.blur()),
      setText: (next, selectsAll = false) => {
        if (hasNative) native.current?.setText(next, selectsAll);
        else {
          onTypedChange?.(next);
          if (selectsAll) input.current?.setSelection(0, next.length);
        }
      },
    }),
    [onTypedChange],
  );
  if (hasNative) {
    return createElement(view(), {
      ...rest,
      ref: native,
      style,
      text,
      offer: offer ?? null,
      highlightColor,
      selectsAllOnFocus,
      color,
      fontSize,
      fontWeight,
      onTypedChange: (event) => onTypedChange?.(event.nativeEvent.typed),
      onSubmit: (event) => onSubmit?.(event.nativeEvent.displayed),
      onFocusChange: (event) => onFocusChange?.(event.nativeEvent.focused),
      onSuffixChange: (event) => onSuffixChange?.(event.nativeEvent.suffix),
    });
  }
  return createElement(TextInput, {
    ...rest,
    ref: input,
    value: text,
    selectTextOnFocus: selectsAllOnFocus,
    style: [style, { color, fontSize, fontWeight: fontWeight ? fallbackWeights[fontWeight] : undefined }],
    onChangeText: (typed: string) => onTypedChange?.(typed),
    onSubmitEditing: () => onSubmit?.(text),
    onFocus: () => onFocusChange?.(true),
    onBlur: () => onFocusChange?.(false),
  });
});
