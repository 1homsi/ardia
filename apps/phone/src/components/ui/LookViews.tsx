import {
  DeckBackdrop,
  Frost,
  Glass,
  glassIsNative,
  INCOGNITO_LOOK,
  lookIsNative,
  ProfileBackdrop,
  type FrostVariant,
  type GlassShape,
} from "@ardia/phone-native";
import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { useReducedMotion } from "react-native-reanimated";
import {
  nativeLookColors,
  windowTintStops,
  type NativeLookColors,
  type ProfileLook,
} from "../../lib/profileLook";
import { Backdrop } from "./Backdrop";
import { useReduceTransparency } from "./contrast";
import { useProfileLook, useTheme } from "./theme";
import { chromeInk, chromeLayout, tabsInk } from "./tokens";

export const SURFACES_FROST = "surfaces";

function BackdropBase({ color }: { color: string | undefined }) {
  return (
    <View
      testID="backdropBase"
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: color }]}
    />
  );
}

const INCOGNITO_COLORS: NativeLookColors = {
  color: INCOGNITO_LOOK,
  themeColors: [],
  darkThemeColors: null,
};

const lookColors = (look: ProfileLook, incognito: boolean): NativeLookColors =>
  incognito ? INCOGNITO_COLORS : nativeLookColors(look);

type BackdropProps = {
  themed?: boolean;
  softened?: boolean;
  fadesOut?: boolean;
  incognito?: boolean;
  dark?: boolean;
  baseOutside?: boolean;
};

function useBackdropStops({ themed = false, incognito = false, dark }: BackdropProps) {
  const look = useProfileLook();
  const theme = useTheme();
  const shade = incognito || (dark ?? theme.dark);
  const stops = incognito
    ? tabsInk.incognitoBackdrop
    : themed
      ? theme.start.colors
      : dark === undefined
        ? theme.backdrop
        : windowTintStops(look, shade);
  return { look, theme, shade, stops };
}

export function LookBackdropBase(props: BackdropProps) {
  const { stops } = useBackdropStops(props);
  if (!lookIsNative() || props.fadesOut) return null;
  return <BackdropBase color={stops[0]} />;
}

export function DeckLookBackdropBase() {
  const theme = useTheme();
  if (!lookIsNative()) return null;
  return <BackdropBase color={theme.backdrop[0]} />;
}

export function LookBackdrop(props: BackdropProps) {
  const { themed = false, softened = false, fadesOut = false, incognito = false, baseOutside = false } = props;
  const { look, theme, shade, stops } = useBackdropStops(props);
  if (!lookIsNative()) {
    if (incognito) return <Backdrop colors={tabsInk.incognitoBackdrop} />;
    if (themed)
      return (
        <Backdrop colors={theme.start.colors} diagonal={theme.start.diagonal} />
      );
    return <Backdrop colors={stops} />;
  }
  return (
    <>
      {fadesOut || baseOutside ? null : <BackdropBase color={stops[0]} />}
      <ProfileBackdrop
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        {...lookColors(look, incognito)}
        dark={shade}
        themed={themed}
        softened={softened}
        fadesOut={fadesOut}
      />
    </>
  );
}

export function DeckLookBackdrop({ baseOutside = false }: { baseOutside?: boolean }) {
  const look = useProfileLook();
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const reduceTransparency = useReduceTransparency();
  if (!lookIsNative()) return <Backdrop colors={theme.backdrop} />;
  return (
    <>
      {baseOutside ? null : <BackdropBase color={theme.backdrop[0]} />}
      <DeckBackdrop
        pointerEvents="none"
        style={StyleSheet.absoluteFill}
        {...nativeLookColors(look)}
        dark={theme.dark}
        reduceMotion={reduceMotion}
        reduceTransparency={reduceTransparency}
      />
    </>
  );
}

type FrostProps = {
  source: string;
  variant: FrostVariant;
  cornerRadius: number;
  fill: string;
  dark?: boolean;
  incognito?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
};

export function LookFrost({
  source,
  variant,
  cornerRadius,
  fill,
  dark,
  incognito = false,
  style,
  children,
}: FrostProps) {
  const look = useProfileLook();
  const theme = useTheme();
  const reduceTransparency = useReduceTransparency();
  if (!lookIsNative())
    return (
      <View
        style={[style, { backgroundColor: fill, borderRadius: cornerRadius }]}
      >
        {children}
      </View>
    );
  return (
    <Frost
      source={source}
      variant={variant}
      cornerRadius={cornerRadius}
      {...lookColors(look, incognito)}
      dark={incognito || (dark ?? theme.dark)}
      reduceTransparency={reduceTransparency}
      style={[style, { borderRadius: cornerRadius, backgroundColor: fill }]}
    >
      {children}
    </Frost>
  );
}

export const usesGlass = () => glassIsNative();

export function ChromeSurface({
  shape,
  cornerRadius,
  incognito = false,
  barShadow = false,
  dark,
  testID,
  style,
  children,
}: {
  shape: GlassShape;
  cornerRadius: number;
  incognito?: boolean;
  barShadow?: boolean;
  dark?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  const look = useProfileLook();
  const theme = useTheme();
  if (glassIsNative()) {
    return (
      <Glass testID={testID} source={SURFACES_FROST} shape={shape} interactive surface="glass" barShadow={barShadow} {...lookColors(look, incognito)} dark={dark ?? (incognito || theme.dark)} style={[style, { borderRadius: cornerRadius }]}>
        {children}
      </Glass>
    );
  }
  const ink = dark ?? (incognito || theme.dark) ? chromeInk.dark : chromeInk.light;
  return (
    <View
      testID={testID}
      style={[
        style,
        {
          borderRadius: cornerRadius,
          backgroundColor: ink.surface,
          borderWidth: chromeLayout.edge,
          borderColor: ink.edge,
          boxShadow: barShadow ? `0px ${chromeLayout.shadowY}px ${chromeLayout.shadowRadius * 2}px ${ink.shadow}` : undefined,
        },
      ]}
    >
      {children}
    </View>
  );
}

export function LookGlass({
  shape,
  ...frost
}: FrostProps & { shape: GlassShape }) {
  const look = useProfileLook();
  const theme = useTheme();
  if (!glassIsNative()) return <LookFrost {...frost} />;
  return (
    <Glass
      testID="deckGlass"
      source={frost.source}
      shape={shape}
      {...lookColors(look, frost.incognito ?? false)}
      dark={frost.incognito || (frost.dark ?? theme.dark)}
      style={frost.style}
    >
      {frost.children}
    </Glass>
  );
}
