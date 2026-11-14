import "react-native-gesture-handler/jestSetup";

require("react-native-reanimated").setUpTests();

jest.mock("react-native-safe-area-context", () => require("react-native-safe-area-context/jest/mock").default);

jest.mock("../../src/platform/database", () => {
  const { renderDatabase } = require("./renderDatabase");
  return { openSqlDatabase: () => renderDatabase(), openMemoryDatabase: () => renderDatabase() };
});
