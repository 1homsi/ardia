import "react-native-gesture-handler/jestSetup";

require("react-native-reanimated").setUpTests();

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

jest.mock("../../src/platform/database", () => {
  const { renderDatabase } = require("./renderDatabase");
  return { openSqlDatabase: () => renderDatabase(), openMemoryDatabase: () => renderDatabase() };
});

const PHONE_WINDOW = { width: 393, height: 873, scale: 3, fontScale: 1 };
require("react-native").Dimensions.set({ window: PHONE_WINDOW, screen: PHONE_WINDOW });

jest.mock("expo-navigation-bar", () => ({
  setButtonStyleAsync: async () => undefined,
  setBackgroundColorAsync: async () => undefined,
  setVisibilityAsync: async () => undefined,
  setStyle: () => undefined,
}));
