import { useEffect, useState, type ReactNode } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSpring, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { advanceOnboarding, finishOnboarding, useOnboarding } from "../../state/onboarding/hooks";
import { refreshSettings, setBlockingCategory, useBlocking } from "../../state/settings/actions";
import { AppIcon, appIconLayout, capsule, LookBackdrop, onboardingArt, font, radius, settingsLayout, settingsTint, shadowRadius, space, spring, Symbol, tabsMotion, useTheme, type SymbolName } from "../ui";
import { ToggleRow } from "../settings/SettingsKit";
import { SyncConnect } from "../sync/SyncConnect";
import { DefaultBrowserSteps } from "../settings/DefaultBrowserPage";
import { LinkBubble } from "./LinkBubble";
import { PHONE_SHARING_COPY } from "../../lib/telemetryCopy";
import { setUsageSharing, useUsageSharing } from "../../state/telemetry/telemetry";
import { useSyncConnected } from "../../state/sync/hooks";

const welcomeSpring = spring(0.7, 0.7);
const STEP_SHIFT = 60;
const ONBOARDING_MIN_PAGE = 560;
const LARGE_TEXT = 1.35;
const smooth = spring(0.42, 0.9);
const BACKDROP_IN = FadeIn.duration(300);
const BACKDROP_OUT = FadeOut.duration(300);
const REDUCED_IN = FadeIn.duration(tabsMotion.fade);
const REDUCED_OUT = FadeOut.duration(tabsMotion.fade);

const stepIn = (direction: 1 | -1) => () => {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ translateX: direction * STEP_SHIFT }] },
    animations: { opacity: withSpring(1, smooth), transform: [{ translateX: withSpring(0, smooth) }] },
  };
};

const stepOut = (direction: 1 | -1) => () => {
  "worklet";
  return {
    initialValues: { opacity: 1, transform: [{ translateX: 0 }] },
    animations: { opacity: withSpring(0, smooth), transform: [{ translateX: withSpring(-direction * STEP_SHIFT, smooth) }] },
  };
};
const WELCOME_DELAY_MS = 100;

export function OnboardingView() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const showing = useOnboarding((s) => s.showing);
  const step = useOnboarding((s) => s.step);
  const forward = useOnboarding((s) => s.forward);
  const reduceMotion = useReducedMotion();
  const { fontScale } = useWindowDimensions();
  useEffect(() => {
    if (showing) void refreshSettings();
  }, [showing]);
  useEffect(() => Keyboard.dismiss(), [step]);
  if (!showing) return null;
  const welcome = step === "welcome";
  const content = step === "welcome" ? <Welcome /> : step === "blocking" ? <Blocking /> : step === "sync" ? <SyncStep /> : step === "defaultBrowser" ? <DefaultBrowserStep /> : <AllSet />;
  return (
    <Animated.View exiting={FadeOut.duration(tabsMotion.surfaceFade)} style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface }]}>
      <Animated.View key={welcome ? "welcome" : "steps"} entering={BACKDROP_IN} exiting={BACKDROP_OUT} style={StyleSheet.absoluteFill}>
        <LookBackdrop softened={!welcome} fadesOut={!welcome} />
      </Animated.View>
      <Animated.View
        key={step}
        entering={reduceMotion ? REDUCED_IN : forward ? stepIn(1) : stepIn(-1)}
        exiting={reduceMotion ? REDUCED_OUT : forward ? stepOut(1) : stepOut(-1)}
        style={[StyleSheet.absoluteFill, { paddingTop: insets.top, paddingBottom: insets.bottom }]}
      >
        {fontScale > LARGE_TEXT ? (
          <ScrollView contentContainerStyle={styles.scrolled} keyboardShouldPersistTaps="handled">
            {content}
          </ScrollView>
        ) : (
          content
        )}
      </Animated.View>
    </Animated.View>
  );
}

function DefaultBrowserStep() {
  const theme = useTheme();
  return (
    <View style={styles.fill}>
      <View style={[styles.fill, styles.art]}>
        <LinkBubble />
      </View>
      <View style={[styles.browserSheet, { backgroundColor: theme.groupFill, shadowColor: theme.trayShadow }]}>
        <DefaultBrowserSteps onLater={advanceOnboarding} onDone={advanceOnboarding} />
      </View>
    </View>
  );
}

