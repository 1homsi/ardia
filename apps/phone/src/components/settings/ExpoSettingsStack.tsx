import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import { Host, NavigationDestination, NavigationStack, RNHostView, VStack } from "@expo/ui/swift-ui";
import { ignoreSafeArea, navigationBarTitleDisplayMode, navigationTitle } from "@expo/ui/swift-ui/modifiers";
import { refreshSettings } from "../../state/settings/actions";
import { useSettingsNav } from "../../state/settings/hooks";
import { followSettingsPath, settingsPath, settingsRouteFromKey, type SettingsRoute } from "../../state/settings/nav";
import { nativeLookColors } from "../../lib/profileLook";
import { PHONE_SHARING_COPY } from "../../lib/telemetryCopy";
import { LookBackdrop, modifierList, profileLook, settingsUIAvailable, useProfileLook, usesGlass } from "../ui";
import { useChromeStyle } from "../../state/settings/appearance";
import { ExpoAppearancePage } from "./ExpoAppearancePage";
import { ExpoSettingsRoot } from "./ExpoSettingsRoot";
import { SettingsHostedContext } from "./SettingsKit";
import { SettingsPageFor } from "./SettingsView";

const CONVERTED: Partial<Record<SettingsRoute["page"], () => React.JSX.Element>> = { appearance: ExpoAppearancePage };

const TITLES: Record<SettingsRoute["page"], string> = {
  root: "Settings",
  appearance: "Appearance",
  searchEngine: "Search Engine",
  siteSettings: "Site Settings",
  filterLists: "Filter Lists",
  filterList: "Filter List",
  myFilters: "My Filters",
  trustedSites: "Trusted Sites",
  clearData: "Clear Browsing Data",
  sync: "Sync With Mac",
  defaultBrowser: "Default Browser",
  syncConnect: "Connect to Your Mac",
  about: "About Ardia",
  licenses: "Open Source Licenses",
  whatsSent: PHONE_SHARING_COPY.whatsSent,
};

export function ExpoSettingsStack() {
  const open = useSettingsNav((s) => s.open);
  const stack = useSettingsNav((s) => s.stack);
  const look = useProfileLook();
  const glass = useChromeStyle() === "glass" && usesGlass();
  useEffect(() => {
    if (open) void refreshSettings();
  }, [open]);
  if (!open) return null;
  const path = settingsPath(stack);
  return (
    <View testID="expoSettings" style={StyleSheet.absoluteFill}>
      {settingsUIAvailable() ? null : <LookBackdrop />}
      <Host style={styles.fill}>
        <NavigationStack path={path} onPathChange={followSettingsPath} modifiers={modifierList(profileLook({ ...nativeLookColors(look), usesGlass: glass }))}>
          <ExpoSettingsRoot />
          {path.map((key) => (
            <NavigationDestination key={key} value={key}>
              <Destination routeKey={key} />
            </NavigationDestination>
          ))}
        </NavigationStack>
      </Host>
    </View>
  );
}

function Destination({ routeKey }: { routeKey: string }) {
  const route = settingsRouteFromKey(routeKey);
  if (!route) return null;
  const Converted = CONVERTED[route.page];
  if (Converted) return <Converted />;
  return (
    <VStack modifiers={[navigationTitle(TITLES[route.page]), navigationBarTitleDisplayMode("inline"), ignoreSafeArea({ edges: "bottom" })]}>
      <RNHostView>
        <View style={styles.fill}>
          <SettingsHostedContext.Provider value>
            <SettingsPageFor route={route} />
          </SettingsHostedContext.Provider>
        </View>
      </RNHostView>
    </VStack>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
