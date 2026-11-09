/** @type {import('ts-jest').JestConfigWithTsJest} */
export default {
  preset: "ts-jest/presets/default-esm",
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.ts"],
  extensionsToTreatAsEsm: [".ts"],
  moduleNameMapper: {"^(\\.{1,2}/.*)\\.js$": "$1"},
  transform: {"^.+\\.ts$": ["ts-jest", {useESM: true}]},
};
