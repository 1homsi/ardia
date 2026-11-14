module.exports = {
  preset: "jest-expo",
  rootDir: __dirname,
  testMatch: ["<rootDir>/src/**/*.render.test.tsx"],
  setupFiles: ["<rootDir>/test/render/setup.ts"],
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|react-native-.*|@ardia/.*|zustand))",
  ],
};
