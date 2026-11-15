const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [path.resolve(repoRoot, "packages/phone"), path.resolve(repoRoot, "packages/core")];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];
config.resolver.disableHierarchicalLookup = true;
config.cacheVersion = [config.cacheVersion, process.env.EXPO_PUBLIC_ARDIA_LAB === "true" ? "lab" : "store"].join(":");

module.exports = config;