function SyncStep() {
  const theme = useTheme();
  const connected = useSyncConnected();
  const [connecting, setConnecting] = useState(false);
  return (
    <>
      <Page
        title={
          <>
            Every tab, <Text style={{ color: theme.formAccent }}>anywhere</Text>.
          </>
        }
        subtitle={connected ? "Connected." : "Your Mac’s tabs, right here. End-to-end encrypted."}
        illustration={
          <View style={[styles.card, styles.syncArt, { backgroundColor: theme.groupFill, shadowColor: theme.trayShadow }]}>
            <Symbol name={connected ? "checkmarkCircle" : "macAndPhone"} size={64} color={connected ? theme.switchOn : theme.formAccent} />
          </View>
        }
      >
        {connected ? (
          <Primary title="Continue" onPress={advanceOnboarding} />
        ) : (
          <>
            <Primary title="Connect to Your Mac" onPress={() => setConnecting(true)} />
            <Secondary title="Not Now" onPress={advanceOnboarding} />
          </>
        )}
      </Page>
      {connecting ? (
        <View style={StyleSheet.absoluteFill}>
          <SyncConnect closes onClose={() => setConnecting(false)} onConnected={() => setConnecting(false)} />
        </View>
      ) : null}
    </>
  );
}

function Secondary({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.secondary}>
      <Text style={[font.body, styles.bold, { color: theme.label }]}>{title}</Text>
    </Pressable>
  );
}

function Primary({ title, onPress }: { title: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.primary, { backgroundColor: theme.label }]}>
      <Text style={[font.body, styles.bold, { color: theme.groupFill }]}>{title}</Text>
    </Pressable>
  );
}

function Welcome() {
  const theme = useTheme();
  const reduceMotion = useReducedMotion();
  const appear = useSharedValue(0);
  useEffect(() => {
    appear.value = reduceMotion ? withTiming(1, { duration: tabsMotion.fade }) : withDelay(WELCOME_DELAY_MS, withSpring(1, welcomeSpring));
  }, [appear]);
  const logo = useAnimatedStyle(
    () => ({
      opacity: Math.min(Math.max(appear.value, 0), 1),
      transform: [{ rotate: `${reduceMotion ? -6 : -18 + 12 * appear.value}deg` }, { scale: reduceMotion ? 1 : 0.7 + 0.3 * appear.value }],
    }),
    [reduceMotion],
  );
  const words = useAnimatedStyle(
    () => ({ opacity: Math.min(Math.max(appear.value, 0), 1), transform: [{ translateY: reduceMotion ? 0 : (1 - appear.value) * 16 }] }),
    [reduceMotion],
  );
  const start = useAnimatedStyle(() => ({ opacity: Math.min(Math.max(appear.value, 0), 1) }));
  return (
    <View style={styles.column}>
      <View style={styles.fill} />
      <Animated.View testID="welcomeIcon" style={[styles.logo, logo]}>
        <AppIcon side={appIconLayout.welcome} scalesWithText={false} />
      </Animated.View>
      <Animated.View style={[styles.words, words]}>
        <Text accessibilityRole="header" style={[font.hero, styles.heavy, { color: theme.label }]}>
          Meet your new favorite browser
        </Text>
        <Text style={[font.title3, styles.centered, { color: theme.secondaryLabel }]}>Get what you want twice as fast.</Text>
      </Animated.View>
      <View style={styles.fill} />
      <Animated.View style={[styles.actions, start]}>
        <Primary title="Get Started" onPress={advanceOnboarding} />
      </Animated.View>
    </View>
  );
}

function Page({ title, subtitle, illustration, children }: { title: ReactNode; subtitle: string; illustration: ReactNode; children: ReactNode }) {
  const theme = useTheme();
  return (
    <View style={styles.column}>
      <View style={styles.illustration}>{illustration}</View>
      <View style={styles.words}>
        <Text accessibilityRole="header" style={[font.largeTitle, styles.heavy, { color: theme.label }]}>
          {title}
        </Text>
        <Text style={[font.body, styles.centered, { color: theme.secondaryLabel }]}>{subtitle}</Text>
      </View>
      <View style={styles.actions}>{children}</View>
    </View>
  );
}

function Blocking() {
  const theme = useTheme();
  const state = useBlocking((s) => s.state);
  return (
    <Page
      title={
        <>
          Never see another <Text style={{ color: theme.formAccent }}>ad</Text>.
        </>
      }
      subtitle="Trackers and cookie banners too."
      illustration={
        <View style={[styles.card, { backgroundColor: theme.groupFill, shadowColor: theme.trayShadow }]}>
          <ToggleRow title="Block Ads" icon="handRaised" tint={settingsTint.ads} value={state?.blocksAds ?? true} divider onChange={(on) => setBlockingCategory("ads", on)} />
          <ToggleRow title="Block Trackers" icon="eyeglasses" tint={settingsTint.trackers} value={state?.blocksTrackers ?? true} divider onChange={(on) => setBlockingCategory("trackers", on)} />
          <ToggleRow title="Block Cookie Banners" icon="listBulletFill" tint={settingsTint.cookies} value={state?.hidesCookieBanners ?? true} onChange={(on) => setBlockingCategory("cookieBanners", on)} />
        </View>
      }
    >
      <Primary title="Continue" onPress={advanceOnboarding} />
    </Page>
  );
}

