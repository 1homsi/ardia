import { NavigationBar } from "expo-navigation-bar";
import { Platform, StatusBar } from "react-native";

export function setSystemBarIcons(lightStatus: boolean, lightNavigation: boolean) {
  StatusBar.setBarStyle(lightStatus ? "light-content" : "dark-content", true);
  if (Platform.OS === "android") NavigationBar.setStyle(lightNavigation ? "light" : "dark");
}
