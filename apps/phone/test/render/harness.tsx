import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { DEFAULT_PROFILE_COLOR, OverlayHost, PROFILE_PRESETS, ProfileLookContext } from "../../src/components/ui";
import { useLook } from "../../src/state/sync/hooks";
import { useTabs } from "../../src/state/tabs/store";
import { launchTabs } from "../../src/state/tabs/tabsState";
import type { BrowserTab } from "../../src/state/tabs/tabModels";

const METRICS = { frame: { x: 0, y: 0, width: 393, height: 873 }, insets: { top: 40, left: 0, right: 0, bottom: 24 } };

function Look({ children }: { children: ReactNode }) {
  const look = useLook(PROFILE_PRESETS, DEFAULT_PROFILE_COLOR);
  return <ProfileLookContext.Provider value={look}>{children}</ProfileLookContext.Provider>;
}

export function renderSurface(node: ReactNode, { flushTimers = true }: { flushTimers?: boolean } = {}): ReactTestRenderer {
  let root: ReactTestRenderer | null = null;
  act(() => {
    root = create(
      <GestureHandlerRootView style={StyleSheet.absoluteFill}>
        <SafeAreaProvider initialMetrics={METRICS}>
          <Look>
            <OverlayHost>{node}</OverlayHost>
          </Look>
        </SafeAreaProvider>
      </GestureHandlerRootView>,
    );
  });
  if (flushTimers) act(() => jest.runOnlyPendingTimers());
  return root!;
}

export function unmount(root: ReactTestRenderer) {
  act(() => root.unmount());
}

const T = 1_790_000_000_000;

export function someTabs(count: number, isPrivate = false): BrowserTab[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `${isPrivate ? "p" : "t"}${i}`,
    url: `https://site${i}.example/`,
    title: `Site ${i}`,
    created: T + i,
    lastActive: T + i,
    archivedAt: null,
    position: (i + 1) * 1024,
    profileSyncId: null,
    faviconUrl: null,
    themeColorHex: null,
    snapshotFileName: null,
    origin: "typed",
    receivedKey: null,
    receivedFromDevice: null,
    isPrivate,
  }));
}

export function withTabs(count: number) {
  useTabs.setState({ ...launchTabs(someTabs(count), 0), incognito: false, listing: 0 });
}

export function textOf(root: ReactTestRenderer): string {
  return root.root
    .findAll((node) => typeof node.type === "string" && node.type === "Text")
    .map((node) => node.children.filter((child) => typeof child === "string").join(""))
    .join("\n");
}

export async function pressButton(root: ReactTestRenderer, title: string) {
  const button = root.root.findAll((node) => node.props.accessibilityRole === "button" && typeof node.props.onPress === "function" && textOf({ root: node } as ReactTestRenderer).includes(title))[0];
  if (!button) throw new Error(`no button titled ${title}`);
  await act(async () => {
    button.props.onPress();
  });
}