const TIPS: { icon: SymbolName; text: string }[] = [
  { icon: "plus", text: "Tap + to search." },
  { icon: "squareOnSquare", text: "Flick a tab up to close it." },
  { icon: "handDrawFill", text: "Swipe a page to go back." },
  { icon: "archivebox", text: "Old tabs archive after a day." },
];

function AllSet() {
  const theme = useTheme();
  return (
    <Page
      title="You’re all set!"
      subtitle="Happy browsing."
      illustration={
        <Animated.View entering={FadeIn.duration(tabsMotion.surfaceFade)} style={[styles.card, styles.tips, { backgroundColor: theme.groupFill, shadowColor: theme.trayShadow }]}>
          {TIPS.map((tip) => (
            <View key={tip.text} style={styles.tip}>
              <View style={styles.tipIcon}>
                <Symbol name={tip.icon} size={20} color={theme.formAccent} />
              </View>
              <Text style={[font.subheadline, { color: theme.label }]}>{tip.text}</Text>
            </View>
          ))}
        </Animated.View>
      }
    >
      <SharingChoice />
      <Primary title="Start Browsing" onPress={finishOnboarding} />
    </Page>
  );
}

function SharingChoice() {
  const theme = useTheme();
  const sharing = useUsageSharing((s) => s.sharing);
  return (
    <View style={styles.sharing}>
      <View style={[styles.sharingCard, { backgroundColor: theme.groupFill }]}>
        <ToggleRow title={PHONE_SHARING_COPY.toggle} icon="checkmarkShield" tint={settingsTint.neutral} value={sharing} onChange={(on) => setUsageSharing(on, "onboarding")} />
      </View>
      <Text style={[font.footnote, styles.centered, { color: theme.secondaryLabel }]}>{PHONE_SHARING_COPY.onboardingNote}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  scrolled: { flexGrow: 1, minHeight: ONBOARDING_MIN_PAGE },
  sharing: { gap: space.s },
  sharingCard: { borderRadius: radius.card, overflow: "hidden" },
  column: { flex: 1, alignItems: "stretch", gap: space.xxl },
  fill: { flex: 1 },
  logo: {
    alignSelf: "center",
    padding: appIconLayout.welcomeFrame,
    borderRadius: appIconLayout.welcome * appIconLayout.corner + appIconLayout.welcomeFrame,
    backgroundColor: appIconLayout.fill,
    boxShadow: appIconLayout.welcomeShadow,
  },
  words: { paddingHorizontal: space.huge, gap: space.s, alignItems: "center" },
  heavy: { fontWeight: "700", textAlign: "center" },
  centered: { textAlign: "center" },
  bold: { fontWeight: "600" },
  actions: { paddingHorizontal: space.xxl, paddingBottom: space.m, gap: space.s },
  primary: { minHeight: settingsLayout.primaryButton, borderRadius: capsule(settingsLayout.primaryButton), alignItems: "center", justifyContent: "center" },
  illustration: { flex: 1, justifyContent: "flex-end", paddingHorizontal: space.l },
  card: { borderRadius: radius.card, paddingVertical: space.xs, elevation: 8, shadowOpacity: 0.4, shadowRadius: shadowRadius.card },
  art: { alignItems: "center", justifyContent: "center", paddingHorizontal: space.huge },
  browserSheet: {
    borderTopLeftRadius: onboardingArt.sheetRadius,
    borderTopRightRadius: onboardingArt.sheetRadius,
    paddingTop: space.huge - space.l,
    paddingBottom: space.m,
    elevation: 10,
    shadowOpacity: 0.08,
    shadowRadius: shadowRadius.card,
  },
  syncArt: { alignSelf: "center", padding: space.huge, alignItems: "center" },
  secondary: { minHeight: 44, alignItems: "center", justifyContent: "center" },
  tips: { paddingHorizontal: space.xl, paddingVertical: space.xl, gap: space.xl },
  tip: { flexDirection: "row", alignItems: "center", gap: space.m },
  tipIcon: { width: 28, alignItems: "center" },
});
